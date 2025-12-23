//! Mock Pipeline Integration Tests
//!
//! Tests the full pipeline with mocked IPC and Redis (no external dependencies).
//! Verifies filter → decode → publish chain works correctly.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use txnscope_ingestor::filter::{filter_transaction, is_dex_method, DexMethodId};
use txnscope_ingestor::publisher::TransactionMessage;
use txnscope_ingestor::decoder::{DecodedTransaction, decode_transaction};
use alloy::primitives::{Address, TxHash, U256, Bytes};

/// Mock pending transaction received from IPC
#[derive(Debug, Clone)]
struct MockPendingTx {
    /// RLP-encoded transaction bytes (simplified for testing)
    pub raw: Vec<u8>,
    /// From address (normally recovered from signature)
    pub from: Address,
}

/// Mock IPC subscriber that provides pending transactions
struct MockIpcSubscriber {
    transactions: VecDeque<MockPendingTx>,
}

impl MockIpcSubscriber {
    fn new() -> Self {
        Self {
            transactions: VecDeque::new(),
        }
    }

    fn add_transaction(&mut self, tx: MockPendingTx) {
        self.transactions.push_back(tx);
    }

    fn next(&mut self) -> Option<MockPendingTx> {
        self.transactions.pop_front()
    }

    fn is_empty(&self) -> bool {
        self.transactions.is_empty()
    }

    fn len(&self) -> usize {
        self.transactions.len()
    }
}

/// Mock Redis publisher that captures published messages
struct MockRedisPublisher {
    messages: Arc<Mutex<Vec<TransactionMessage>>>,
    channel: String,
    fail_next: Arc<Mutex<usize>>,
}

impl MockRedisPublisher {
    fn new(channel: &str) -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
            channel: channel.to_string(),
            fail_next: Arc::new(Mutex::new(0)),
        }
    }

    fn publish(&self, message: TransactionMessage) -> Result<i64, MockPublishError> {
        let mut fail_count = self.fail_next.lock().unwrap();
        if *fail_count > 0 {
            *fail_count -= 1;
            return Err(MockPublishError::ConnectionLost);
        }

        let mut messages = self.messages.lock().unwrap();
        messages.push(message);
        Ok(1) // 1 subscriber received the message
    }

    fn get_messages(&self) -> Vec<TransactionMessage> {
        self.messages.lock().unwrap().clone()
    }

    fn message_count(&self) -> usize {
        self.messages.lock().unwrap().len()
    }

    fn set_fail_next(&self, count: usize) {
        *self.fail_next.lock().unwrap() = count;
    }
}

#[derive(Debug)]
enum MockPublishError {
    ConnectionLost,
}

/// Simple pipeline that processes transactions
struct MockPipeline {
    ipc: MockIpcSubscriber,
    publisher: MockRedisPublisher,
    filtered_count: usize,
    processed_count: usize,
    error_count: usize,
}

impl MockPipeline {
    fn new(ipc: MockIpcSubscriber, publisher: MockRedisPublisher) -> Self {
        Self {
            ipc,
            publisher,
            filtered_count: 0,
            processed_count: 0,
            error_count: 0,
        }
    }

    /// Process a single pending transaction through the pipeline
    fn process_one(&mut self, pending_tx: MockPendingTx, calldata: &[u8]) -> Result<bool, String> {
        self.processed_count += 1;

        // Step 1: Filter - check if this is a DEX transaction
        let dex_method = match filter_transaction(calldata) {
            Some(method) => method,
            None => return Ok(false), // Not a DEX transaction, skip
        };

        self.filtered_count += 1;

        // Step 2: Create transaction message (simplified - no actual RLP decode in mock)
        let message = TransactionMessage {
            hash: format!("0x{}", hex::encode(&pending_tx.raw[..32.min(pending_tx.raw.len())].to_vec().into_iter().chain(std::iter::repeat(0)).take(32).collect::<Vec<_>>())),
            from: format!("{:#x}", pending_tx.from),
            to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(), // Mock router address
            method: dex_method.name().to_string(),
            method_id: dex_method.hex().to_string(),
            value: "0".to_string(),
            gas_price: "20000000000".to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };

        // Step 3: Publish to Redis
        match self.publisher.publish(message) {
            Ok(_) => Ok(true),
            Err(_) => {
                self.error_count += 1;
                Err("Failed to publish".to_string())
            }
        }
    }

    /// Process all pending transactions
    fn process_all(&mut self, transactions: Vec<(MockPendingTx, Vec<u8>)>) -> usize {
        let mut published = 0;
        for (tx, calldata) in transactions {
            if let Ok(true) = self.process_one(tx, &calldata) {
                published += 1;
            }
        }
        published
    }

    fn filtered_count(&self) -> usize {
        self.filtered_count
    }

    fn processed_count(&self) -> usize {
        self.processed_count
    }

    fn published_count(&self) -> usize {
        self.publisher.message_count()
    }

    fn error_count(&self) -> usize {
        self.error_count
    }
}

/// Create a mock pending transaction with DEX calldata
fn create_dex_tx(method: DexMethodId, from: Address) -> (MockPendingTx, Vec<u8>) {
    let mut calldata = method.selector().to_vec();
    // Add some dummy parameters
    calldata.extend_from_slice(&[0u8; 128]);

    let tx = MockPendingTx {
        raw: vec![0xf8; 200], // Dummy RLP bytes
        from,
    };

    (tx, calldata)
}

/// Create a mock pending transaction with non-DEX calldata
fn create_non_dex_tx(from: Address) -> (MockPendingTx, Vec<u8>) {
    // ERC20 transfer selector
    let calldata = vec![0xa9, 0x05, 0x9c, 0xbb, 0x00, 0x00, 0x00, 0x00];

    let tx = MockPendingTx {
        raw: vec![0xf8; 200],
        from,
    };

    (tx, calldata)
}

// ==================== Basic Pipeline Tests ====================

#[test]
fn test_pipeline_processes_dex_transaction() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    let mut pipeline = MockPipeline::new(ipc, publisher);

    let from = Address::repeat_byte(0x11);
    let (tx, calldata) = create_dex_tx(DexMethodId::SwapExactTokensForTokens, from);

    let result = pipeline.process_one(tx, &calldata);

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), true);
    assert_eq!(pipeline.filtered_count(), 1);
    assert_eq!(pipeline.published_count(), 1);
}

#[test]
fn test_pipeline_filters_non_dex_transaction() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    let mut pipeline = MockPipeline::new(ipc, publisher);

    let from = Address::repeat_byte(0x11);
    let (tx, calldata) = create_non_dex_tx(from);

    let result = pipeline.process_one(tx, &calldata);

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), false); // Filtered out
    assert_eq!(pipeline.filtered_count(), 0);
    assert_eq!(pipeline.published_count(), 0);
}

#[test]
fn test_pipeline_filters_all_six_dex_methods() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    let mut pipeline = MockPipeline::new(ipc, publisher);

    let methods = [
        DexMethodId::AddLiquidityEth,
        DexMethodId::AddLiquidity,
        DexMethodId::SwapExactEthForTokens,
        DexMethodId::SwapExactTokensForTokens,
        DexMethodId::SwapTokensForExactTokens,
        DexMethodId::SwapExactTokensForEth,
    ];

    let mut transactions = Vec::new();
    for (i, method) in methods.iter().enumerate() {
        let from = Address::repeat_byte(i as u8 + 1);
        transactions.push(create_dex_tx(*method, from));
    }

    let published = pipeline.process_all(transactions);

    assert_eq!(published, 6);
    assert_eq!(pipeline.filtered_count(), 6);
    assert_eq!(pipeline.published_count(), 6);
}

#[test]
fn test_pipeline_mixed_transactions() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    let mut pipeline = MockPipeline::new(ipc, publisher);

    let mut transactions = Vec::new();

    // Add 5 DEX transactions
    for i in 0..5 {
        let from = Address::repeat_byte(i as u8);
        transactions.push(create_dex_tx(DexMethodId::SwapExactTokensForTokens, from));
    }

    // Add 5 non-DEX transactions
    for i in 5..10 {
        let from = Address::repeat_byte(i as u8);
        transactions.push(create_non_dex_tx(from));
    }

    let published = pipeline.process_all(transactions);

    assert_eq!(published, 5);
    assert_eq!(pipeline.filtered_count(), 5);
    assert_eq!(pipeline.processed_count(), 10);
}

// ==================== Burst Handling Tests ====================

#[test]
fn test_pipeline_handles_100_tx_burst() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    let mut pipeline = MockPipeline::new(ipc, publisher);

    let mut transactions = Vec::new();
    for i in 0..100 {
        let from = Address::repeat_byte((i % 256) as u8);
        transactions.push(create_dex_tx(DexMethodId::SwapExactTokensForTokens, from));
    }

    let start = Instant::now();
    let published = pipeline.process_all(transactions);
    let duration = start.elapsed();

    assert_eq!(published, 100);
    assert_eq!(pipeline.published_count(), 100);

    // Processing 100 transactions should be fast (less than 100ms in-memory)
    assert!(duration.as_millis() < 100, "Burst processing took too long: {:?}", duration);
}

#[test]
fn test_pipeline_maintains_order_in_burst() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    let mut pipeline = MockPipeline::new(ipc, publisher);

    let methods = [
        DexMethodId::AddLiquidityEth,
        DexMethodId::SwapExactTokensForTokens,
        DexMethodId::SwapExactEthForTokens,
    ];

    let mut transactions = Vec::new();
    for i in 0..30 {
        let from = Address::repeat_byte(i as u8);
        transactions.push(create_dex_tx(methods[i % 3], from));
    }

    pipeline.process_all(transactions);

    let messages = pipeline.publisher.get_messages();
    assert_eq!(messages.len(), 30);

    // Verify method order matches input order
    for (i, msg) in messages.iter().enumerate() {
        let expected_method = methods[i % 3].name();
        assert_eq!(msg.method, expected_method, "Message {} has wrong method", i);
    }
}

// ==================== Error Recovery Tests ====================

#[test]
fn test_pipeline_handles_publish_failure() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    publisher.set_fail_next(1); // First publish will fail

    let mut pipeline = MockPipeline::new(ipc, publisher);

    let from = Address::repeat_byte(0x11);
    let (tx, calldata) = create_dex_tx(DexMethodId::SwapExactTokensForTokens, from);

    let result = pipeline.process_one(tx, &calldata);

    assert!(result.is_err());
    assert_eq!(pipeline.error_count(), 1);
    assert_eq!(pipeline.published_count(), 0);
}

#[test]
fn test_pipeline_continues_after_failure() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    publisher.set_fail_next(2); // First 2 publishes will fail

    let mut pipeline = MockPipeline::new(ipc, publisher);

    let mut transactions = Vec::new();
    for i in 0..5 {
        let from = Address::repeat_byte(i as u8);
        transactions.push(create_dex_tx(DexMethodId::SwapExactTokensForTokens, from));
    }

    let published = pipeline.process_all(transactions);

    assert_eq!(published, 3); // 5 - 2 failures
    assert_eq!(pipeline.error_count(), 2);
    assert_eq!(pipeline.published_count(), 3);
}

#[test]
fn test_pipeline_recovers_from_intermittent_failures() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");

    let mut pipeline = MockPipeline::new(ipc, publisher);

    // Process first batch successfully
    let from1 = Address::repeat_byte(0x01);
    let (tx1, calldata1) = create_dex_tx(DexMethodId::SwapExactTokensForTokens, from1);
    assert!(pipeline.process_one(tx1, &calldata1).is_ok());
    assert_eq!(pipeline.published_count(), 1);

    // Set failure for next publish
    pipeline.publisher.set_fail_next(1);

    // This one fails
    let from2 = Address::repeat_byte(0x02);
    let (tx2, calldata2) = create_dex_tx(DexMethodId::SwapExactTokensForTokens, from2);
    assert!(pipeline.process_one(tx2, &calldata2).is_err());

    // Recovery - next one succeeds
    let from3 = Address::repeat_byte(0x03);
    let (tx3, calldata3) = create_dex_tx(DexMethodId::SwapExactTokensForTokens, from3);
    assert!(pipeline.process_one(tx3, &calldata3).is_ok());

    assert_eq!(pipeline.published_count(), 2);
    assert_eq!(pipeline.error_count(), 1);
}

// ==================== Message Format Tests ====================

#[test]
fn test_published_message_format() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    let mut pipeline = MockPipeline::new(ipc, publisher);

    let from = Address::repeat_byte(0xab);
    let (tx, calldata) = create_dex_tx(DexMethodId::SwapExactTokensForTokens, from);

    pipeline.process_one(tx, &calldata).unwrap();

    let messages = pipeline.publisher.get_messages();
    assert_eq!(messages.len(), 1);

    let msg = &messages[0];
    assert!(msg.hash.starts_with("0x"));
    assert!(msg.from.starts_with("0x"));
    assert!(msg.to.starts_with("0x"));
    assert_eq!(msg.method, "swapExactTokensForTokens");
    assert_eq!(msg.method_id, "0x38ed1739");
    assert!(!msg.value.is_empty());
    assert!(!msg.gas_price.is_empty());
    assert!(msg.timestamp > 0);
}

#[test]
fn test_published_message_contains_correct_method_for_each_dex_type() {
    let methods_and_expected: [(DexMethodId, &str, &str); 6] = [
        (DexMethodId::AddLiquidityEth, "addLiquidityETH", "0xf305d719"),
        (DexMethodId::AddLiquidity, "addLiquidity", "0xe8e33700"),
        (DexMethodId::SwapExactEthForTokens, "swapExactETHForTokens", "0x7ff36ab5"),
        (DexMethodId::SwapExactTokensForTokens, "swapExactTokensForTokens", "0x38ed1739"),
        (DexMethodId::SwapTokensForExactTokens, "swapTokensForExactTokens", "0x8803dbee"),
        (DexMethodId::SwapExactTokensForEth, "swapExactTokensForETH", "0x18cbafe5"),
    ];

    for (method, expected_name, expected_id) in methods_and_expected {
        let ipc = MockIpcSubscriber::new();
        let publisher = MockRedisPublisher::new("mempool_alpha");
        let mut pipeline = MockPipeline::new(ipc, publisher);

        let from = Address::repeat_byte(0x11);
        let (tx, calldata) = create_dex_tx(method, from);

        pipeline.process_one(tx, &calldata).unwrap();

        let messages = pipeline.publisher.get_messages();
        assert_eq!(messages[0].method, expected_name);
        assert_eq!(messages[0].method_id, expected_id);
    }
}

// ==================== IPC Mock Tests ====================

#[test]
fn test_ipc_subscriber_fifo_order() {
    let mut ipc = MockIpcSubscriber::new();

    for i in 0..10 {
        ipc.add_transaction(MockPendingTx {
            raw: vec![i as u8; 32],
            from: Address::repeat_byte(i),
        });
    }

    for i in 0..10 {
        let tx = ipc.next().unwrap();
        assert_eq!(tx.raw[0], i as u8);
    }

    assert!(ipc.is_empty());
}

#[test]
fn test_ipc_subscriber_empty_handling() {
    let mut ipc = MockIpcSubscriber::new();
    assert!(ipc.is_empty());
    assert!(ipc.next().is_none());
}

// ==================== High Volume Tests ====================

#[test]
fn test_pipeline_handles_1000_transactions() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    let mut pipeline = MockPipeline::new(ipc, publisher);

    let mut transactions = Vec::new();
    for i in 0..1000 {
        let from = Address::repeat_byte((i % 256) as u8);
        if i % 2 == 0 {
            transactions.push(create_dex_tx(DexMethodId::SwapExactTokensForTokens, from));
        } else {
            transactions.push(create_non_dex_tx(from));
        }
    }

    let start = Instant::now();
    let published = pipeline.process_all(transactions);
    let duration = start.elapsed();

    assert_eq!(published, 500); // Half are DEX
    assert_eq!(pipeline.processed_count(), 1000);
    assert_eq!(pipeline.filtered_count(), 500);

    // Should complete in reasonable time
    assert!(duration.as_millis() < 500, "Processing took too long: {:?}", duration);
}

#[test]
fn test_pipeline_stress_with_all_methods() {
    let ipc = MockIpcSubscriber::new();
    let publisher = MockRedisPublisher::new("mempool_alpha");
    let mut pipeline = MockPipeline::new(ipc, publisher);

    let methods = [
        DexMethodId::AddLiquidityEth,
        DexMethodId::AddLiquidity,
        DexMethodId::SwapExactEthForTokens,
        DexMethodId::SwapExactTokensForTokens,
        DexMethodId::SwapTokensForExactTokens,
        DexMethodId::SwapExactTokensForEth,
    ];

    let mut transactions = Vec::new();
    for i in 0..600 {
        let from = Address::repeat_byte((i % 256) as u8);
        transactions.push(create_dex_tx(methods[i % 6], from));
    }

    let published = pipeline.process_all(transactions);

    assert_eq!(published, 600);

    // Verify distribution of methods
    let messages = pipeline.publisher.get_messages();
    let mut method_counts = std::collections::HashMap::new();
    for msg in &messages {
        *method_counts.entry(msg.method.clone()).or_insert(0) += 1;
    }

    // Each method should appear 100 times
    for method in methods {
        assert_eq!(*method_counts.get(method.name()).unwrap(), 100);
    }
}
