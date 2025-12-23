import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Transaction received from a source
 */
interface ReceivedTransaction {
  hash: string;
  timestamp: number;
  source: 'txnscope' | 'competitor';
}

/**
 * Connection state for a source
 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Mock subscription source for testing
 */
class MockSubscriptionSource extends EventEmitter {
  public name: string;
  public state: ConnectionState = 'disconnected';
  private shouldFail: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  constructor(name: string) {
    super();
    this.name = name;
  }

  async connect(): Promise<void> {
    this.state = 'connecting';

    // Simulate connection delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (this.shouldFail) {
      this.state = 'error';
      throw new Error(`Connection to ${this.name} failed`);
    }

    this.state = 'connected';
    this.reconnectAttempts = 0;
    this.emit('connected');
  }

  disconnect(): void {
    this.state = 'disconnected';
    this.emit('disconnected');
  }

  setFailMode(fail: boolean): void {
    this.shouldFail = fail;
  }

  async reconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return false;
    }

    this.reconnectAttempts++;

    try {
      await this.connect();
      return true;
    } catch {
      return false;
    }
  }

  simulateTransaction(hash: string): void {
    if (this.state !== 'connected') {
      return;
    }

    const tx: ReceivedTransaction = {
      hash,
      timestamp: Date.now(),
      source: this.name as 'txnscope' | 'competitor',
    };

    this.emit('transaction', tx);
  }

  simulateError(): void {
    this.state = 'error';
    this.emit('error', new Error(`${this.name} connection error`));
  }
}

/**
 * Dual subscription manager that connects to both TxnScope and competitor
 */
class DualSubscriptionManager extends EventEmitter {
  private txnscope: MockSubscriptionSource;
  private competitor: MockSubscriptionSource;
  private transactions: Map<string, { txnscope?: number; competitor?: number }> = new Map();

  constructor() {
    super();
    this.txnscope = new MockSubscriptionSource('txnscope');
    this.competitor = new MockSubscriptionSource('competitor');

    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen for transactions from both sources
    this.txnscope.on('transaction', (tx: ReceivedTransaction) => {
      this.recordTransaction(tx);
    });

    this.competitor.on('transaction', (tx: ReceivedTransaction) => {
      this.recordTransaction(tx);
    });

    // Listen for connection events
    this.txnscope.on('connected', () => this.emit('sourceConnected', 'txnscope'));
    this.competitor.on('connected', () => this.emit('sourceConnected', 'competitor'));
    this.txnscope.on('disconnected', () => this.emit('sourceDisconnected', 'txnscope'));
    this.competitor.on('disconnected', () => this.emit('sourceDisconnected', 'competitor'));

    // Listen for errors
    this.txnscope.on('error', (err) => this.handleSourceError('txnscope', err));
    this.competitor.on('error', (err) => this.handleSourceError('competitor', err));
  }

  private recordTransaction(tx: ReceivedTransaction): void {
    const existing = this.transactions.get(tx.hash) || {};

    if (tx.source === 'txnscope') {
      existing.txnscope = tx.timestamp;
    } else {
      existing.competitor = tx.timestamp;
    }

    this.transactions.set(tx.hash, existing);

    // Emit correlation event if both timestamps present
    if (existing.txnscope !== undefined && existing.competitor !== undefined) {
      this.emit('correlated', {
        hash: tx.hash,
        txnscopeTimestamp: existing.txnscope,
        competitorTimestamp: existing.competitor,
        delta: existing.txnscope - existing.competitor,
      });
    }

    this.emit('transaction', tx);
  }

  private handleSourceError(source: string, error: Error): void {
    this.emit('sourceError', { source, error });
  }

  async connectAll(): Promise<{ txnscope: boolean; competitor: boolean }> {
    const results = await Promise.allSettled([this.txnscope.connect(), this.competitor.connect()]);

    return {
      txnscope: results[0].status === 'fulfilled',
      competitor: results[1].status === 'fulfilled',
    };
  }

  disconnectAll(): void {
    this.txnscope.disconnect();
    this.competitor.disconnect();
  }

  getTxnscopeSource(): MockSubscriptionSource {
    return this.txnscope;
  }

  getCompetitorSource(): MockSubscriptionSource {
    return this.competitor;
  }

  getState(): { txnscope: ConnectionState; competitor: ConnectionState } {
    return {
      txnscope: this.txnscope.state,
      competitor: this.competitor.state,
    };
  }

  isFullyConnected(): boolean {
    return this.txnscope.state === 'connected' && this.competitor.state === 'connected';
  }

  isPartiallyConnected(): boolean {
    return (
      (this.txnscope.state === 'connected' || this.competitor.state === 'connected') &&
      !this.isFullyConnected()
    );
  }

  getTransactions(): Map<string, { txnscope?: number; competitor?: number }> {
    return new Map(this.transactions);
  }

  getCorrelatedTransactions(): Array<{
    hash: string;
    txnscope: number;
    competitor: number;
    delta: number;
  }> {
    const correlated = [];
    for (const [hash, timestamps] of this.transactions) {
      if (timestamps.txnscope !== undefined && timestamps.competitor !== undefined) {
        correlated.push({
          hash,
          txnscope: timestamps.txnscope,
          competitor: timestamps.competitor,
          delta: timestamps.txnscope - timestamps.competitor,
        });
      }
    }
    return correlated;
  }

  clearTransactions(): void {
    this.transactions.clear();
  }
}

describe('Dual Subscription', () => {
  let manager: DualSubscriptionManager;

  beforeEach(() => {
    manager = new DualSubscriptionManager();
  });

  describe('Connection to Both Sources', () => {
    it('should connect to both TxnScope and competitor', async () => {
      const result = await manager.connectAll();

      expect(result.txnscope).toBe(true);
      expect(result.competitor).toBe(true);
      expect(manager.isFullyConnected()).toBe(true);
    });

    it('should emit sourceConnected events', async () => {
      const connectedSources: string[] = [];
      manager.on('sourceConnected', (source) => connectedSources.push(source));

      await manager.connectAll();

      expect(connectedSources).toContain('txnscope');
      expect(connectedSources).toContain('competitor');
    });

    it('should track connection state for each source', async () => {
      expect(manager.getState().txnscope).toBe('disconnected');
      expect(manager.getState().competitor).toBe('disconnected');

      await manager.connectAll();

      expect(manager.getState().txnscope).toBe('connected');
      expect(manager.getState().competitor).toBe('connected');
    });

    it('should disconnect all sources', async () => {
      await manager.connectAll();
      expect(manager.isFullyConnected()).toBe(true);

      manager.disconnectAll();

      expect(manager.getState().txnscope).toBe('disconnected');
      expect(manager.getState().competitor).toBe('disconnected');
      expect(manager.isFullyConnected()).toBe(false);
    });
  });

  describe('Partial Failure Handling', () => {
    it('should handle TxnScope connection failure gracefully', async () => {
      manager.getTxnscopeSource().setFailMode(true);

      const result = await manager.connectAll();

      expect(result.txnscope).toBe(false);
      expect(result.competitor).toBe(true);
      expect(manager.isPartiallyConnected()).toBe(true);
    });

    it('should handle competitor connection failure gracefully', async () => {
      manager.getCompetitorSource().setFailMode(true);

      const result = await manager.connectAll();

      expect(result.txnscope).toBe(true);
      expect(result.competitor).toBe(false);
      expect(manager.isPartiallyConnected()).toBe(true);
    });

    it('should handle both connections failing', async () => {
      manager.getTxnscopeSource().setFailMode(true);
      manager.getCompetitorSource().setFailMode(true);

      const result = await manager.connectAll();

      expect(result.txnscope).toBe(false);
      expect(result.competitor).toBe(false);
      expect(manager.isFullyConnected()).toBe(false);
      expect(manager.isPartiallyConnected()).toBe(false);
    });

    it('should emit error events for failed sources', async () => {
      const errors: { source: string; error: Error }[] = [];
      manager.on('sourceError', (data) => errors.push(data));

      manager.getTxnscopeSource().setFailMode(true);
      await manager.connectAll();

      // Simulate an error after connection attempt
      manager.getTxnscopeSource().simulateError();

      expect(errors.some((e) => e.source === 'txnscope')).toBe(true);
    });

    it('should continue receiving from working source when one fails', async () => {
      const receivedTxs: ReceivedTransaction[] = [];
      manager.on('transaction', (tx) => receivedTxs.push(tx));

      // Only connect competitor
      manager.getTxnscopeSource().setFailMode(true);
      await manager.connectAll();

      // Simulate transaction on working source
      manager.getCompetitorSource().simulateTransaction('0x123');

      expect(receivedTxs).toHaveLength(1);
      expect(receivedTxs[0].source).toBe('competitor');
    });

    it('should attempt reconnection on failure', async () => {
      const txnscope = manager.getTxnscopeSource();
      txnscope.setFailMode(true);

      await manager.connectAll();
      expect(manager.getState().txnscope).toBe('error');

      // Enable connection and attempt reconnect
      txnscope.setFailMode(false);
      const reconnected = await txnscope.reconnect();

      expect(reconnected).toBe(true);
      expect(manager.getState().txnscope).toBe('connected');
    });
  });

  describe('Transaction Correlation by Hash', () => {
    beforeEach(async () => {
      await manager.connectAll();
    });

    it('should correlate transactions by hash', () => {
      const txnscope = manager.getTxnscopeSource();
      const competitor = manager.getCompetitorSource();

      // Same transaction from both sources
      txnscope.simulateTransaction('0x123');
      competitor.simulateTransaction('0x123');

      const correlated = manager.getCorrelatedTransactions();
      expect(correlated).toHaveLength(1);
      expect(correlated[0].hash).toBe('0x123');
    });

    it('should emit correlated event when both timestamps received', async () => {
      const correlatedEvents: any[] = [];
      manager.on('correlated', (data) => correlatedEvents.push(data));

      const txnscope = manager.getTxnscopeSource();
      const competitor = manager.getCompetitorSource();

      txnscope.simulateTransaction('0x456');
      expect(correlatedEvents).toHaveLength(0); // Not correlated yet

      competitor.simulateTransaction('0x456');
      expect(correlatedEvents).toHaveLength(1);
      expect(correlatedEvents[0].hash).toBe('0x456');
    });

    it('should calculate delta between sources', () => {
      const txnscope = manager.getTxnscopeSource();
      const competitor = manager.getCompetitorSource();

      // TxnScope receives first
      txnscope.simulateTransaction('0x789');

      // Add small delay then competitor receives
      vi.useFakeTimers();
      vi.advanceTimersByTime(50);
      competitor.simulateTransaction('0x789');
      vi.useRealTimers();

      const correlated = manager.getCorrelatedTransactions();
      expect(correlated).toHaveLength(1);
      // Delta should be negative (TxnScope was faster)
      expect(correlated[0].delta).toBeLessThanOrEqual(0);
    });

    it('should handle transactions only seen by one source', () => {
      const txnscope = manager.getTxnscopeSource();
      const competitor = manager.getCompetitorSource();

      txnscope.simulateTransaction('0xOnlyTxnscope');
      competitor.simulateTransaction('0xOnlyCompetitor');

      const transactions = manager.getTransactions();
      expect(transactions.size).toBe(2);

      const correlated = manager.getCorrelatedTransactions();
      expect(correlated).toHaveLength(0); // Neither is correlated
    });

    it('should handle many transactions', () => {
      const txnscope = manager.getTxnscopeSource();
      const competitor = manager.getCompetitorSource();

      // Generate 100 transactions seen by both
      for (let i = 0; i < 100; i++) {
        const hash = `0x${i.toString(16).padStart(64, '0')}`;
        txnscope.simulateTransaction(hash);
        competitor.simulateTransaction(hash);
      }

      const correlated = manager.getCorrelatedTransactions();
      expect(correlated).toHaveLength(100);
    });

    it('should handle interleaved transactions', () => {
      const txnscope = manager.getTxnscopeSource();
      const competitor = manager.getCompetitorSource();

      // Interleaved pattern
      txnscope.simulateTransaction('0x1');
      competitor.simulateTransaction('0x2');
      txnscope.simulateTransaction('0x2');
      competitor.simulateTransaction('0x1');
      txnscope.simulateTransaction('0x3');

      const correlated = manager.getCorrelatedTransactions();
      expect(correlated).toHaveLength(2); // 0x1 and 0x2 are correlated
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      await manager.connectAll();
    });

    it('should handle duplicate transactions from same source', () => {
      const txnscope = manager.getTxnscopeSource();

      txnscope.simulateTransaction('0x123');
      txnscope.simulateTransaction('0x123'); // Duplicate

      const transactions = manager.getTransactions();
      expect(transactions.size).toBe(1); // Should not create duplicate entry
    });

    it('should update timestamp on duplicate', () => {
      const txnscope = manager.getTxnscopeSource();

      vi.useFakeTimers();
      vi.setSystemTime(1000);
      txnscope.simulateTransaction('0x123');

      vi.setSystemTime(2000);
      txnscope.simulateTransaction('0x123'); // Later duplicate

      vi.useRealTimers();

      const transactions = manager.getTransactions();
      const entry = transactions.get('0x123');
      expect(entry?.txnscope).toBe(2000); // Should have later timestamp
    });

    it('should handle empty transaction hash', () => {
      const txnscope = manager.getTxnscopeSource();

      // This should still work (empty string is valid key)
      txnscope.simulateTransaction('');

      const transactions = manager.getTransactions();
      expect(transactions.has('')).toBe(true);
    });

    it('should handle transactions when disconnected', () => {
      const txnscope = manager.getTxnscopeSource();

      manager.disconnectAll();
      txnscope.simulateTransaction('0x123'); // Should be ignored

      const transactions = manager.getTransactions();
      expect(transactions.size).toBe(0);
    });

    it('should clear transaction history', async () => {
      const txnscope = manager.getTxnscopeSource();
      const competitor = manager.getCompetitorSource();

      txnscope.simulateTransaction('0x1');
      competitor.simulateTransaction('0x1');

      expect(manager.getCorrelatedTransactions()).toHaveLength(1);

      manager.clearTransactions();

      expect(manager.getTransactions().size).toBe(0);
      expect(manager.getCorrelatedTransactions()).toHaveLength(0);
    });
  });

  describe('Performance', () => {
    it('should handle high transaction volume', async () => {
      await manager.connectAll();

      const txnscope = manager.getTxnscopeSource();
      const competitor = manager.getCompetitorSource();

      const txCount = 10000;
      const start = performance.now();

      for (let i = 0; i < txCount; i++) {
        const hash = `0x${i.toString(16).padStart(64, '0')}`;
        txnscope.simulateTransaction(hash);
        competitor.simulateTransaction(hash);
      }

      const elapsed = performance.now() - start;
      const perTx = elapsed / txCount;

      console.log(`Processed ${txCount} tx pairs in ${elapsed.toFixed(2)}ms (${perTx.toFixed(4)}ms/tx)`);

      expect(manager.getCorrelatedTransactions()).toHaveLength(txCount);
      expect(perTx).toBeLessThan(1); // Less than 1ms per tx pair
    });

    it('should efficiently lookup correlated transactions', async () => {
      await manager.connectAll();

      const txnscope = manager.getTxnscopeSource();
      const competitor = manager.getCompetitorSource();

      // Populate with 5000 transactions
      for (let i = 0; i < 5000; i++) {
        const hash = `0x${i.toString(16).padStart(64, '0')}`;
        txnscope.simulateTransaction(hash);
        competitor.simulateTransaction(hash);
      }

      const lookups = 100;
      const start = performance.now();

      for (let i = 0; i < lookups; i++) {
        manager.getCorrelatedTransactions();
      }

      const elapsed = performance.now() - start;
      const perLookup = elapsed / lookups;

      console.log(`${lookups} correlation lookups in ${elapsed.toFixed(2)}ms (${perLookup.toFixed(2)}ms/lookup)`);

      expect(perLookup).toBeLessThan(50); // Less than 50ms per lookup
    });
  });
});
