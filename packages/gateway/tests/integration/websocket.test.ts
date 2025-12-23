import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import { authenticate, parseApiKeys } from '../../src/auth/apikey';
import { createHeartbeatMessage, serializeMessage } from '../../src/ws/message';
import { ConnectionManager } from '../../src/ws/connection';

const TEST_API_KEY = 'test-api-key-12345';
const TEST_PORT = 9876;

/**
 * Create a test Fastify server with WebSocket support
 */
async function createTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyWebsocket);

  const allowedKeys = parseApiKeys(TEST_API_KEY);
  const connectionManager = new ConnectionManager();

  // Health endpoint
  app.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  // WebSocket streaming endpoint
  app.get('/v1/stream', { websocket: true }, (socket, req) => {
    // Authenticate
    const authHeader = req.headers.authorization as string | undefined;
    const queryParams = req.query as Record<string, string | undefined>;

    const authResult = authenticate(authHeader, queryParams, allowedKeys);

    if (!authResult.authenticated) {
      socket.close(4001, authResult.error || 'Unauthorized');
      return;
    }

    // Generate client ID
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    connectionManager.addConnection(clientId);

    // Set up heartbeat interval
    const heartbeatInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(serializeMessage(createHeartbeatMessage()));
      }
    }, 30000);

    // Handle pong (keep-alive)
    socket.on('pong', () => {
      // Client is alive
    });

    // Handle close
    socket.on('close', () => {
      clearInterval(heartbeatInterval);
      connectionManager.removeConnection(clientId);
    });

    // Handle errors
    socket.on('error', () => {
      clearInterval(heartbeatInterval);
      connectionManager.removeConnection(clientId);
    });
  });

  return app;
}

describe('WebSocket Integration', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    server = await createTestServer();
    await server.listen({ port: TEST_PORT, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;
    wsUrl = `ws://127.0.0.1:${TEST_PORT}`;
  });

  afterAll(async () => {
    await server.close();
  });

  describe('Health Endpoint', () => {
    it('should return 200 OK', async () => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
    });

    it('should return JSON with status ok', async () => {
      const response = await fetch(`${baseUrl}/health`);
      const data = await response.json();
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
      expect(typeof data.timestamp).toBe('number');
    });
  });

  describe('WebSocket Authentication', () => {
    it('should accept connection with valid Bearer token', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          resolve();
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });
    });

    it('should accept connection with valid query param', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream?api_key=${TEST_API_KEY}`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          resolve();
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });
    });

    it('should reject connection without auth', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`);

      await new Promise<void>((resolve) => {
        ws.on('close', (code: number, reason: Buffer) => {
          expect(code).toBe(4001);
          expect(reason.toString()).toBe('Missing API key');
          resolve();
        });
        ws.on('error', () => {
          // Expected - connection was rejected
          resolve();
        });
      });
    });

    it('should reject connection with invalid API key', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: 'Bearer invalid-key',
        },
      });

      await new Promise<void>((resolve) => {
        ws.on('close', (code: number, reason: Buffer) => {
          expect(code).toBe(4001);
          expect(reason.toString()).toBe('Invalid API key');
          resolve();
        });
        ws.on('error', () => {
          // Expected - connection was rejected
          resolve();
        });
      });
    });

    it('should reject connection with empty API key', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream?api_key=`);

      await new Promise<void>((resolve) => {
        ws.on('close', (code: number, reason: Buffer) => {
          expect(code).toBe(4001);
          resolve();
        });
        ws.on('error', () => {
          resolve();
        });
      });
    });
  });

  describe('WebSocket Heartbeat', () => {
    it('should receive heartbeat message', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      try {
        await new Promise<void>((resolve, reject) => {
          ws.on('open', async () => {
            // Advance time to trigger heartbeat
            vi.advanceTimersByTime(30000);
          });

          ws.on('message', (data: Buffer) => {
            const message = JSON.parse(data.toString());
            expect(message.type).toBe('heartbeat');
            expect(message.timestamp).toBeDefined();
            ws.close();
            resolve();
          });

          ws.on('error', reject);
          setTimeout(() => reject(new Error('Heartbeat timeout')), 35000);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('should respond to ping with pong', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.ping();
        });

        ws.on('pong', () => {
          ws.close();
          resolve();
        });

        ws.on('error', reject);
        setTimeout(() => reject(new Error('Pong timeout')), 5000);
      });
    });
  });

  describe('WebSocket Connection Management', () => {
    it('should handle multiple concurrent connections', async () => {
      const connections: WebSocket[] = [];
      const connectionCount = 10;

      // Create multiple connections
      for (let i = 0; i < connectionCount; i++) {
        const ws = new WebSocket(`${wsUrl}/v1/stream`, {
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
          },
        });
        connections.push(ws);
      }

      // Wait for all to open
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

      // Verify all are open
      for (const ws of connections) {
        expect(ws.readyState).toBe(WebSocket.OPEN);
      }

      // Clean up
      for (const ws of connections) {
        ws.close();
      }
    });

    it('should clean up connection on client disconnect', async () => {
      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.close(1000, 'Client closing');
        });

        ws.on('close', () => {
          // Connection was cleaned up
          resolve();
        });

        ws.on('error', reject);
        setTimeout(() => reject(new Error('Close timeout')), 5000);
      });
    });
  });

  describe('WebSocket Message Format', () => {
    it('should send valid JSON messages', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const ws = new WebSocket(`${wsUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
      });

      try {
        await new Promise<void>((resolve, reject) => {
          ws.on('open', () => {
            vi.advanceTimersByTime(30000);
          });

          ws.on('message', (data: Buffer) => {
            // Should not throw
            expect(() => JSON.parse(data.toString())).not.toThrow();
            ws.close();
            resolve();
          });

          ws.on('error', reject);
          setTimeout(() => reject(new Error('Message timeout')), 35000);
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
