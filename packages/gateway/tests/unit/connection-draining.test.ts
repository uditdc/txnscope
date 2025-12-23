import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConnectionManager,
  MAX_BUFFER_SIZE,
  BUFFER_WARNING_THRESHOLD,
  calculateBufferSize,
} from '../../src/ws/connection';

describe('Connection Draining', () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager();
  });

  describe('Connection Management', () => {
    it('should add and track connections', () => {
      manager.addConnection('client-1');
      expect(manager.getConnectionCount()).toBe(1);
      expect(manager.getConnection('client-1')).toBeDefined();
    });

    it('should remove connections', () => {
      manager.addConnection('client-1');
      manager.removeConnection('client-1');
      expect(manager.getConnectionCount()).toBe(0);
      expect(manager.getConnection('client-1')).toBeUndefined();
    });

    it('should get all connection IDs', () => {
      manager.addConnection('client-1');
      manager.addConnection('client-2');
      manager.addConnection('client-3');

      const ids = manager.getConnectionIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain('client-1');
      expect(ids).toContain('client-2');
      expect(ids).toContain('client-3');
    });

    it('should track connection stats', () => {
      manager.addConnection('client-1');
      const stats = manager.getConnection('client-1');

      expect(stats).toBeDefined();
      expect(stats?.id).toBe('client-1');
      expect(stats?.bufferSize).toBe(0);
      expect(stats?.messagesSent).toBe(0);
      expect(stats?.connectedAt).toBeDefined();
    });
  });

  describe('Buffer Tracking', () => {
    it('should track buffer size per client', () => {
      manager.addConnection('client-1');
      manager.updateBufferSize('client-1', 1000);

      const stats = manager.getConnection('client-1');
      expect(stats?.bufferSize).toBe(1000);
    });

    it('should return false for normal buffer sizes', () => {
      manager.addConnection('client-1');
      const shouldDrop = manager.updateBufferSize('client-1', 1000);
      expect(shouldDrop).toBe(false);
    });

    it('should return true when buffer exceeds 5MB', () => {
      manager.addConnection('client-1');
      const shouldDrop = manager.updateBufferSize('client-1', MAX_BUFFER_SIZE + 1);
      expect(shouldDrop).toBe(true);
    });

    it('should emit disconnect event when buffer exceeds limit', () => {
      manager.addConnection('client-1');
      const disconnectSpy = vi.fn();
      manager.on('disconnect', disconnectSpy);

      manager.updateBufferSize('client-1', MAX_BUFFER_SIZE + 1);

      expect(disconnectSpy).toHaveBeenCalledWith('client-1', 'Buffer overflow');
    });

    it('should emit warning event at warning threshold', () => {
      manager.addConnection('client-1');
      const warningSpy = vi.fn();
      manager.on('warning', warningSpy);

      manager.updateBufferSize('client-1', BUFFER_WARNING_THRESHOLD + 1);

      expect(warningSpy).toHaveBeenCalledWith('client-1', BUFFER_WARNING_THRESHOLD + 1);
    });

    it('should not emit warning at max buffer (emit disconnect instead)', () => {
      manager.addConnection('client-1');
      const warningSpy = vi.fn();
      manager.on('warning', warningSpy);

      manager.updateBufferSize('client-1', MAX_BUFFER_SIZE + 1);

      // Warning should not be emitted when we're already at disconnect level
      expect(warningSpy).not.toHaveBeenCalled();
    });
  });

  describe('Message Tracking', () => {
    it('should record messages sent', () => {
      manager.addConnection('client-1');
      manager.recordMessageSent('client-1', 100);
      manager.recordMessageSent('client-1', 200);

      const stats = manager.getConnection('client-1');
      expect(stats?.messagesSent).toBe(2);
      expect(stats?.bufferSize).toBe(300);
    });

    it('should update lastMessageAt timestamp', () => {
      manager.addConnection('client-1');
      const before = Date.now();

      manager.recordMessageSent('client-1', 100);

      const stats = manager.getConnection('client-1');
      expect(stats?.lastMessageAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('Buffer Drain', () => {
    it('should reduce buffer size on drain', () => {
      manager.addConnection('client-1');
      manager.updateBufferSize('client-1', 1000);
      manager.recordBufferDrain('client-1', 300);

      const stats = manager.getConnection('client-1');
      expect(stats?.bufferSize).toBe(700);
    });

    it('should not go below zero on drain', () => {
      manager.addConnection('client-1');
      manager.updateBufferSize('client-1', 100);
      manager.recordBufferDrain('client-1', 500);

      const stats = manager.getConnection('client-1');
      expect(stats?.bufferSize).toBe(0);
    });
  });

  describe('Slow Client Detection', () => {
    it('should identify clients that need to be dropped', () => {
      manager.addConnection('client-1');
      manager.updateBufferSize('client-1', MAX_BUFFER_SIZE + 1);

      expect(manager.shouldDropConnection('client-1')).toBe(true);
    });

    it('should not flag healthy clients for dropping', () => {
      manager.addConnection('client-1');
      manager.updateBufferSize('client-1', 1000);

      expect(manager.shouldDropConnection('client-1')).toBe(false);
    });

    it('should return false for unknown connections', () => {
      expect(manager.shouldDropConnection('unknown')).toBe(false);
    });

    it('should detect gradual buffer buildup', () => {
      manager.addConnection('client-1');

      // Simulate gradual buildup
      for (let i = 0; i < 100; i++) {
        manager.recordMessageSent('client-1', 60000); // 60KB each
      }

      // Should exceed 5MB after 100 * 60KB = 6MB
      expect(manager.shouldDropConnection('client-1')).toBe(true);
    });
  });

  describe('High Buffer Connections', () => {
    it('should return connections above threshold', () => {
      manager.addConnection('fast-client');
      manager.addConnection('slow-client');

      manager.updateBufferSize('fast-client', 1000);
      manager.updateBufferSize('slow-client', BUFFER_WARNING_THRESHOLD + 1);

      const highBuffer = manager.getHighBufferConnections();
      expect(highBuffer).toHaveLength(1);
      expect(highBuffer[0].id).toBe('slow-client');
    });

    it('should support custom threshold', () => {
      manager.addConnection('client-1');
      manager.addConnection('client-2');

      manager.updateBufferSize('client-1', 500);
      manager.updateBufferSize('client-2', 1500);

      const highBuffer = manager.getHighBufferConnections(1000);
      expect(highBuffer).toHaveLength(1);
      expect(highBuffer[0].id).toBe('client-2');
    });
  });

  describe('Cleanup', () => {
    it('should emit disconnect for all connections on cleanup', () => {
      manager.addConnection('client-1');
      manager.addConnection('client-2');

      const disconnectSpy = vi.fn();
      manager.on('disconnect', disconnectSpy);

      manager.cleanup();

      expect(disconnectSpy).toHaveBeenCalledTimes(2);
      expect(disconnectSpy).toHaveBeenCalledWith('client-1', 'Server shutdown');
      expect(disconnectSpy).toHaveBeenCalledWith('client-2', 'Server shutdown');
    });

    it('should clear all connections after cleanup', () => {
      manager.addConnection('client-1');
      manager.addConnection('client-2');

      manager.cleanup();

      expect(manager.getConnectionCount()).toBe(0);
    });
  });

  describe('calculateBufferSize', () => {
    it('should calculate size for ASCII string', () => {
      const size = calculateBufferSize('hello');
      expect(size).toBe(5);
    });

    it('should calculate size for UTF-8 string', () => {
      const size = calculateBufferSize('héllo');
      expect(size).toBe(6); // é is 2 bytes in UTF-8
    });

    it('should calculate size for JSON', () => {
      const json = JSON.stringify({ hash: '0x123', value: '1000' });
      const size = calculateBufferSize(json);
      expect(size).toBe(json.length); // ASCII-only JSON
    });

    it('should return 0 for empty string', () => {
      const size = calculateBufferSize('');
      expect(size).toBe(0);
    });
  });

  describe('Constants', () => {
    it('should have MAX_BUFFER_SIZE at 5MB', () => {
      expect(MAX_BUFFER_SIZE).toBe(5 * 1024 * 1024);
    });

    it('should have BUFFER_WARNING_THRESHOLD at 4MB', () => {
      expect(BUFFER_WARNING_THRESHOLD).toBe(4 * 1024 * 1024);
    });

    it('should have warning threshold less than max', () => {
      expect(BUFFER_WARNING_THRESHOLD).toBeLessThan(MAX_BUFFER_SIZE);
    });
  });
});
