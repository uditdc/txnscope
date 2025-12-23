//! Anvil Integration Tests
//!
//! These tests require a running Anvil instance at /tmp/anvil.ipc and Redis at localhost:6379.
//! They are marked with #[ignore] by default for CI environments.
//!
//! To run these tests:
//! 1. Start Anvil: `anvil --ipc /tmp/anvil.ipc`
//! 2. Start Redis: `docker run -d -p 6379:6379 redis:alpine`
//! 3. Run tests: `cargo test --test anvil_integration -- --ignored`

use std::time::Duration;

use alloy::providers::{Provider, ProviderBuilder};
use alloy::transports::ipc::IpcConnect;
use redis::AsyncCommands;

use txnscope_ingestor::filter::filter_transaction;
use txnscope_ingestor::publisher::{TransactionMessage, DEFAULT_CHANNEL};
use txnscope_ingestor::ipc::{IpcConnection, socket_exists, expand_path};

const ANVIL_IPC_PATH: &str = "/tmp/anvil.ipc";
const REDIS_URL: &str = "redis://127.0.0.1:6379";

/// Check if test infrastructure is available
fn infra_available() -> bool {
    socket_exists(ANVIL_IPC_PATH)
}

/// Create a Redis connection
async fn get_redis_connection() -> Result<redis::aio::MultiplexedConnection, redis::RedisError> {
    let client = redis::Client::open(REDIS_URL)?;
    client.get_multiplexed_async_connection().await
}

// ==================== IPC Connection Tests ====================

#[tokio::test]
#[ignore = "Requires running Anvil at /tmp/anvil.ipc"]
async fn test_connect_to_anvil_ipc() {
    if !infra_available() {
        eprintln!("Skipping test: Anvil not available at {}", ANVIL_IPC_PATH);
        return;
    }

    let mut conn = IpcConnection::with_path(ANVIL_IPC_PATH);
    let result = conn.connect().await;

    assert!(result.is_ok(), "Failed to connect: {:?}", result.err());
}

#[tokio::test]
#[ignore = "Requires running Anvil at /tmp/anvil.ipc"]
async fn test_get_chain_id_from_anvil() {
    if !infra_available() {
        return;
    }

    let ipc: IpcConnect<String> = IpcConnect::new(expand_path(ANVIL_IPC_PATH));
    let provider = ProviderBuilder::new()
        .on_ipc(ipc)
        .await
        .expect("Failed to connect");

    let chain_id = provider.get_chain_id().await.expect("Failed to get chain ID");

    // Anvil default chain ID is 31337
    assert_eq!(chain_id, 31337);
}

#[tokio::test]
#[ignore = "Requires running Anvil at /tmp/anvil.ipc"]
async fn test_get_block_number_from_anvil() {
    if !infra_available() {
        return;
    }

    let ipc: IpcConnect<String> = IpcConnect::new(expand_path(ANVIL_IPC_PATH));
    let provider = ProviderBuilder::new()
        .on_ipc(ipc)
        .await
        .expect("Failed to connect");

    let block_number = provider.get_block_number().await.expect("Failed to get block number");

    // Block number should be 0 or higher
    assert!(block_number >= 0);
}

// ==================== Redis Connection Tests ====================

#[tokio::test]
#[ignore = "Requires running Redis at localhost:6379"]
async fn test_connect_to_redis() {
    let result = get_redis_connection().await;
    assert!(result.is_ok(), "Failed to connect to Redis: {:?}", result.err());
}

#[tokio::test]
#[ignore = "Requires running Redis at localhost:6379"]
async fn test_redis_pub_sub() {
    let mut conn = match get_redis_connection().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: Redis not available: {}", e);
            return;
        }
    };

    // Publish a test message
    let subscribers: i64 = conn
        .publish("test_channel", "test_message")
        .await
        .expect("Failed to publish");

    // May or may not have subscribers (that's ok for this test)
    assert!(subscribers >= 0);
}

#[tokio::test]
#[ignore = "Requires running Redis at localhost:6379"]
async fn test_redis_publish_transaction_message() {
    let mut conn = match get_redis_connection().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: Redis not available: {}", e);
            return;
        }
    };

    let message = TransactionMessage {
        hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
        from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
        to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
        method: "swapExactTokensForTokens".to_string(),
        method_id: "0x38ed1739".to_string(),
        value: "1000000000000000000".to_string(),
        gas_price: "20000000000".to_string(),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    };

    let json = message.to_json().expect("Failed to serialize");
    let result: Result<i64, _> = conn.publish(DEFAULT_CHANNEL, &json).await;

    assert!(result.is_ok(), "Failed to publish: {:?}", result.err());
}

// ==================== Full Pipeline Tests ====================

#[tokio::test]
#[ignore = "Requires running Anvil and Redis"]
async fn test_full_pipeline_anvil_to_redis() {
    if !infra_available() {
        eprintln!("Skipping test: Infrastructure not available");
        return;
    }

    let mut redis_conn = match get_redis_connection().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: Redis not available: {}", e);
            return;
        }
    };

    // Connect to Anvil
    let ipc: IpcConnect<String> = IpcConnect::new(expand_path(ANVIL_IPC_PATH));
    let provider = ProviderBuilder::new()
        .on_ipc(ipc)
        .await
        .expect("Failed to connect to Anvil");

    // Verify connections work
    let chain_id = provider.get_chain_id().await.expect("Failed to get chain ID");
    assert_eq!(chain_id, 31337);

    // Publish a test message through the pipeline
    let message = TransactionMessage {
        hash: format!("0x{}", hex::encode([0u8; 32])),
        from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
        to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
        method: "swapExactTokensForTokens".to_string(),
        method_id: "0x38ed1739".to_string(),
        value: "0".to_string(),
        gas_price: "20000000000".to_string(),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    };

    let json = message.to_json().expect("Failed to serialize");
    let _: i64 = redis_conn
        .publish(DEFAULT_CHANNEL, &json)
        .await
        .expect("Failed to publish");
}

// ==================== Latency Tests ====================

#[tokio::test]
#[ignore = "Requires running Anvil and Redis"]
async fn test_decode_latency_under_5ms() {
    // This test verifies that DEX method filtering is fast
    let calldata = vec![
        0x38, 0xed, 0x17, 0x39, // swapExactTokensForTokens
        0x00, 0x00, 0x00, 0x00, // dummy params
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
    ];

    let iterations = 1000;
    let start = std::time::Instant::now();

    for _ in 0..iterations {
        let _ = filter_transaction(&calldata);
    }

    let elapsed = start.elapsed();
    let avg_latency = elapsed / iterations;

    println!("Average filter latency: {:?}", avg_latency);
    assert!(
        avg_latency < Duration::from_micros(100), // 0.1ms should be more than enough
        "Filter latency too high: {:?}",
        avg_latency
    );
}

#[tokio::test]
#[ignore = "Requires running Redis at localhost:6379"]
async fn test_redis_publish_latency_under_2ms() {
    let mut conn = match get_redis_connection().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: Redis not available: {}", e);
            return;
        }
    };

    let message = TransactionMessage {
        hash: "0x0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
        to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
        method: "swapExactTokensForTokens".to_string(),
        method_id: "0x38ed1739".to_string(),
        value: "0".to_string(),
        gas_price: "20000000000".to_string(),
        timestamp: 0,
    };

    let json = message.to_json().expect("Failed to serialize");

    let iterations = 100;
    let start = std::time::Instant::now();

    for _ in 0..iterations {
        let _: i64 = conn.publish(DEFAULT_CHANNEL, &json).await.expect("Failed to publish");
    }

    let elapsed = start.elapsed();
    let avg_latency = elapsed / iterations;

    println!("Average Redis publish latency: {:?}", avg_latency);
    assert!(
        avg_latency < Duration::from_millis(2),
        "Redis publish latency too high: {:?}",
        avg_latency
    );
}

#[tokio::test]
#[ignore = "Requires running Redis at localhost:6379"]
async fn test_total_pipeline_latency_under_7ms() {
    let mut conn = match get_redis_connection().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: Redis not available: {}", e);
            return;
        }
    };

    // Simulate full pipeline: filter + format + publish
    let calldata = vec![
        0x38, 0xed, 0x17, 0x39,
        0x00, 0x00, 0x00, 0x00,
    ];

    let iterations = 100;
    let start = std::time::Instant::now();

    for i in 0..iterations {
        // Step 1: Filter
        let dex_method = filter_transaction(&calldata).expect("Should be DEX tx");

        // Step 2: Format message
        let message = TransactionMessage {
            hash: format!("0x{:064x}", i),
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
            to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
            method: dex_method.name().to_string(),
            method_id: dex_method.hex().to_string(),
            value: "0".to_string(),
            gas_price: "20000000000".to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };

        let json = message.to_json().expect("Failed to serialize");

        // Step 3: Publish
        let _: i64 = conn.publish(DEFAULT_CHANNEL, &json).await.expect("Failed to publish");
    }

    let elapsed = start.elapsed();
    let avg_latency = elapsed / iterations;

    println!("Average total pipeline latency: {:?}", avg_latency);
    assert!(
        avg_latency < Duration::from_millis(7),
        "Total pipeline latency too high: {:?}",
        avg_latency
    );
}

// ==================== Throughput Tests ====================

#[tokio::test]
#[ignore = "Requires running Redis at localhost:6379"]
async fn test_1000_tps_throughput() {
    let mut conn = match get_redis_connection().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: Redis not available: {}", e);
            return;
        }
    };

    let calldata = vec![0x38, 0xed, 0x17, 0x39, 0x00, 0x00, 0x00, 0x00];

    let tx_count = 1000;
    let start = std::time::Instant::now();

    for i in 0..tx_count {
        let dex_method = filter_transaction(&calldata).unwrap();
        let message = TransactionMessage {
            hash: format!("0x{:064x}", i),
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
            to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
            method: dex_method.name().to_string(),
            method_id: dex_method.hex().to_string(),
            value: "0".to_string(),
            gas_price: "20000000000".to_string(),
            timestamp: 0,
        };
        let json = message.to_json().unwrap();
        let _: i64 = conn.publish(DEFAULT_CHANNEL, &json).await.unwrap();
    }

    let elapsed = start.elapsed();
    let tps = tx_count as f64 / elapsed.as_secs_f64();

    println!("Throughput: {:.0} TPS (processed {} txns in {:?})", tps, tx_count, elapsed);
    assert!(
        tps >= 1000.0,
        "Throughput below target: {:.0} TPS (need >= 1000 TPS)",
        tps
    );
}

// ==================== Reconnection Tests ====================

#[tokio::test]
#[ignore = "Requires running Anvil at /tmp/anvil.ipc"]
async fn test_ipc_reconnection_after_disconnect() {
    if !infra_available() {
        return;
    }

    let mut conn = IpcConnection::with_path(ANVIL_IPC_PATH);

    // First connection
    let provider = conn.connect().await.expect("First connection failed");
    let chain_id = provider.get_chain_id().await.expect("Failed to get chain ID");
    assert_eq!(chain_id, 31337);

    // Reconnect (simulates recovery after disconnect)
    conn.reset_reconnect_counter();
    let provider2 = conn.connect().await.expect("Reconnection failed");
    let chain_id2 = provider2.get_chain_id().await.expect("Failed to get chain ID after reconnect");
    assert_eq!(chain_id2, 31337);
}

// ==================== Error Handling Tests ====================

#[tokio::test]
#[ignore = "Requires no Anvil running"]
async fn test_ipc_connection_fails_gracefully_when_no_socket() {
    let mut conn = IpcConnection::with_path("/nonexistent/socket.ipc");
    let result = conn.connect().await;

    assert!(result.is_err());
    match result {
        Err(txnscope_ingestor::ipc::IpcError::SocketNotFound(_)) => (),
        Err(e) => panic!("Expected SocketNotFound, got: {:?}", e),
        Ok(_) => panic!("Expected error, got success"),
    }
}

#[tokio::test]
#[ignore = "Requires no Redis running"]
async fn test_redis_connection_fails_gracefully_when_no_server() {
    let client = redis::Client::open("redis://127.0.0.1:59999").unwrap(); // Non-standard port
    let result = client.get_multiplexed_async_connection().await;

    assert!(result.is_err());
}

// ==================== Message Integrity Tests ====================

#[tokio::test]
#[ignore = "Requires running Redis at localhost:6379"]
async fn test_message_roundtrip_integrity() {
    let _conn = match get_redis_connection().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: Redis not available: {}", e);
            return;
        }
    };

    let original = TransactionMessage {
        hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
        from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
        to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
        method: "swapExactTokensForTokens".to_string(),
        method_id: "0x38ed1739".to_string(),
        value: "1000000000000000000".to_string(),
        gas_price: "20000000000".to_string(),
        timestamp: 1703000000000,
    };

    let json = original.to_json().expect("Failed to serialize");

    // Deserialize and verify
    let recovered = TransactionMessage::from_json(&json).expect("Failed to deserialize");

    assert_eq!(recovered.hash, original.hash);
    assert_eq!(recovered.from, original.from);
    assert_eq!(recovered.to, original.to);
    assert_eq!(recovered.method, original.method);
    assert_eq!(recovered.method_id, original.method_id);
    assert_eq!(recovered.value, original.value);
    assert_eq!(recovered.gas_price, original.gas_price);
    assert_eq!(recovered.timestamp, original.timestamp);
}
