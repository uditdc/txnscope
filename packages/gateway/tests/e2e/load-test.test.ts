import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import { authenticate, parseApiKeys } from '../../src/auth/apikey';
import {
  wrapTransactionMessage,
  serializeMessage,
  type TransactionData,
} from '../../src/ws/message';
import { ConnectionManager, calculateBufferSize } from '../../src/ws/connection';

const TEST_API_KEY = 'load-test-key-12345';
const TEST_PORT = 9878;

/**
 * Create a load test server
 */
async function createLoadTestServer(): Promise<{
  app: FastifyInstance;
  broadcast: (message: string) => void;
  getClientCount: () => number;
  connectionManager: ConnectionManager;
}> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  const allowedKeys = parseApiKeys(TEST_API_KEY);
  const connectionManager = new ConnectionManager();
  const clients: Map<string, WebSocket> = new Map();

  app.get('/health', async () => {
    return { status: 'ok', connections: clients.size, timestamp: Date.now() };
  });

  const broadcast = (message: string) => {
    const messageSize = calculateBufferSize(message);
    for (const [id, ws] of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        connectionManager.recordMessageSent(id, messageSize);
      }
    }
  };

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

  return {
    app,
    broadcast,
    getClientCount: () => clients.size,
    connectionManager,
  };
}

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

describe('E2E Load Testing', () => {
  let server: ReturnType<typeof createLoadTestServer> extends Promise<infer T> ? T : never;
  let wsUrl: string;

  beforeAll(async () => {
    server = await createLoadTestServer();
    await server.app.listen({ port: TEST_PORT, host: '127.0.0.1' });
    wsUrl = `ws://127.0.0.1:${TEST_PORT}`;
  });

  afterAll(async () => {
    await server.app.close();
  });

  describe('Concurrent Connections', () => {
    it('should handle 100 concurrent WebSocket connections', async () => {
      const connectionCount = 100;
      const connections: WebSocket[] = [];

      // Create all connections
      const connectionPromises = [];
      for (let i = 0; i < connectionCount; i++) {
        const ws = new WebSocket(`${wsUrl}/v1/stream`, {
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
          },
        });
        connections.push(ws);

        connectionPromises.push(
          new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
            setTimeout(() => reject(new Error(`Connection ${i} timeout`)), 10000);
          })
        );
      }

      // Wait for all connections
      await Promise.all(connectionPromises);

      // Verify all are connected
      expect(server.getClientCount()).toBe(connectionCount);

      for (const ws of connections) {
        expect(ws.readyState).toBe(WebSocket.OPEN);
      }

      // Broadcast a message to all
      const message = serializeMessage(wrapTransactionMessage(sampleTransaction));
      server.broadcast(message);

      // Wait for messages to be received
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Clean up
      for (const ws of connections) {
        ws.close();
      }

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(server.getClientCount()).toBe(0);
    }, 30000);

    it('should maintain connection stability under rapid connect/disconnect', async () => {
      const iterations = 50;
      const concurrentConnections = 10;

      for (let iter = 0; iter < iterations; iter++) {
        const connections: WebSocket[] = [];
        const connectionPromises = [];

        // Create connections
        for (let i = 0; i < concurrentConnections; i++) {
          const ws = new WebSocket(`${wsUrl}/v1/stream`, {
            headers: {
              Authorization: `Bearer ${TEST_API_KEY}`,
            },
          });
          connections.push(ws);

          connectionPromises.push(
            new Promise<void>((resolve, reject) => {
              ws.on('open', resolve);
              ws.on('error', reject);
              setTimeout(() => reject(new Error(`Timeout iter ${iter} conn ${i}`)), 5000);
            })
          );
        }

        await Promise.all(connectionPromises);
        expect(connections.every((ws) => ws.readyState === WebSocket.OPEN)).toBe(true);

        // Close all connections
        for (const ws of connections) {
          ws.close();
        }
      }
    }, 60000);
  });

  describe('High Throughput', () => {
    it('should handle 1000 messages per second', async () => {
      const clientCount = 10;
      const connections: WebSocket[] = [];
      const receivedCounts: number[] = new Array(clientCount).fill(0);

      // Create connections
      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(`${wsUrl}/v1/stream`, {
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
          },
        });
        connections.push(ws);

        const clientIndex = i;
        ws.on('message', () => {
          receivedCounts[clientIndex]++;
        });
      }

      // Wait for all to connect
      await Promise.all(
        connections.map(
          (ws) =>
            new Promise<void>((resolve, reject) => {
              ws.on('open', resolve);
              ws.on('error', reject);
              setTimeout(() => reject(new Error('Connection timeout')), 5000);
            })
        )
      );

      // Send 1000 messages
      const messageCount = 1000;
      const startTime = Date.now();

      for (let i = 0; i < messageCount; i++) {
        const tx = { ...sampleTransaction, hash: `0x${i.toString(16).padStart(64, '0')}` };
        server.broadcast(serializeMessage(wrapTransactionMessage(tx)));
      }

      // Wait for all messages to be delivered
      await new Promise((resolve) => setTimeout(resolve, 500));

      const elapsedMs = Date.now() - startTime;
      const totalReceived = receivedCounts.reduce((a, b) => a + b, 0);
      const expectedTotal = messageCount * clientCount;
      const messagesPerSecond = (messageCount / elapsedMs) * 1000;

      console.log(`Throughput: ${messagesPerSecond.toFixed(0)} messages/second`);
      console.log(`Total messages delivered: ${totalReceived} / ${expectedTotal}`);

      expect(totalReceived).toBe(expectedTotal);
      expect(messagesPerSecond).toBeGreaterThanOrEqual(1000);

      // Cleanup
      for (const ws of connections) {
        ws.close();
      }
    }, 30000);

    it('should handle burst of 500 messages instantly', async () => {
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

      const burstSize = 500;
      let receivedCount = 0;

      ws.on('message', () => {
        receivedCount++;
      });

      const startTime = Date.now();

      // Send burst
      for (let i = 0; i < burstSize; i++) {
        const tx = { ...sampleTransaction, hash: `0x${i.toString(16).padStart(64, '0')}` };
        server.broadcast(serializeMessage(wrapTransactionMessage(tx)));
      }

      // Wait for delivery
      await new Promise((resolve) => setTimeout(resolve, 200));

      const elapsedMs = Date.now() - startTime;
      console.log(`Burst of ${burstSize} messages completed in ${elapsedMs}ms`);

      expect(receivedCount).toBe(burstSize);
      expect(elapsedMs).toBeLessThan(1000);

      ws.close();
    });
  });

  describe('Connection Management Under Load', () => {
    it('should properly track buffer sizes for multiple clients', async () => {
      const clientCount = 20;
      const connections: WebSocket[] = [];

      // Create connections
      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(`${wsUrl}/v1/stream`, {
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
          },
        });
        connections.push(ws);
      }

      await Promise.all(
        connections.map(
          (ws) =>
            new Promise<void>((resolve, reject) => {
              ws.on('open', resolve);
              ws.on('error', reject);
              setTimeout(() => reject(new Error('Connection timeout')), 5000);
            })
        )
      );

      // Broadcast messages
      for (let i = 0; i < 100; i++) {
        server.broadcast(serializeMessage(wrapTransactionMessage(sampleTransaction)));
      }

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check connection manager stats
      const ids = server.connectionManager.getConnectionIds();
      expect(ids.length).toBe(clientCount);

      // Each connection should have received 100 messages
      for (const id of ids) {
        const stats = server.connectionManager.getConnection(id);
        expect(stats?.messagesSent).toBe(100);
        expect(stats?.bufferSize).toBeGreaterThan(0);
      }

      // Cleanup
      for (const ws of connections) {
        ws.close();
      }
    });

    it('should handle slow client disconnection', async () => {
      // Create a "slow" client that never reads messages
      const slowWs = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        slowWs.on('open', resolve);
        slowWs.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      const ids = server.connectionManager.getConnectionIds();
      const slowClientId = ids[ids.length - 1];

      // Send many large messages to build up buffer
      const largeMessage = JSON.stringify({
        type: 'transaction',
        data: {
          ...sampleTransaction,
          extraData: 'x'.repeat(10000), // ~10KB message
        },
      });

      for (let i = 0; i < 100; i++) {
        server.broadcast(largeMessage);
      }

      // Check buffer size increased
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = server.connectionManager.getConnection(slowClientId);
      expect(stats?.bufferSize).toBeGreaterThan(0);

      slowWs.close();
    });
  });

  describe('Memory Stability', () => {
    it('should not leak memory under sustained load', async () => {
      const clientCount = 10;
      const messageCount = 500;
      const connections: WebSocket[] = [];

      // Create connections
      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(`${wsUrl}/v1/stream`, {
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
          },
        });
        connections.push(ws);

        // Consume all messages
        ws.on('message', () => {
          // Message consumed
        });
      }

      await Promise.all(
        connections.map(
          (ws) =>
            new Promise<void>((resolve, reject) => {
              ws.on('open', resolve);
              ws.on('error', reject);
              setTimeout(() => reject(new Error('Connection timeout')), 5000);
            })
        )
      );

      const initialMemory = process.memoryUsage().heapUsed;

      // Send many messages
      for (let i = 0; i < messageCount; i++) {
        const tx = { ...sampleTransaction, hash: `0x${i.toString(16).padStart(64, '0')}` };
        server.broadcast(serializeMessage(wrapTransactionMessage(tx)));
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Force GC if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;
      const memoryGrowthMB = memoryGrowth / (1024 * 1024);

      console.log(`Memory growth: ${memoryGrowthMB.toFixed(2)} MB`);

      // Memory growth should be reasonable (less than 50MB for this test)
      // Note: This is a soft check as memory measurement is imprecise
      expect(memoryGrowthMB).toBeLessThan(50);

      // Cleanup
      for (const ws of connections) {
        ws.close();
      }
    });

    it('should clean up resources after client disconnect', async () => {
      // Create and close many connections
      for (let i = 0; i < 50; i++) {
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

        ws.close();

        // Wait for cleanup
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // All connections from this test should be cleaned up (none remaining from this test)
      // Server should still be functional
      expect(server.connectionManager.getConnectionCount()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message gracefully', async () => {
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

      // Server should handle empty broadcast without crashing
      server.broadcast('');

      // Send a real message after
      server.broadcast(serializeMessage(wrapTransactionMessage(sampleTransaction)));

      let messageReceived = false;
      ws.on('message', () => {
        messageReceived = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still receive the valid message
      expect(messageReceived).toBe(true);

      ws.close();
    });

    it('should handle very large messages', async () => {
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

      // Create a large message (~100KB)
      const largeMessage = JSON.stringify({
        type: 'transaction',
        data: {
          ...sampleTransaction,
          extraData: 'x'.repeat(100000),
        },
      });

      let messageReceived = false;
      ws.on('message', (data: Buffer) => {
        messageReceived = true;
        expect(data.length).toBeGreaterThan(100000);
      });

      server.broadcast(largeMessage);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(messageReceived).toBe(true);

      ws.close();
    });
  });
});
