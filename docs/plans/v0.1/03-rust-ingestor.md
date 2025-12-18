# Phase 3: Rust Ingestor Service

**Status:** In Progress
**Sprint:** Sprint 1-2

---

## 3.1 Dependencies (Cargo.toml)

```toml
[dependencies]
alloy = { version = "0.8", features = ["full"] }
tokio = { version = "1", features = ["full"] }
redis = { version = "0.27", features = ["tokio-comp"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = "0.3"

[dev-dependencies]
mockall = "0.12"
tokio-test = "0.4"
```

---

## 3.2 Core Components

### IPC Connection Module
- Connect to node via Unix socket (`geth.ipc`)
- Subscribe to `newPendingTransactions`
- Handle reconnection with exponential backoff

### Transaction Decoder
- RLP decode transaction data
- Extract method ID (first 4 bytes of input)
- Zero-copy filtering for performance

### Filter Logic - Target Method IDs
```
0xf305d719 - addLiquidityETH
0xe8e33700 - addLiquidity
0x7ff36ab5 - swapExactETHForTokens
0x38ed1739 - swapExactTokensForTokens
0x8803dbee - swapTokensForExactTokens
0x18cbafe5 - swapExactTokensForETH
```

### Redis Publisher
- Publish to `mempool_alpha` channel
- JSON payload format:
```json
{
  "hash": "0x...",
  "from": "0x...",
  "to": "0x...",
  "method": "swapExactTokensForTokens",
  "methodId": "0x38ed1739",
  "value": "1000000000000000000",
  "gasPrice": "20000000000",
  "timestamp": 1703000000000
}
```

---

## 3.3 Latency Budget

| Step | Target |
|------|--------|
| Node Detection | T+0ms |
| Decode & Filter | <5ms |
| Redis Push | <2ms |
| **Total** | **<7ms** |

---

## 3.4 Test-Driven Development Approach

**Test First Philosophy:**
1. Write failing tests that define expected behavior for each module
2. Implement minimal code to make tests pass
3. Refactor while keeping tests green
4. Measure performance and ensure latency targets are met

**Test Categories:**
- Unit tests: Test individual functions/modules in isolation
- Integration tests: Test component interactions (IPC → decode → filter → Redis)
- Performance tests: Verify latency budget compliance

**Testing Tools:**
- Testing framework: `cargo test` with `#[tokio::test]` for async tests
- Mocking: `mockall` crate for Redis/IPC mocking
- Coverage: `cargo-tarpaulin` for coverage reports
- Coverage requirements: >80% for core logic

**Test File Structure:**
```
packages/ingestor/
├── Cargo.toml
├── src/
│   ├── main.rs           # Entry point
│   ├── lib.rs            # Library root (exports modules)
│   ├── ipc.rs            # IPC connection + inline unit tests
│   ├── decoder.rs        # RLP decoder + inline unit tests
│   ├── filter.rs         # DEX filter + inline unit tests
│   └── publisher.rs      # Redis publisher + inline unit tests
└── tests/
    ├── anvil_integration.rs   # Full pipeline with Anvil
    ├── mock_pipeline.rs       # Pipeline with mocked IPC
    └── latency_benchmark.rs   # Performance tests
```

**Unit Test Pattern (inline in source files):**
```rust
// In src/filter.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_swap_exact_tokens() {
        let method_id = [0x38, 0xed, 0x17, 0x39];
        assert!(is_dex_method(&method_id));
    }
}
```

---

## 3.5 Test Tasks

- [ ] Write inline unit tests for RLP decoder (valid/invalid transactions)
- [ ] Write inline unit tests for method ID extraction (4-byte selector)
- [ ] Write inline unit tests for DEX method filter (6 target methods)
- [ ] Write inline unit tests for Redis publisher (message formatting)
- [ ] Write integration test with Anvil for full IPC → Redis pipeline
- [ ] Write performance test to verify <7ms latency budget
- [ ] Achieve >80% code coverage for core modules

---

## 3.6 Implementation Tasks

- [ ] Create `packages/ingestor/` with Cargo.toml
- [ ] Implement IPC connection module
- [ ] Implement RLP decoder and method ID extraction
- [ ] Implement filter logic for DEX methods
- [ ] Implement Redis publisher
- [ ] Add logging and metrics
- [ ] Test with local node
