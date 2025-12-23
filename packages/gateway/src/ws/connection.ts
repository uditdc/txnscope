/**
 * WebSocket Connection Management
 *
 * Handles connection tracking, buffer monitoring, and slow client draining.
 */

import { EventEmitter } from 'events';

/** Maximum buffer size before client is disconnected (5MB) */
export const MAX_BUFFER_SIZE = 5 * 1024 * 1024;

/** Warning threshold before max buffer (4MB) */
export const BUFFER_WARNING_THRESHOLD = 4 * 1024 * 1024;

export interface ConnectionStats {
  id: string;
  connectedAt: number;
  bufferSize: number;
  messagesSent: number;
  lastMessageAt: number;
}

export interface ConnectionEvents {
  disconnect: (id: string, reason: string) => void;
  warning: (id: string, bufferSize: number) => void;
}

export class ConnectionManager extends EventEmitter {
  private connections: Map<string, ConnectionStats> = new Map();

  /**
   * Register a new connection
   * @param id - Unique connection identifier
   */
  addConnection(id: string): void {
    this.connections.set(id, {
      id,
      connectedAt: Date.now(),
      bufferSize: 0,
      messagesSent: 0,
      lastMessageAt: Date.now(),
    });
  }

  /**
   * Remove a connection
   * @param id - Connection identifier to remove
   */
  removeConnection(id: string): void {
    this.connections.delete(id);
  }

  /**
   * Get connection stats
   * @param id - Connection identifier
   * @returns Connection stats or undefined if not found
   */
  getConnection(id: string): ConnectionStats | undefined {
    return this.connections.get(id);
  }

  /**
   * Get all connection IDs
   */
  getConnectionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get total number of connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Update buffer size for a connection
   * @param id - Connection identifier
   * @param size - New buffer size in bytes
   * @returns true if connection should be dropped
   */
  updateBufferSize(id: string, size: number): boolean {
    const conn = this.connections.get(id);
    if (!conn) {
      return false;
    }

    conn.bufferSize = size;

    // Check if buffer exceeds warning threshold
    if (size > BUFFER_WARNING_THRESHOLD && size <= MAX_BUFFER_SIZE) {
      this.emit('warning', id, size);
    }

    // Check if buffer exceeds maximum
    if (size > MAX_BUFFER_SIZE) {
      this.emit('disconnect', id, 'Buffer overflow');
      return true;
    }

    return false;
  }

  /**
   * Record a message sent to a connection
   * @param id - Connection identifier
   * @param messageSize - Size of message in bytes
   */
  recordMessageSent(id: string, messageSize: number): void {
    const conn = this.connections.get(id);
    if (conn) {
      conn.messagesSent++;
      conn.lastMessageAt = Date.now();
      conn.bufferSize += messageSize;
    }
  }

  /**
   * Record buffer drain (messages consumed by client)
   * @param id - Connection identifier
   * @param drainedSize - Bytes drained from buffer
   */
  recordBufferDrain(id: string, drainedSize: number): void {
    const conn = this.connections.get(id);
    if (conn) {
      conn.bufferSize = Math.max(0, conn.bufferSize - drainedSize);
    }
  }

  /**
   * Check if a connection should be dropped due to slow consumption
   * @param id - Connection identifier
   * @returns true if connection should be dropped
   */
  shouldDropConnection(id: string): boolean {
    const conn = this.connections.get(id);
    if (!conn) {
      return false;
    }

    return conn.bufferSize > MAX_BUFFER_SIZE;
  }

  /**
   * Get connections with high buffer usage
   * @param threshold - Buffer size threshold (default: warning threshold)
   * @returns Array of connection stats above threshold
   */
  getHighBufferConnections(threshold: number = BUFFER_WARNING_THRESHOLD): ConnectionStats[] {
    return Array.from(this.connections.values()).filter(
      (conn) => conn.bufferSize > threshold
    );
  }

  /**
   * Clean up all connections
   */
  cleanup(): void {
    for (const id of this.connections.keys()) {
      this.emit('disconnect', id, 'Server shutdown');
    }
    this.connections.clear();
  }
}

/**
 * Calculate buffer size from message
 * @param message - String message
 * @returns Size in bytes
 */
export function calculateBufferSize(message: string): number {
  return Buffer.byteLength(message, 'utf8');
}
