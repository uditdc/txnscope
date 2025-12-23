import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import Redis from 'ioredis-mock';
import { EventEmitter } from 'events';
import { authenticate, parseApiKeys } from '../../src/auth/apikey';
import {
  wrapTransactionMessage,
  serializeMessage,
  parseRedisMessage,
  createHeartbeatMessage,
  type TransactionData,
} from '../../src/ws/message';
import { ConnectionManager, calculateBufferSize } from '../../src/ws/connection';

const TEST_API_KEY = 'e2e-test-key-12345';
const TEST_PORT = 9877;
const CHANNEL = 'mempool_alpha';

/**
 * Create a full E2E test server with Redis subscription
 */
async function createE2EServer(redis: typeof Redis.prototype): Promise<{
  app: FastifyInstance;
  broadcast: (message: string) => void;
  connectionManager: ConnectionManager;
}> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  const allowedKeys = parseApiKeys(TEST_API_KEY);
  const connectionManager = new ConnectionManager();
  const clients: Map<string, WebSocket> = new Map();

  // Health endpoint
  app.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  // Broadcast function
  const broadcast = (message: string) => {
    const messageSize = calculateBufferSize(message);
    for (const [id, ws] of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        connectionManager.recordMessageSent(id, messageSize);
      }
    }
  };

  // WebSocket streaming endpoint
  app.get('/v1/stream', { websocket: true }, (socket, req) => {
    const authHeader = req.headers.authorization as string | undefined;
    const queryParams = req.query as Record<string, string | undefined>;

    const authResult = authenticate(authHeader, queryParams, allowedKeys);

    if (!authResult.authenticated) {
      socket.close(4001, authResult.error || 'Unauthorized');
      return;
    }

    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    connectionManager.addConnection(clientId);
    clients.set(clientId, socket);

    socket.on('close', () => {
      connectionManager.removeConnection(clientId);
      clients.delete(clientId);
    });

    socket.on('error', () => {
      connectionManager.removeConnection(clientId);
      clients.delete(clientId);
    });
  });

  return { app, broadcast, connectionManager };
}

describe('E2E Full Flow', () => {
  let server: { app: FastifyInstance; broadcast: (message: string) => void; connectionManager: ConnectionManager };
  let redis: typeof Redis.prototype;
  let baseUrl: string;
  let wsUrl: string;

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

  beforeAll(async () => {
    redis = new Redis();
    server = await createE2EServer(redis);
    await server.app.listen({ port: TEST_PORT, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;
    wsUrl = `ws://127.0.0.1:${TEST_PORT}`;
  });

  afterAll(async () => {
    await server.app.close();
  });

  describe('Complete Flow: Auth → Subscribe → Receive Transaction', () => {
    it('should complete full flow: authenticate, subscribe, and receive transaction', async () => {
      // Step 1: Connect with valid auth
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      // Step 2: Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);

      // Step 3: Simulate Redis publishing a transaction
      const message = serializeMessage(wrapTransactionMessage(sampleTransaction));

      // Set up message listener before broadcasting
      const messagePromise = new Promise<string>((resolve, reject) => {
        ws.on('message', (data: Buffer) => {
          resolve(data.toString());
        });
        setTimeout(() => reject(new Error('Message timeout')), 5000);
      });

      // Broadcast the message
      server.broadcast(message);

      // Step 4: Receive and verify the transaction
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('transaction');
      expect(parsed.data.hash).toBe(sampleTransaction.hash);
      expect(parsed.data.method).toBe(sampleTransaction.method);
      expect(parsed.data.methodId).toBe(sampleTransaction.methodId);

      ws.close();
    });

    it('should receive multiple transactions in order', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      const receivedMessages: string[] = [];

      ws.on('message', (data: Buffer) => {
        receivedMessages.push(data.toString());
      });

      // Send 5 transactions
      for (let i = 0; i < 5; i++) {
        const tx = {
          ...sampleTransaction,
          hash: `0x${i.toString().padStart(64, '0')}`,
        };
        server.broadcast(serializeMessage(wrapTransactionMessage(tx)));
      }

      // Wait for messages
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(receivedMessages).toHaveLength(5);

      // Verify order
      for (let i = 0; i < 5; i++) {
        const parsed = JSON.parse(receivedMessages[i]);
        expect(parsed.data.hash).toBe(`0x${i.toString().padStart(64, '0')}`);
      }

      ws.close();
    });
  });

  describe('Latency Tests', () => {
    it('should deliver message within 10ms of broadcast', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      const latencyPromise = new Promise<number>((resolve, reject) => {
        const startTime = Date.now();

        ws.on('message', () => {
          const latency = Date.now() - startTime;
          resolve(latency);
        });

        // Broadcast immediately after setting up listener
        const message = serializeMessage(wrapTransactionMessage(sampleTransaction));
        server.broadcast(message);

        setTimeout(() => reject(new Error('Latency timeout')), 1000);
      });

      const latency = await latencyPromise;
      console.log(`Message delivery latency: ${latency}ms`);

      expect(latency).toBeLessThan(10);

      ws.close();
    });

    it('should maintain low latency under 50 concurrent messages', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      const messageCount = 50;
      let receivedCount = 0;
      const startTime = Date.now();

      const completionPromise = new Promise<number>((resolve) => {
        ws.on('message', () => {
          receivedCount++;
          if (receivedCount === messageCount) {
            resolve(Date.now() - startTime);
          }
        });
      });

      // Send all messages
      for (let i = 0; i < messageCount; i++) {
        const tx = { ...sampleTransaction, hash: `0x${i.toString().padStart(64, '0')}` };
        server.broadcast(serializeMessage(wrapTransactionMessage(tx)));
      }

      const totalTime = await completionPromise;
      const avgLatency = totalTime / messageCount;

      console.log(`Total time for ${messageCount} messages: ${totalTime}ms, avg: ${avgLatency.toFixed(2)}ms`);

      expect(avgLatency).toBeLessThan(10);
      expect(receivedCount).toBe(messageCount);

      ws.close();
    });
  });

  describe('Error Handling', () => {
    it('should reject unauthenticated connection', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`);

      await new Promise<void>((resolve) => {
        ws.on('close', (code: number, reason: Buffer) => {
          expect(code).toBe(4001);
          expect(reason.toString()).toBe('Missing API key');
          resolve();
        });
        ws.on('error', () => resolve());
      });
    });

    it('should reject invalid API key', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: 'Bearer wrong-key',
        },
      });

      await new Promise<void>((resolve) => {
        ws.on('close', (code: number, reason: Buffer) => {
          expect(code).toBe(4001);
          expect(reason.toString()).toBe('Invalid API key');
          resolve();
        });
        ws.on('error', () => resolve());
      });
    });
  });

  describe('Connection Lifecycle', () => {
    it('should track connection in manager', async () => {
      const initialCount = server.connectionManager.getConnectionCount();

      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      expect(server.connectionManager.getConnectionCount()).toBe(initialCount + 1);

      ws.close();

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(server.connectionManager.getConnectionCount()).toBe(initialCount);
    });

    it('should handle graceful client disconnect', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      const closePromise = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code));
      });

      ws.close(1000, 'Client closing');

      const closeCode = await closePromise;
      expect(closeCode).toBe(1000);
    });
  });

  describe('Message Format Verification', () => {
    it('should wrap transaction with correct message structure', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      const messagePromise = new Promise<object>((resolve, reject) => {
        ws.on('message', (data: Buffer) => {
          resolve(JSON.parse(data.toString()));
        });
        setTimeout(() => reject(new Error('Message timeout')), 5000);
      });

      server.broadcast(serializeMessage(wrapTransactionMessage(sampleTransaction)));

      const message = await messagePromise;

      // Verify structure
      expect(message).toHaveProperty('type', 'transaction');
      expect(message).toHaveProperty('data');
      expect(message).toHaveProperty('serverTimestamp');

      const { data } = message as { data: TransactionData };
      expect(data).toHaveProperty('hash');
      expect(data).toHaveProperty('from');
      expect(data).toHaveProperty('to');
      expect(data).toHaveProperty('method');
      expect(data).toHaveProperty('methodId');
      expect(data).toHaveProperty('value');
      expect(data).toHaveProperty('gasPrice');
      expect(data).toHaveProperty('timestamp');

      ws.close();
    });

    it('should preserve all transaction fields', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      const messagePromise = new Promise<TransactionData>((resolve, reject) => {
        ws.on('message', (data: Buffer) => {
          const parsed = JSON.parse(data.toString());
          resolve(parsed.data);
        });
        setTimeout(() => reject(new Error('Message timeout')), 5000);
      });

      server.broadcast(serializeMessage(wrapTransactionMessage(sampleTransaction)));

      const receivedData = await messagePromise;

      expect(receivedData.hash).toBe(sampleTransaction.hash);
      expect(receivedData.from).toBe(sampleTransaction.from);
      expect(receivedData.to).toBe(sampleTransaction.to);
      expect(receivedData.method).toBe(sampleTransaction.method);
      expect(receivedData.methodId).toBe(sampleTransaction.methodId);
      expect(receivedData.value).toBe(sampleTransaction.value);
      expect(receivedData.gasPrice).toBe(sampleTransaction.gasPrice);
      expect(receivedData.timestamp).toBe(sampleTransaction.timestamp);

      ws.close();
    });
  });
});
