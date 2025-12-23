/**
 * WebSocket Message Formatting
 *
 * Handles formatting of messages sent to WebSocket clients.
 */

export interface TransactionData {
  hash: string;
  from: string;
  to: string;
  method: string;
  methodId: string;
  value: string;
  gasPrice: string;
  timestamp: number;
}

export interface TransactionMessage {
  type: 'transaction';
  data: TransactionData;
  serverTimestamp: number;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp: number;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
  timestamp: number;
}

export type WebSocketMessage = TransactionMessage | HeartbeatMessage | ErrorMessage;

/**
 * Wrap a Redis transaction message for WebSocket delivery
 * @param redisMessage - Raw transaction data from Redis
 * @returns Formatted WebSocket message
 */
export function wrapTransactionMessage(redisMessage: TransactionData): TransactionMessage {
  return {
    type: 'transaction',
    data: redisMessage,
    serverTimestamp: Date.now(),
  };
}

/**
 * Create a heartbeat message
 * @returns Heartbeat message with current timestamp
 */
export function createHeartbeatMessage(): HeartbeatMessage {
  return {
    type: 'heartbeat',
    timestamp: Date.now(),
  };
}

/**
 * Create an error message
 * @param code - Error code
 * @param message - Error description
 * @returns Error message
 */
export function createErrorMessage(code: string, message: string): ErrorMessage {
  return {
    type: 'error',
    code,
    message,
    timestamp: Date.now(),
  };
}

/**
 * Serialize a message to JSON string
 * @param message - WebSocket message to serialize
 * @returns JSON string
 */
export function serializeMessage(message: WebSocketMessage): string {
  return JSON.stringify(message);
}

/**
 * Parse a Redis message JSON string to TransactionData
 * @param json - JSON string from Redis
 * @returns Parsed transaction data
 * @throws Error if parsing fails
 */
export function parseRedisMessage(json: string): TransactionData {
  const data = JSON.parse(json);

  // Validate required fields
  const requiredFields = ['hash', 'from', 'to', 'method', 'methodId', 'value', 'gasPrice', 'timestamp'];
  for (const field of requiredFields) {
    if (!(field in data)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  return data as TransactionData;
}

/**
 * Validate that a transaction message has all required fields
 * @param data - Transaction data to validate
 * @returns true if valid
 */
export function validateTransactionData(data: unknown): data is TransactionData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const tx = data as Record<string, unknown>;

  return (
    typeof tx.hash === 'string' &&
    typeof tx.from === 'string' &&
    typeof tx.to === 'string' &&
    typeof tx.method === 'string' &&
    typeof tx.methodId === 'string' &&
    typeof tx.value === 'string' &&
    typeof tx.gasPrice === 'string' &&
    typeof tx.timestamp === 'number'
  );
}
