# Phase 5: Latency Proof & Benchmarking

**Status:** In Progress
**Sprint:** Sprint 1-2

---

## 5.1 Latency Logger Tool

Script that subscribes to both TxnScope and a public RPC simultaneously.

**Logic:**
1. Connect to TxnScope WebSocket
2. Connect to Alchemy/QuickNode WebSocket
3. For each transaction hash received:
   - Record timestamp from TxnScope
   - Record timestamp from public RPC
   - Calculate delta: `Delta = Timestamp(Public) - Timestamp(TxnScope)`
4. Target: Delta > 150ms (positive = we're faster)

---

## 5.2 Output Format

```
scripts/latency-logger.ts output:
[2024-01-15 10:30:45] TX 0x123... | TxnScope: 1705312245123 | Alchemy: 1705312245456 | Delta: +333ms WIN
[2024-01-15 10:30:46] TX 0x456... | TxnScope: 1705312246234 | Alchemy: 1705312246512 | Delta: +278ms WIN
```

---

## 5.3 Benchmark Report

Generate `latency_report.md` with:
- 1 hour of comparison data
- Average delta
- P50, P95, P99 latency percentiles
- Charts/visualizations for marketing

---

## 5.4 Test-Driven Development Approach

**Test First Philosophy:**
1. Write tests that verify latency calculation accuracy
2. Implement latency logging tools to pass tests
3. Refactor while maintaining calculation accuracy

**Test Categories:**
- Unit tests: Test timestamp recording, delta calculation logic
- Integration tests: Test dual WebSocket subscription management
- Validation tests: Ensure reported deltas are positive (TxnScope is faster)

**Testing Tools:**
- Testing framework: `vitest` or `jest`
- WebSocket mocking: Mock WebSocket servers for deterministic testing
- Time mocking: `@sinonjs/fake-timers` for timestamp control
- Coverage requirements: >80% for calculation logic

**Test File Structure:**
```
scripts/
├── latency-logger.ts
├── benchmark.ts
└── tests/
    ├── delta-calculation.test.ts
    ├── timestamp-recording.test.ts
    └── dual-subscription.test.ts
```

---

## 5.5 Test Tasks

- [ ] Write unit test for delta calculation (positive/negative cases)
- [ ] Write unit test for timestamp recording precision
- [ ] Write unit test for transaction hash matching between sources
- [ ] Write integration test for dual WebSocket subscription handling
- [ ] Write test to ensure TxnScope timestamps are consistently earlier
- [ ] Write test for report generation (markdown formatting)
- [ ] Achieve >80% code coverage for latency tools

---

## 5.6 Implementation Tasks

- [ ] Create `scripts/latency-logger.ts`
- [ ] Implement dual-subscription logic
- [ ] Implement delta calculation and logging
- [ ] Generate benchmark report format
- [ ] Create demo recording script
