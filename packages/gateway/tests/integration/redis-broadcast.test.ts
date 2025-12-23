import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis-mock';
import { EventEmitter } from 'events';
import {
  parseRedisMessage,
  wrapTransactionMessage,
  serializeMessage,
  type TransactionData,
} from '../../src/ws/message';
import { ConnectionManager, calculateBufferSize } from '../../src/ws/connection';

const CHANNEL = 'mempool_alpha';

/**
 * Mock WebSocket for testing broadcast
 */
class MockWebSocket extends EventEmitter {
  public readyState: number = 1; // OPEN
  public messages: string[] = [];

  send(data: string): void {
    this.messages.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.emit('close');
  }
}

/**
 * Redis Subscriber that broadcasts to WebSocket clients
 */
class RedisSubscriber extends EventEmitter {
  private redis: Redis;
  private subscribed: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  constructor(redisClient: Redis) {
    super();
    this.redis = redisClient;
  }

  async subscribe(channel: string): Promise<void> {
    await this.redis.subscribe(channel);
    this.subscribed = true;

    this.redis.on('message', (ch: string, message: string) => {
      if (ch === channel) {
        this.emit('message', message);
      }
    });

    this.redis.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.redis.unsubscribe(channel);
    this.subscribed = false;
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }

  async reconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return false;
    }
    this.reconnectAttempts++;
    // In real impl, would reconnect to Redis
    return true;
  }

  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}

/**
 * Broadcaster that sends messages to all connected clients
 */
class Broadcaster {
  private clients: Map<string, MockWebSocket> = new Map();
  private connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  addClient(id: string, ws: MockWebSocket): void {
    this.clients.set(id, ws);
    this.connectionManager.addConnection(id);
  }

  removeClient(id: string): void {
    this.clients.delete(id);
    this.connectionManager.removeConnection(id);
  }

  broadcast(message: string): void {
    const messageSize = calculateBufferSize(message);

    for (const [id, ws] of this.clients) {
      if (ws.readyState === 1) {
        // OPEN
        ws.send(message);
        this.connectionManager.recordMessageSent(id, messageSize);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

describe('Redis Broadcast Integration', () => {
  let redis: Redis;
  let subscriber: RedisSubscriber;
  let broadcaster: Broadcaster;
  let connectionManager: ConnectionManager;

  const sampleTransaction: TransactionData = {
    hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    to: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    method: 'swapExactTokensForTokens',
    methodId: '0x38ed1739',
    value: '1000000000000000000',
    gasPrice: '20000000000',
    timestamp: 1703000000000,
  };

  beforeEach(async () => {
    redis = new Redis();
    subscriber = new RedisSubscriber(redis);
    connectionManager = new ConnectionManager();
    broadcaster = new Broadcaster(connectionManager);
    await subscriber.subscribe(CHANNEL);
  });

  afterEach(async () => {
    await subscriber.unsubscribe(CHANNEL);
    connectionManager.cleanup();
  });

  describe('Redis Subscription', () => {
    it('should subscribe to mempool_alpha channel', () => {
      expect(subscriber.isSubscribed()).toBe(true);
    });

    it('should receive messages from Redis channel', async () => {
      const messagePromise = new Promise<string>((resolve) => {
        subscriber.on('message', resolve);
      });

      // Publish a message
      const publisher = new Redis();
      await publisher.publish(CHANNEL, JSON.stringify(sampleTransaction));

      const received = await messagePromise;
      expect(received).toBe(JSON.stringify(sampleTransaction));
    });

    it('should parse Redis messages correctly', async () => {
      const messagePromise = new Promise<TransactionData>((resolve) => {
        subscriber.on('message', (msg: string) => {
          resolve(parseRedisMessage(msg));
        });
      });

      const publisher = new Redis();
      await publisher.publish(CHANNEL, JSON.stringify(sampleTransaction));

      const parsed = await messagePromise;
      expect(parsed.hash).toBe(sampleTransaction.hash);
      expect(parsed.method).toBe(sampleTransaction.method);
    });
  });

  describe('Broadcast to Clients', () => {
    it('should broadcast to all connected clients', async () => {
      const client1 = new MockWebSocket();
      const client2 = new MockWebSocket();
      const client3 = new MockWebSocket();

      broadcaster.addClient('client-1', client1);
      broadcaster.addClient('client-2', client2);
      broadcaster.addClient('client-3', client3);

      const message = serializeMessage(wrapTransactionMessage(sampleTransaction));
      broadcaster.broadcast(message);

      expect(client1.messages).toHaveLength(1);
      expect(client2.messages).toHaveLength(1);
      expect(client3.messages).toHaveLength(1);

      expect(JSON.parse(client1.messages[0]).type).toBe('transaction');
    });

    it('should not broadcast to closed connections', () => {
      const openClient = new MockWebSocket();
      const closedClient = new MockWebSocket();
      closedClient.readyState = 3; // CLOSED

      broadcaster.addClient('open', openClient);
      broadcaster.addClient('closed', closedClient);

      const message = serializeMessage(wrapTransactionMessage(sampleTransaction));
      broadcaster.broadcast(message);

      expect(openClient.messages).toHaveLength(1);
      expect(closedClient.messages).toHaveLength(0);
    });

    it('should track buffer size for each client', () => {
      const client = new MockWebSocket();
      broadcaster.addClient('client-1', client);

      const message = serializeMessage(wrapTransactionMessage(sampleTransaction));
      broadcaster.broadcast(message);
      broadcaster.broadcast(message);

      const stats = connectionManager.getConnection('client-1');
      expect(stats?.messagesSent).toBe(2);
      expect(stats?.bufferSize).toBeGreaterThan(0);
    });
  });

  describe('Message Ordering (FIFO)', () => {
    it('should maintain message order', async () => {
      const client = new MockWebSocket();
      broadcaster.addClient('client-1', client);

      const messages: TransactionData[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push({
          ...sampleTransaction,
          hash: `0x${i.toString().padStart(64, '0')}`,
        });
      }

      // Broadcast all messages
      for (const msg of messages) {
        broadcaster.broadcast(serializeMessage(wrapTransactionMessage(msg)));
      }

      // Verify order
      expect(client.messages).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        const received = JSON.parse(client.messages[i]);
        expect(received.data.hash).toBe(`0x${i.toString().padStart(64, '0')}`);
      }
    });

    it('should process messages in sequence from Redis', async () => {
      const receivedOrder: number[] = [];

      subscriber.on('message', (msg: string) => {
        const data = JSON.parse(msg);
        receivedOrder.push(parseInt(data.sequence));
      });

      const publisher = new Redis();

      // Publish messages in order
      for (let i = 0; i < 5; i++) {
        await publisher.publish(CHANNEL, JSON.stringify({ ...sampleTransaction, sequence: i }));
      }

      // Wait for all messages
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedOrder).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('Redis Reconnection', () => {
    it('should attempt reconnection on error', async () => {
      const errorPromise = new Promise<void>((resolve) => {
        subscriber.on('error', () => {
          resolve();
        });
      });

      // Simulate error
      redis.emit('error', new Error('Connection lost'));

      await errorPromise;

      // Should be able to reconnect
      const canReconnect = await subscriber.reconnect();
      expect(canReconnect).toBe(true);
    });

    it('should limit reconnection attempts', async () => {
      // Exhaust reconnection attempts
      for (let i = 0; i < 5; i++) {
        await subscriber.reconnect();
      }

      // Should fail after max attempts
      const canReconnect = await subscriber.reconnect();
      expect(canReconnect).toBe(false);
    });

    it('should reset reconnection counter on success', async () => {
      // Use some attempts
      await subscriber.reconnect();
      await subscriber.reconnect();

      // Reset
      subscriber.resetReconnectAttempts();

      // Should have full attempts again
      let attempts = 0;
      while (await subscriber.reconnect()) {
        attempts++;
      }
      expect(attempts).toBe(5);
    });
  });

  describe('Client Management', () => {
    it('should add and remove clients correctly', () => {
      const client1 = new MockWebSocket();
      const client2 = new MockWebSocket();

      broadcaster.addClient('client-1', client1);
      broadcaster.addClient('client-2', client2);
      expect(broadcaster.getClientCount()).toBe(2);

      broadcaster.removeClient('client-1');
      expect(broadcaster.getClientCount()).toBe(1);
    });

    it('should clean up connection stats when client removed', () => {
      const client = new MockWebSocket();
      broadcaster.addClient('client-1', client);

      const statsBefore = connectionManager.getConnection('client-1');
      expect(statsBefore).toBeDefined();

      broadcaster.removeClient('client-1');

      const statsAfter = connectionManager.getConnection('client-1');
      expect(statsAfter).toBeUndefined();
    });
  });

  describe('High Volume Handling', () => {
    it('should handle burst of 100 messages', async () => {
      const client = new MockWebSocket();
      broadcaster.addClient('client-1', client);

      const messageCount = 100;
      for (let i = 0; i < messageCount; i++) {
        const msg = {
          ...sampleTransaction,
          hash: `0x${i.toString(16).padStart(64, '0')}`,
        };
        broadcaster.broadcast(serializeMessage(wrapTransactionMessage(msg)));
      }

      expect(client.messages).toHaveLength(messageCount);
    });

    it('should handle multiple clients with high volume', () => {
      const clientCount = 50;
      const clients: MockWebSocket[] = [];

      for (let i = 0; i < clientCount; i++) {
        const client = new MockWebSocket();
        clients.push(client);
        broadcaster.addClient(`client-${i}`, client);
      }

      const messageCount = 20;
      for (let i = 0; i < messageCount; i++) {
        broadcaster.broadcast(serializeMessage(wrapTransactionMessage(sampleTransaction)));
      }

      for (const client of clients) {
        expect(client.messages).toHaveLength(messageCount);
      }
    });
  });
});
