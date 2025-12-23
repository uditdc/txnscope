import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  wrapTransactionMessage,
  createHeartbeatMessage,
  createErrorMessage,
  serializeMessage,
  parseRedisMessage,
  validateTransactionData,
  type TransactionData,
} from '../../src/ws/message';

describe('Message Formatting', () => {
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

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('wrapTransactionMessage', () => {
    it('should wrap Redis message with type field', () => {
      const message = wrapTransactionMessage(sampleTransaction);
      expect(message.type).toBe('transaction');
    });

    it('should preserve all original fields', () => {
      const message = wrapTransactionMessage(sampleTransaction);
      expect(message.data).toEqual(sampleTransaction);
    });

    it('should include serverTimestamp', () => {
      const message = wrapTransactionMessage(sampleTransaction);
      expect(message.serverTimestamp).toBe(Date.now());
    });

    it('should not modify original data', () => {
      const original = { ...sampleTransaction };
      wrapTransactionMessage(sampleTransaction);
      expect(sampleTransaction).toEqual(original);
    });
  });

  describe('createHeartbeatMessage', () => {
    it('should create heartbeat with type field', () => {
      const message = createHeartbeatMessage();
      expect(message.type).toBe('heartbeat');
    });

    it('should include current timestamp', () => {
      const message = createHeartbeatMessage();
      expect(message.timestamp).toBe(Date.now());
    });
  });

  describe('createErrorMessage', () => {
    it('should create error message with all fields', () => {
      const message = createErrorMessage('AUTH_FAILED', 'Invalid API key');
      expect(message.type).toBe('error');
      expect(message.code).toBe('AUTH_FAILED');
      expect(message.message).toBe('Invalid API key');
    });

    it('should include timestamp', () => {
      const message = createErrorMessage('ERROR', 'Test');
      expect(message.timestamp).toBe(Date.now());
    });
  });

  describe('serializeMessage', () => {
    it('should stringify transaction message as valid JSON', () => {
      const message = wrapTransactionMessage(sampleTransaction);
      const json = serializeMessage(message);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should preserve all fields in JSON', () => {
      const message = wrapTransactionMessage(sampleTransaction);
      const json = serializeMessage(message);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe('transaction');
      expect(parsed.data.hash).toBe(sampleTransaction.hash);
      expect(parsed.data.from).toBe(sampleTransaction.from);
      expect(parsed.data.to).toBe(sampleTransaction.to);
      expect(parsed.data.method).toBe(sampleTransaction.method);
      expect(parsed.data.methodId).toBe(sampleTransaction.methodId);
      expect(parsed.data.value).toBe(sampleTransaction.value);
      expect(parsed.data.gasPrice).toBe(sampleTransaction.gasPrice);
    });

    it('should handle heartbeat messages', () => {
      const message = createHeartbeatMessage();
      const json = serializeMessage(message);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe('heartbeat');
      expect(parsed.timestamp).toBeDefined();
    });

    it('should handle error messages', () => {
      const message = createErrorMessage('ERR_CODE', 'Error description');
      const json = serializeMessage(message);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe('error');
      expect(parsed.code).toBe('ERR_CODE');
      expect(parsed.message).toBe('Error description');
    });
  });

  describe('parseRedisMessage', () => {
    it('should parse valid JSON from Redis', () => {
      const json = JSON.stringify(sampleTransaction);
      const data = parseRedisMessage(json);

      expect(data.hash).toBe(sampleTransaction.hash);
      expect(data.method).toBe(sampleTransaction.method);
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseRedisMessage('not valid json')).toThrow();
    });

    it('should throw on missing required fields', () => {
      const incomplete = { hash: '0x123' };
      const json = JSON.stringify(incomplete);

      expect(() => parseRedisMessage(json)).toThrow('Missing required field');
    });

    it('should handle special characters in addresses', () => {
      const tx = { ...sampleTransaction, from: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12' };
      const json = JSON.stringify(tx);
      const data = parseRedisMessage(json);

      expect(data.from).toBe(tx.from);
    });

    it('should handle very large transaction values', () => {
      const tx = { ...sampleTransaction, value: '999999999999999999999999999999' };
      const json = JSON.stringify(tx);
      const data = parseRedisMessage(json);

      expect(data.value).toBe(tx.value);
    });
  });

  describe('validateTransactionData', () => {
    it('should return true for valid transaction data', () => {
      expect(validateTransactionData(sampleTransaction)).toBe(true);
    });

    it('should return false for null', () => {
      expect(validateTransactionData(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(validateTransactionData(undefined)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(validateTransactionData('string')).toBe(false);
      expect(validateTransactionData(123)).toBe(false);
      expect(validateTransactionData([])).toBe(false);
    });

    it('should return false for missing hash', () => {
      const { hash, ...rest } = sampleTransaction;
      expect(validateTransactionData(rest)).toBe(false);
    });

    it('should return false for missing from', () => {
      const { from, ...rest } = sampleTransaction;
      expect(validateTransactionData(rest)).toBe(false);
    });

    it('should return false for missing method', () => {
      const { method, ...rest } = sampleTransaction;
      expect(validateTransactionData(rest)).toBe(false);
    });

    it('should return false for wrong type - hash as number', () => {
      const invalid = { ...sampleTransaction, hash: 12345 };
      expect(validateTransactionData(invalid)).toBe(false);
    });

    it('should return false for wrong type - timestamp as string', () => {
      const invalid = { ...sampleTransaction, timestamp: '12345' };
      expect(validateTransactionData(invalid)).toBe(false);
    });
  });
});
