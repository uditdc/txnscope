import { describe, it, expect } from 'vitest';
import {
  parseApiKeys,
  extractFromHeader,
  extractFromQuery,
  validateKey,
  authenticate,
} from '../../src/auth/apikey';

describe('API Key Authentication', () => {
  describe('parseApiKeys', () => {
    it('should parse comma-separated keys', () => {
      const keys = parseApiKeys('key1,key2,key3');
      expect(keys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should trim whitespace from keys', () => {
      const keys = parseApiKeys('  key1  ,  key2  ,  key3  ');
      expect(keys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should filter empty keys', () => {
      const keys = parseApiKeys('key1,,key2,  ,key3');
      expect(keys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should return empty array for undefined input', () => {
      const keys = parseApiKeys(undefined);
      expect(keys).toEqual([]);
    });

    it('should return empty array for empty string', () => {
      const keys = parseApiKeys('');
      expect(keys).toEqual([]);
    });
  });

  describe('extractFromHeader', () => {
    it('should extract key from valid Bearer token', () => {
      const key = extractFromHeader('Bearer my-api-key');
      expect(key).toBe('my-api-key');
    });

    it('should return undefined for missing header', () => {
      const key = extractFromHeader(undefined);
      expect(key).toBeUndefined();
    });

    it('should return undefined for empty header', () => {
      const key = extractFromHeader('');
      expect(key).toBeUndefined();
    });

    it('should return undefined for malformed Bearer token - missing Bearer', () => {
      const key = extractFromHeader('my-api-key');
      expect(key).toBeUndefined();
    });

    it('should return undefined for malformed Bearer token - wrong prefix', () => {
      const key = extractFromHeader('Basic my-api-key');
      expect(key).toBeUndefined();
    });

    it('should return undefined for Bearer without key', () => {
      const key = extractFromHeader('Bearer');
      expect(key).toBeUndefined();
    });

    it('should return undefined for Bearer with empty key', () => {
      const key = extractFromHeader('Bearer   ');
      expect(key).toBeUndefined();
    });

    it('should handle key with spaces', () => {
      const key = extractFromHeader('Bearer key-with-spaces');
      expect(key).toBe('key-with-spaces');
    });
  });

  describe('extractFromQuery', () => {
    it('should extract key from query parameter', () => {
      const key = extractFromQuery({ api_key: 'my-api-key' });
      expect(key).toBe('my-api-key');
    });

    it('should return undefined for missing api_key', () => {
      const key = extractFromQuery({});
      expect(key).toBeUndefined();
    });

    it('should return undefined for undefined api_key', () => {
      const key = extractFromQuery({ api_key: undefined });
      expect(key).toBeUndefined();
    });

    it('should return undefined for empty api_key', () => {
      const key = extractFromQuery({ api_key: '' });
      expect(key).toBeUndefined();
    });

    it('should return undefined for whitespace-only api_key', () => {
      const key = extractFromQuery({ api_key: '   ' });
      expect(key).toBeUndefined();
    });

    it('should trim whitespace from key', () => {
      const key = extractFromQuery({ api_key: '  my-key  ' });
      expect(key).toBe('my-key');
    });
  });

  describe('validateKey', () => {
    const allowedKeys = ['key1', 'key2', 'test-key-3'];

    it('should accept valid API key from list', () => {
      expect(validateKey('key1', allowedKeys)).toBe(true);
      expect(validateKey('key2', allowedKeys)).toBe(true);
      expect(validateKey('test-key-3', allowedKeys)).toBe(true);
    });

    it('should reject invalid API key', () => {
      expect(validateKey('invalid-key', allowedKeys)).toBe(false);
    });

    it('should reject undefined key', () => {
      expect(validateKey(undefined, allowedKeys)).toBe(false);
    });

    it('should reject empty key', () => {
      expect(validateKey('', allowedKeys)).toBe(false);
    });

    it('should be case-sensitive for keys', () => {
      expect(validateKey('KEY1', allowedKeys)).toBe(false);
      expect(validateKey('Key1', allowedKeys)).toBe(false);
    });

    it('should not match partial keys', () => {
      expect(validateKey('key', allowedKeys)).toBe(false);
      expect(validateKey('key12', allowedKeys)).toBe(false);
    });
  });

  describe('authenticate', () => {
    const allowedKeys = ['valid-key-1', 'valid-key-2', 'test-api-key'];

    it('should accept valid API key from header', () => {
      const result = authenticate('Bearer valid-key-1', {}, allowedKeys);
      expect(result.authenticated).toBe(true);
      expect(result.key).toBe('valid-key-1');
      expect(result.error).toBeUndefined();
    });

    it('should accept valid API key from query parameter', () => {
      const result = authenticate(undefined, { api_key: 'valid-key-2' }, allowedKeys);
      expect(result.authenticated).toBe(true);
      expect(result.key).toBe('valid-key-2');
    });

    it('should prefer header over query parameter', () => {
      const result = authenticate(
        'Bearer valid-key-1',
        { api_key: 'valid-key-2' },
        allowedKeys
      );
      expect(result.key).toBe('valid-key-1');
    });

    it('should reject invalid API key', () => {
      const result = authenticate('Bearer invalid-key', {}, allowedKeys);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should reject missing API key', () => {
      const result = authenticate(undefined, {}, allowedKeys);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Missing API key');
    });

    it('should reject empty API key in header', () => {
      const result = authenticate('Bearer ', {}, allowedKeys);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Missing API key');
    });

    it('should reject malformed Bearer token', () => {
      const result = authenticate('BasicAuth my-key', {}, allowedKeys);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Missing API key');
    });

    it('should handle multiple valid keys', () => {
      expect(authenticate('Bearer valid-key-1', {}, allowedKeys).authenticated).toBe(true);
      expect(authenticate('Bearer valid-key-2', {}, allowedKeys).authenticated).toBe(true);
      expect(authenticate('Bearer test-api-key', {}, allowedKeys).authenticated).toBe(true);
    });

    it('should be case-sensitive', () => {
      const result = authenticate('Bearer VALID-KEY-1', {}, allowedKeys);
      expect(result.authenticated).toBe(false);
    });
  });
});
