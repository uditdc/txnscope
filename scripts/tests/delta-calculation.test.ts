import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Latency measurement record for a single transaction
 */
interface LatencyRecord {
  txHash: string;
  txnscopeTimestamp: number;
  competitorTimestamp: number;
  delta: number; // txnscopeTimestamp - competitorTimestamp (negative = we're faster)
}

/**
 * Statistics summary for latency measurements
 */
interface LatencyStats {
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  fasterCount: number; // Count where TxnScope was faster
  fasterPercent: number; // Percentage where TxnScope was faster
}

/**
 * Calculate delta between TxnScope and competitor timestamps
 * Negative delta means TxnScope was faster
 */
function calculateDelta(txnscopeTimestamp: number, competitorTimestamp: number): number {
  return txnscopeTimestamp - competitorTimestamp;
}

/**
 * Match transactions from two sources by hash
 */
function matchTransactionsByHash(
  txnscopeRecords: Map<string, number>,
  competitorRecords: Map<string, number>
): LatencyRecord[] {
  const matched: LatencyRecord[] = [];

  for (const [hash, txnscopeTs] of txnscopeRecords) {
    const competitorTs = competitorRecords.get(hash);
    if (competitorTs !== undefined) {
      matched.push({
        txHash: hash,
        txnscopeTimestamp: txnscopeTs,
        competitorTimestamp: competitorTs,
        delta: calculateDelta(txnscopeTs, competitorTs),
      });
    }
  }

  return matched;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

/**
 * Calculate latency statistics from matched records
 */
function calculateStats(records: LatencyRecord[]): LatencyStats {
  if (records.length === 0) {
    return {
      count: 0,
      avg: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      fasterCount: 0,
      fasterPercent: 0,
    };
  }

  const deltas = records.map((r) => r.delta);
  const sortedDeltas = [...deltas].sort((a, b) => a - b);

  const sum = deltas.reduce((a, b) => a + b, 0);
  const fasterCount = deltas.filter((d) => d < 0).length;

  return {
    count: records.length,
    avg: sum / records.length,
    min: Math.min(...deltas),
    max: Math.max(...deltas),
    p50: percentile(sortedDeltas, 50),
    p95: percentile(sortedDeltas, 95),
    p99: percentile(sortedDeltas, 99),
    fasterCount,
    fasterPercent: (fasterCount / records.length) * 100,
  };
}

describe('Delta Calculation', () => {
  describe('calculateDelta', () => {
    it('should return negative delta when TxnScope is faster', () => {
      // TxnScope received at 1000ms, competitor at 1050ms
      const delta = calculateDelta(1000, 1050);
      expect(delta).toBe(-50);
      expect(delta).toBeLessThan(0);
    });

    it('should return positive delta when competitor is faster', () => {
      // TxnScope received at 1050ms, competitor at 1000ms
      const delta = calculateDelta(1050, 1000);
      expect(delta).toBe(50);
      expect(delta).toBeGreaterThan(0);
    });

    it('should return zero when both arrive simultaneously', () => {
      const delta = calculateDelta(1000, 1000);
      expect(delta).toBe(0);
    });

    it('should handle large timestamps correctly', () => {
      const txnscope = 1703000000000; // Dec 2023
      const competitor = 1703000000050; // 50ms later
      const delta = calculateDelta(txnscope, competitor);
      expect(delta).toBe(-50);
    });

    it('should handle microsecond precision', () => {
      const delta = calculateDelta(1000.123, 1000.456);
      expect(delta).toBeCloseTo(-0.333, 3);
    });
  });

  describe('matchTransactionsByHash', () => {
    it('should match transactions with same hash', () => {
      const txnscope = new Map([
        ['0x123', 1000],
        ['0x456', 1010],
        ['0x789', 1020],
      ]);
      const competitor = new Map([
        ['0x123', 1005],
        ['0x456', 1015],
        ['0x789', 1025],
      ]);

      const matched = matchTransactionsByHash(txnscope, competitor);

      expect(matched).toHaveLength(3);
      expect(matched.map((r) => r.txHash)).toContain('0x123');
      expect(matched.map((r) => r.txHash)).toContain('0x456');
      expect(matched.map((r) => r.txHash)).toContain('0x789');
    });

    it('should only include transactions present in both sources', () => {
      const txnscope = new Map([
        ['0x123', 1000],
        ['0x456', 1010],
        ['0xOnlyInTxnScope', 1020],
      ]);
      const competitor = new Map([
        ['0x123', 1005],
        ['0x456', 1015],
        ['0xOnlyInCompetitor', 1025],
      ]);

      const matched = matchTransactionsByHash(txnscope, competitor);

      expect(matched).toHaveLength(2);
      expect(matched.map((r) => r.txHash)).not.toContain('0xOnlyInTxnScope');
      expect(matched.map((r) => r.txHash)).not.toContain('0xOnlyInCompetitor');
    });

    it('should calculate correct delta for each match', () => {
      const txnscope = new Map([['0x123', 1000]]);
      const competitor = new Map([['0x123', 1050]]);

      const matched = matchTransactionsByHash(txnscope, competitor);

      expect(matched[0].delta).toBe(-50); // TxnScope was 50ms faster
    });

    it('should handle empty inputs', () => {
      const empty = new Map<string, number>();
      const populated = new Map([['0x123', 1000]]);

      expect(matchTransactionsByHash(empty, populated)).toHaveLength(0);
      expect(matchTransactionsByHash(populated, empty)).toHaveLength(0);
      expect(matchTransactionsByHash(empty, empty)).toHaveLength(0);
    });

    it('should handle no overlapping hashes', () => {
      const txnscope = new Map([['0x123', 1000]]);
      const competitor = new Map([['0x456', 1000]]);

      const matched = matchTransactionsByHash(txnscope, competitor);
      expect(matched).toHaveLength(0);
    });
  });

  describe('calculateStats', () => {
    let records: LatencyRecord[];

    beforeEach(() => {
      // Sample records where TxnScope is faster in 7/10 cases
      records = [
        { txHash: '0x1', txnscopeTimestamp: 1000, competitorTimestamp: 1050, delta: -50 },
        { txHash: '0x2', txnscopeTimestamp: 1010, competitorTimestamp: 1040, delta: -30 },
        { txHash: '0x3', txnscopeTimestamp: 1020, competitorTimestamp: 1010, delta: 10 },
        { txHash: '0x4', txnscopeTimestamp: 1030, competitorTimestamp: 1070, delta: -40 },
        { txHash: '0x5', txnscopeTimestamp: 1040, competitorTimestamp: 1050, delta: -10 },
        { txHash: '0x6', txnscopeTimestamp: 1050, competitorTimestamp: 1040, delta: 10 },
        { txHash: '0x7', txnscopeTimestamp: 1060, competitorTimestamp: 1080, delta: -20 },
        { txHash: '0x8', txnscopeTimestamp: 1070, competitorTimestamp: 1100, delta: -30 },
        { txHash: '0x9', txnscopeTimestamp: 1080, competitorTimestamp: 1070, delta: 10 },
        { txHash: '0xa', txnscopeTimestamp: 1090, competitorTimestamp: 1120, delta: -30 },
      ];
    });

    it('should calculate correct count', () => {
      const stats = calculateStats(records);
      expect(stats.count).toBe(10);
    });

    it('should calculate correct average', () => {
      const stats = calculateStats(records);
      // Sum: -50 + -30 + 10 + -40 + -10 + 10 + -20 + -30 + 10 + -30 = -180
      // Avg: -180 / 10 = -18
      expect(stats.avg).toBe(-18);
    });

    it('should calculate correct min/max', () => {
      const stats = calculateStats(records);
      expect(stats.min).toBe(-50); // Fastest TxnScope advantage
      expect(stats.max).toBe(10); // Worst TxnScope result
    });

    it('should calculate correct p50 (median)', () => {
      const stats = calculateStats(records);
      // Sorted: [-50, -40, -30, -30, -30, -20, -10, 10, 10, 10]
      // P50 is 5th element (index 4): -30
      expect(stats.p50).toBe(-30);
    });

    it('should calculate correct p95', () => {
      const stats = calculateStats(records);
      // 95th percentile of 10 items = ceil(0.95 * 10) = 10th item (index 9): 10
      expect(stats.p95).toBe(10);
    });

    it('should calculate correct p99', () => {
      const stats = calculateStats(records);
      // 99th percentile of 10 items = ceil(0.99 * 10) = 10th item (index 9): 10
      expect(stats.p99).toBe(10);
    });

    it('should calculate correct faster count', () => {
      const stats = calculateStats(records);
      // Negative deltas: -50, -30, -40, -10, -20, -30, -30 = 7
      expect(stats.fasterCount).toBe(7);
    });

    it('should calculate correct faster percentage', () => {
      const stats = calculateStats(records);
      expect(stats.fasterPercent).toBe(70);
    });

    it('should handle empty records', () => {
      const stats = calculateStats([]);
      expect(stats.count).toBe(0);
      expect(stats.avg).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.fasterPercent).toBe(0);
    });

    it('should handle single record', () => {
      const singleRecord = [
        { txHash: '0x1', txnscopeTimestamp: 1000, competitorTimestamp: 1050, delta: -50 },
      ];
      const stats = calculateStats(singleRecord);

      expect(stats.count).toBe(1);
      expect(stats.avg).toBe(-50);
      expect(stats.min).toBe(-50);
      expect(stats.max).toBe(-50);
      expect(stats.p50).toBe(-50);
      expect(stats.p95).toBe(-50);
      expect(stats.p99).toBe(-50);
      expect(stats.fasterCount).toBe(1);
      expect(stats.fasterPercent).toBe(100);
    });

    it('should handle all records showing TxnScope faster', () => {
      const allFaster = [
        { txHash: '0x1', txnscopeTimestamp: 1000, competitorTimestamp: 1050, delta: -50 },
        { txHash: '0x2', txnscopeTimestamp: 1000, competitorTimestamp: 1030, delta: -30 },
      ];
      const stats = calculateStats(allFaster);
      expect(stats.fasterPercent).toBe(100);
    });

    it('should handle all records showing competitor faster', () => {
      const allSlower = [
        { txHash: '0x1', txnscopeTimestamp: 1050, competitorTimestamp: 1000, delta: 50 },
        { txHash: '0x2', txnscopeTimestamp: 1030, competitorTimestamp: 1000, delta: 30 },
      ];
      const stats = calculateStats(allSlower);
      expect(stats.fasterPercent).toBe(0);
    });
  });

  describe('percentile', () => {
    it('should calculate p50 correctly', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(percentile(values, 50)).toBe(5);
    });

    it('should calculate p95 correctly', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(percentile(values, 95)).toBe(95);
    });

    it('should calculate p99 correctly', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(percentile(values, 99)).toBe(99);
    });

    it('should handle empty array', () => {
      expect(percentile([], 50)).toBe(0);
    });

    it('should handle single element', () => {
      expect(percentile([42], 50)).toBe(42);
      expect(percentile([42], 99)).toBe(42);
    });
  });

  describe('Integration: Full Latency Analysis', () => {
    it('should analyze latency data end-to-end', () => {
      // Simulate real data collection
      const txnscope = new Map<string, number>();
      const competitor = new Map<string, number>();

      // Generate 100 transactions
      const baseTime = Date.now();
      for (let i = 0; i < 100; i++) {
        const hash = `0x${i.toString(16).padStart(64, '0')}`;
        const txnscopeTime = baseTime + i * 10; // Arrive every 10ms
        // TxnScope is faster 80% of the time by 10-50ms
        const isFaster = Math.random() < 0.8;
        const offset = isFaster ? Math.random() * 40 + 10 : -(Math.random() * 30 + 5);
        const competitorTime = txnscopeTime + offset;

        txnscope.set(hash, txnscopeTime);
        competitor.set(hash, competitorTime);
      }

      // Match and analyze
      const matched = matchTransactionsByHash(txnscope, competitor);
      const stats = calculateStats(matched);

      // Verify analysis results
      expect(stats.count).toBe(100);
      expect(stats.avg).toBeDefined();
      expect(stats.p50).toBeDefined();
      expect(stats.p95).toBeDefined();
      expect(stats.p99).toBeDefined();
      expect(stats.fasterPercent).toBeGreaterThan(0);
      expect(stats.fasterPercent).toBeLessThanOrEqual(100);

      console.log('Latency Analysis Results:');
      console.log(`  Count: ${stats.count}`);
      console.log(`  Average Delta: ${stats.avg.toFixed(2)}ms`);
      console.log(`  P50 Delta: ${stats.p50.toFixed(2)}ms`);
      console.log(`  P95 Delta: ${stats.p95.toFixed(2)}ms`);
      console.log(`  P99 Delta: ${stats.p99.toFixed(2)}ms`);
      console.log(`  Faster: ${stats.fasterPercent.toFixed(1)}% (${stats.fasterCount}/${stats.count})`);
    });
  });
});
