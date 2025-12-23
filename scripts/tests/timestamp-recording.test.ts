import { describe, it, expect, beforeEach } from 'vitest';

/**
 * High-precision timestamp in milliseconds
 */
function nowMillis(): number {
  return performance.now();
}

/**
 * System time in milliseconds (Unix timestamp)
 */
function nowUnixMillis(): number {
  return Date.now();
}

/**
 * Record timestamp with transaction hash
 */
interface TimestampRecord {
  txHash: string;
  receivedAt: number;
  source: string;
}

/**
 * Timestamp recorder for latency measurements
 */
class TimestampRecorder {
  private records: TimestampRecord[] = [];
  private lastTimestamp: number = 0;

  /**
   * Record a transaction arrival timestamp
   */
  record(txHash: string, source: string, timestamp?: number): TimestampRecord {
    const ts = timestamp ?? nowUnixMillis();

    // Check monotonicity
    if (ts < this.lastTimestamp) {
      console.warn(
        `Non-monotonic timestamp detected: ${ts} < ${this.lastTimestamp} (diff: ${this.lastTimestamp - ts}ms)`
      );
    }

    const record: TimestampRecord = {
      txHash,
      receivedAt: ts,
      source,
    };

    this.records.push(record);
    this.lastTimestamp = Math.max(this.lastTimestamp, ts);

    return record;
  }

  /**
   * Get all records
   */
  getRecords(): TimestampRecord[] {
    return [...this.records];
  }

  /**
   * Get records for a specific source
   */
  getRecordsBySource(source: string): TimestampRecord[] {
    return this.records.filter((r) => r.source === source);
  }

  /**
   * Get record by transaction hash
   */
  getRecordByHash(txHash: string): TimestampRecord | undefined {
    return this.records.find((r) => r.txHash === txHash);
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records = [];
    this.lastTimestamp = 0;
  }

  /**
   * Get count of records
   */
  get count(): number {
    return this.records.length;
  }
}

/**
 * Validate timestamp precision
 */
function hasMillisecondPrecision(timestamp: number): boolean {
  // Check if timestamp is in milliseconds (should be 13 digits for 2020s)
  return timestamp > 1600000000000 && timestamp < 2000000000000;
}

/**
 * Check if timestamps are monotonically increasing
 */
function isMonotonic(timestamps: number[]): boolean {
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] < timestamps[i - 1]) {
      return false;
    }
  }
  return true;
}

/**
 * Format timestamp as ISO string with milliseconds
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Parse timestamp from various formats
 */
function parseTimestamp(input: string | number): number {
  if (typeof input === 'number') {
    // Check if seconds or milliseconds
    if (input < 10000000000) {
      return input * 1000; // Convert seconds to milliseconds
    }
    return input;
  }

  // Parse ISO string
  const date = new Date(input);
  return date.getTime();
}

describe('Timestamp Recording', () => {
  describe('nowMillis (performance.now)', () => {
    it('should return a number', () => {
      const ts = nowMillis();
      expect(typeof ts).toBe('number');
    });

    it('should increase over time', async () => {
      const ts1 = nowMillis();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ts2 = nowMillis();

      expect(ts2).toBeGreaterThan(ts1);
    });

    it('should have sub-millisecond precision', () => {
      // Collect multiple readings
      const readings: number[] = [];
      for (let i = 0; i < 100; i++) {
        readings.push(nowMillis());
      }

      // At least some readings should have decimal parts
      const hasDecimals = readings.some((r) => r !== Math.floor(r));
      expect(hasDecimals).toBe(true);
    });
  });

  describe('nowUnixMillis (Date.now)', () => {
    it('should return a Unix timestamp in milliseconds', () => {
      const ts = nowUnixMillis();
      expect(hasMillisecondPrecision(ts)).toBe(true);
    });

    it('should be close to current time', () => {
      const ts = nowUnixMillis();
      const expected = Date.now();
      expect(Math.abs(ts - expected)).toBeLessThan(100);
    });

    it('should increase monotonically under normal conditions', () => {
      const readings: number[] = [];
      for (let i = 0; i < 100; i++) {
        readings.push(nowUnixMillis());
      }

      expect(isMonotonic(readings)).toBe(true);
    });
  });

  describe('TimestampRecorder', () => {
    let recorder: TimestampRecorder;

    beforeEach(() => {
      recorder = new TimestampRecorder();
    });

    it('should record timestamps', () => {
      const record = recorder.record('0x123', 'txnscope');

      expect(record.txHash).toBe('0x123');
      expect(record.source).toBe('txnscope');
      expect(hasMillisecondPrecision(record.receivedAt)).toBe(true);
    });

    it('should accept custom timestamp', () => {
      const customTs = 1703000000000;
      const record = recorder.record('0x123', 'txnscope', customTs);

      expect(record.receivedAt).toBe(customTs);
    });

    it('should track record count', () => {
      expect(recorder.count).toBe(0);

      recorder.record('0x1', 'txnscope');
      expect(recorder.count).toBe(1);

      recorder.record('0x2', 'competitor');
      expect(recorder.count).toBe(2);
    });

    it('should get all records', () => {
      recorder.record('0x1', 'txnscope');
      recorder.record('0x2', 'competitor');
      recorder.record('0x3', 'txnscope');

      const records = recorder.getRecords();
      expect(records).toHaveLength(3);
    });

    it('should filter records by source', () => {
      recorder.record('0x1', 'txnscope');
      recorder.record('0x2', 'competitor');
      recorder.record('0x3', 'txnscope');

      const txnscopeRecords = recorder.getRecordsBySource('txnscope');
      expect(txnscopeRecords).toHaveLength(2);

      const competitorRecords = recorder.getRecordsBySource('competitor');
      expect(competitorRecords).toHaveLength(1);
    });

    it('should find record by hash', () => {
      recorder.record('0x123', 'txnscope', 1000);
      recorder.record('0x456', 'competitor', 2000);

      const found = recorder.getRecordByHash('0x123');
      expect(found?.txHash).toBe('0x123');
      expect(found?.receivedAt).toBe(1000);

      const notFound = recorder.getRecordByHash('0x999');
      expect(notFound).toBeUndefined();
    });

    it('should clear all records', () => {
      recorder.record('0x1', 'txnscope');
      recorder.record('0x2', 'competitor');

      expect(recorder.count).toBe(2);

      recorder.clear();
      expect(recorder.count).toBe(0);
      expect(recorder.getRecords()).toHaveLength(0);
    });

    it('should return copies of records (immutability)', () => {
      recorder.record('0x1', 'txnscope');

      const records1 = recorder.getRecords();
      const records2 = recorder.getRecords();

      expect(records1).not.toBe(records2);
      expect(records1).toEqual(records2);
    });
  });

  describe('Millisecond Precision', () => {
    it('should detect valid millisecond timestamps', () => {
      expect(hasMillisecondPrecision(1703000000000)).toBe(true); // Dec 2023
      expect(hasMillisecondPrecision(1893456000000)).toBe(true); // 2030
      expect(hasMillisecondPrecision(Date.now())).toBe(true);
    });

    it('should reject invalid timestamps', () => {
      expect(hasMillisecondPrecision(1600000000)).toBe(false); // Seconds, not millis
      expect(hasMillisecondPrecision(1000000000000)).toBe(false); // Too old (2001)
      expect(hasMillisecondPrecision(2100000000000)).toBe(false); // Too far future
    });

    it('should record timestamps with correct precision', () => {
      const recorder = new TimestampRecorder();
      const record = recorder.record('0x123', 'test');

      expect(hasMillisecondPrecision(record.receivedAt)).toBe(true);
    });
  });

  describe('Monotonic Clock', () => {
    it('should detect monotonic sequence', () => {
      expect(isMonotonic([1, 2, 3, 4, 5])).toBe(true);
      expect(isMonotonic([1, 1, 2, 2, 3])).toBe(true); // Equal values are ok
      expect(isMonotonic([1])).toBe(true);
      expect(isMonotonic([])).toBe(true);
    });

    it('should detect non-monotonic sequence', () => {
      expect(isMonotonic([1, 2, 1, 4, 5])).toBe(false);
      expect(isMonotonic([5, 4, 3, 2, 1])).toBe(false);
    });

    it('should record monotonic timestamps under normal load', () => {
      const recorder = new TimestampRecorder();
      const timestamps: number[] = [];

      for (let i = 0; i < 100; i++) {
        const record = recorder.record(`0x${i}`, 'test');
        timestamps.push(record.receivedAt);
      }

      expect(isMonotonic(timestamps)).toBe(true);
    });

    it('should handle non-monotonic input gracefully', () => {
      const recorder = new TimestampRecorder();

      // Record in order
      recorder.record('0x1', 'test', 1000);
      recorder.record('0x2', 'test', 2000);

      // Record with earlier timestamp (should still work, just log warning)
      const record = recorder.record('0x3', 'test', 1500);
      expect(record.receivedAt).toBe(1500);

      expect(recorder.count).toBe(3);
    });
  });

  describe('Timestamp Format', () => {
    it('should format timestamp as ISO string', () => {
      const ts = 1703000000000;
      const formatted = formatTimestamp(ts);

      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    it('should preserve milliseconds in formatted output', () => {
      const ts = 1703000000123;
      const formatted = formatTimestamp(ts);

      expect(formatted).toContain('.123Z');
    });

    it('should parse ISO string back to timestamp', () => {
      const original = 1703000000000;
      const formatted = formatTimestamp(original);
      const parsed = parseTimestamp(formatted);

      expect(parsed).toBe(original);
    });

    it('should parse numeric timestamps', () => {
      expect(parseTimestamp(1703000000000)).toBe(1703000000000);
      expect(parseTimestamp(1703000000)).toBe(1703000000000); // Seconds → millis
    });

    it('should handle edge cases in parsing', () => {
      expect(parseTimestamp('2023-12-19T00:00:00.000Z')).toBe(1702944000000);
    });
  });

  describe('Performance', () => {
    it('should record timestamps quickly', () => {
      const recorder = new TimestampRecorder();
      const iterations = 10000;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        recorder.record(`0x${i.toString(16)}`, 'test');
      }
      const elapsed = performance.now() - start;

      const perRecord = elapsed / iterations;
      console.log(`Recording performance: ${perRecord.toFixed(4)}ms per record`);

      // Should be very fast - less than 0.1ms per record
      expect(perRecord).toBeLessThan(0.1);
    });

    it('should lookup records quickly', () => {
      const recorder = new TimestampRecorder();

      // Populate with 10000 records
      for (let i = 0; i < 10000; i++) {
        recorder.record(`0x${i.toString(16).padStart(64, '0')}`, 'test');
      }

      const lookups = 1000;
      const start = performance.now();
      for (let i = 0; i < lookups; i++) {
        recorder.getRecordByHash(`0x${(i * 10).toString(16).padStart(64, '0')}`);
      }
      const elapsed = performance.now() - start;

      const perLookup = elapsed / lookups;
      console.log(`Lookup performance: ${perLookup.toFixed(4)}ms per lookup`);

      // Linear scan is acceptable for this size
      expect(perLookup).toBeLessThan(1);
    });
  });

  describe('Concurrent Recording', () => {
    it('should handle rapid sequential recordings', () => {
      const recorder = new TimestampRecorder();

      for (let i = 0; i < 1000; i++) {
        recorder.record(`0x${i}`, i % 2 === 0 ? 'txnscope' : 'competitor');
      }

      expect(recorder.count).toBe(1000);
      expect(recorder.getRecordsBySource('txnscope')).toHaveLength(500);
      expect(recorder.getRecordsBySource('competitor')).toHaveLength(500);
    });

    it('should maintain data integrity under rapid recording', () => {
      const recorder = new TimestampRecorder();
      const hashes: string[] = [];

      for (let i = 0; i < 500; i++) {
        const hash = `0x${i.toString(16).padStart(8, '0')}`;
        hashes.push(hash);
        recorder.record(hash, 'test', 1000 + i);
      }

      // Verify all records are present and correct
      for (let i = 0; i < 500; i++) {
        const record = recorder.getRecordByHash(hashes[i]);
        expect(record).toBeDefined();
        expect(record?.receivedAt).toBe(1000 + i);
      }
    });
  });
});
