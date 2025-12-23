//! Redis Publisher
//!
//! Publishes filtered DEX transactions to Redis pub/sub channel.
//! Formats transaction data as JSON for consumption by the Gateway service.

use alloy::primitives::{Address, TxHash, U256};
use redis::aio::MultiplexedConnection;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

use crate::decoder::DecodedTransaction;

/// Default Redis channel for publishing mempool transactions
pub const DEFAULT_CHANNEL: &str = "mempool_alpha";

/// Errors that can occur during publishing
#[derive(Error, Debug)]
pub enum PublishError {
    #[error("Redis connection error: {0}")]
    Connection(#[from] redis::RedisError),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Transaction is not a DEX transaction")]
    NotDexTransaction,
}

/// Transaction message format for Redis publication
///
/// This is the JSON structure that gets published to Redis
/// and consumed by the Gateway service.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransactionMessage {
    /// Transaction hash with 0x prefix
    pub hash: String,
    /// Sender address (checksummed)
    pub from: String,
    /// Recipient address (checksummed), empty string for contract creation
    pub to: String,
    /// Human-readable method name (e.g., "swapExactTokensForTokens")
    pub method: String,
    /// Method ID with 0x prefix (e.g., "0x38ed1739")
    pub method_id: String,
    /// Transaction value in wei as decimal string
    pub value: String,
    /// Gas price in wei as decimal string
    pub gas_price: String,
    /// Unix timestamp in milliseconds when transaction was received
    pub timestamp: u64,
}

impl TransactionMessage {
    /// Create a new TransactionMessage from a DecodedTransaction
    ///
    /// # Arguments
    /// * `tx` - The decoded transaction
    ///
    /// # Returns
    /// `Some(TransactionMessage)` if the transaction is a DEX transaction, `None` otherwise
    pub fn from_decoded(tx: &DecodedTransaction) -> Option<Self> {
        let dex_method = tx.dex_method?;

        Some(TransactionMessage {
            hash: format!("{:#x}", tx.hash),
            from: format!("{:#x}", tx.from),
            to: tx.to.map(|a| format!("{:#x}", a)).unwrap_or_default(),
            method: dex_method.name().to_string(),
            method_id: dex_method.hex().to_string(),
            value: tx.value.to_string(),
            gas_price: tx.gas_price.to_string(),
            timestamp: current_timestamp_millis(),
        })
    }

    /// Serialize the message to JSON
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Deserialize a message from JSON
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// Get current timestamp in milliseconds
pub fn current_timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_millis() as u64
}

/// Redis publisher for transaction messages
pub struct Publisher {
    connection: MultiplexedConnection,
    channel: String,
}

impl Publisher {
    /// Create a new publisher with a Redis connection
    ///
    /// # Arguments
    /// * `connection` - An established Redis multiplexed connection
    /// * `channel` - The pub/sub channel name to publish to
    pub fn new(connection: MultiplexedConnection, channel: impl Into<String>) -> Self {
        Self {
            connection,
            channel: channel.into(),
        }
    }

    /// Create a new publisher with the default channel
    pub fn with_default_channel(connection: MultiplexedConnection) -> Self {
        Self::new(connection, DEFAULT_CHANNEL)
    }

    /// Publish a decoded transaction to Redis
    ///
    /// # Arguments
    /// * `tx` - The decoded transaction to publish
    ///
    /// # Returns
    /// The number of subscribers that received the message
    pub async fn publish(&mut self, tx: &DecodedTransaction) -> Result<i64, PublishError> {
        let message = TransactionMessage::from_decoded(tx)
            .ok_or(PublishError::NotDexTransaction)?;

        self.publish_message(&message).await
    }

    /// Publish a pre-formatted message to Redis
    ///
    /// # Arguments
    /// * `message` - The transaction message to publish
    ///
    /// # Returns
    /// The number of subscribers that received the message
    pub async fn publish_message(&mut self, message: &TransactionMessage) -> Result<i64, PublishError> {
        let json = message.to_json()?;
        let subscribers: i64 = self.connection.publish(&self.channel, &json).await?;
        Ok(subscribers)
    }

    /// Get the channel name
    pub fn channel(&self) -> &str {
        &self.channel
    }
}

/// Format an address as checksummed hex string
pub fn format_address(address: Address) -> String {
    format!("{:#x}", address)
}

/// Format a transaction hash as hex string with 0x prefix
pub fn format_hash(hash: TxHash) -> String {
    format!("{:#x}", hash)
}

/// Format a U256 value as decimal string
pub fn format_value(value: U256) -> String {
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filter::DexMethodId;
    use alloy::primitives::{address, b256, Bytes};

    // ==================== TransactionMessage tests ====================

    #[test]
    fn test_message_format_includes_all_fields() {
        let message = TransactionMessage {
            hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
            to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
            method: "swapExactTokensForTokens".to_string(),
            method_id: "0x38ed1739".to_string(),
            value: "1000000000000000000".to_string(),
            gas_price: "20000000000".to_string(),
            timestamp: 1703000000000,
        };

        let json = message.to_json().unwrap();

        // Verify all fields are present
        assert!(json.contains("\"hash\""));
        assert!(json.contains("\"from\""));
        assert!(json.contains("\"to\""));
        assert!(json.contains("\"method\""));
        assert!(json.contains("\"methodId\""));
        assert!(json.contains("\"value\""));
        assert!(json.contains("\"gasPrice\""));
        assert!(json.contains("\"timestamp\""));
    }

    #[test]
    fn test_message_hash_is_prefixed() {
        let message = TransactionMessage {
            hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
            to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
            method: "swapExactTokensForTokens".to_string(),
            method_id: "0x38ed1739".to_string(),
            value: "0".to_string(),
            gas_price: "0".to_string(),
            timestamp: 0,
        };

        assert!(message.hash.starts_with("0x"));
    }

    #[test]
    fn test_message_from_is_prefixed() {
        let message = TransactionMessage {
            hash: "0x0000000000000000000000000000000000000000000000000000000000000000".to_string(),
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
            to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
            method: "swapExactTokensForTokens".to_string(),
            method_id: "0x38ed1739".to_string(),
            value: "0".to_string(),
            gas_price: "0".to_string(),
            timestamp: 0,
        };

        assert!(message.from.starts_with("0x"));
    }

    #[test]
    fn test_message_to_is_prefixed() {
        let message = TransactionMessage {
            hash: "0x0000000000000000000000000000000000000000000000000000000000000000".to_string(),
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
            to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
            method: "swapExactTokensForTokens".to_string(),
            method_id: "0x38ed1739".to_string(),
            value: "0".to_string(),
            gas_price: "0".to_string(),
            timestamp: 0,
        };

        assert!(message.to.starts_with("0x"));
    }

    #[test]
    fn test_message_method_is_human_readable() {
        let message = TransactionMessage {
            hash: "0x0".to_string(),
            from: "0x0".to_string(),
            to: "0x0".to_string(),
            method: "swapExactTokensForTokens".to_string(),
            method_id: "0x38ed1739".to_string(),
            value: "0".to_string(),
            gas_price: "0".to_string(),
            timestamp: 0,
        };

        // Method name should NOT start with 0x (it's human readable)
        assert!(!message.method.starts_with("0x"));
        assert_eq!(message.method, "swapExactTokensForTokens");
    }

    #[test]
    fn test_message_method_id_is_hex() {
        let message = TransactionMessage {
            hash: "0x0".to_string(),
            from: "0x0".to_string(),
            to: "0x0".to_string(),
            method: "swapExactTokensForTokens".to_string(),
            method_id: "0x38ed1739".to_string(),
            value: "0".to_string(),
            gas_price: "0".to_string(),
            timestamp: 0,
        };

        assert!(message.method_id.starts_with("0x"));
        assert_eq!(message.method_id.len(), 10); // "0x" + 8 hex chars
    }

    #[test]
    fn test_message_value_is_decimal_string() {
        let message = TransactionMessage {
            hash: "0x0".to_string(),
            from: "0x0".to_string(),
            to: "0x0".to_string(),
            method: "swapExactTokensForTokens".to_string(),
            method_id: "0x38ed1739".to_string(),
            value: "1000000000000000000".to_string(),
            gas_price: "0".to_string(),
            timestamp: 0,
        };

        // Value should NOT start with 0x (it's decimal)
        assert!(!message.value.starts_with("0x"));
        // Should be parseable as u128
        let parsed: u128 = message.value.parse().unwrap();
        assert_eq!(parsed, 1000000000000000000u128);
    }

    #[test]
    fn test_message_timestamp_is_unix_millis() {
        let message = TransactionMessage {
            hash: "0x0".to_string(),
            from: "0x0".to_string(),
            to: "0x0".to_string(),
            method: "swapExactTokensForTokens".to_string(),
            method_id: "0x38ed1739".to_string(),
            value: "0".to_string(),
            gas_price: "0".to_string(),
            timestamp: 1703000000000, // Dec 2023 in millis
        };

        // Timestamp should be in the reasonable range for milliseconds (13+ digits in 2020s)
        assert!(message.timestamp > 1600000000000); // After 2020
        assert!(message.timestamp < 2000000000000); // Before 2033
    }

    #[test]
    fn test_message_valid_json() {
        let message = TransactionMessage {
            hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
            to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
            method: "swapExactTokensForTokens".to_string(),
            method_id: "0x38ed1739".to_string(),
            value: "1000000000000000000".to_string(),
            gas_price: "20000000000".to_string(),
            timestamp: 1703000000000,
        };

        let json = message.to_json().unwrap();

        // Should parse back correctly
        let parsed: TransactionMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, message);
    }

    #[test]
    fn test_message_from_json() {
        let json = r#"{
            "hash": "0x1234",
            "from": "0xabcd",
            "to": "0xef01",
            "method": "swapExactTokensForTokens",
            "methodId": "0x38ed1739",
            "value": "1000",
            "gasPrice": "2000",
            "timestamp": 1234567890
        }"#;

        let message = TransactionMessage::from_json(json).unwrap();
        assert_eq!(message.hash, "0x1234");
        assert_eq!(message.from, "0xabcd");
        assert_eq!(message.to, "0xef01");
        assert_eq!(message.method, "swapExactTokensForTokens");
        assert_eq!(message.method_id, "0x38ed1739");
        assert_eq!(message.value, "1000");
        assert_eq!(message.gas_price, "2000");
        assert_eq!(message.timestamp, 1234567890);
    }

    // ==================== TransactionMessage::from_decoded tests ====================

    #[test]
    fn test_message_from_decoded_dex_transaction() {
        use crate::decoder::DecodedTransaction;

        let tx = DecodedTransaction {
            hash: b256!("1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"),
            from: address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
            to: Some(address!("7a250d5630B4cF539739dF2C5dAcb4c659F2488D")),
            value: U256::from(1000000000000000000u64),
            gas_price: 20000000000,
            input: Bytes::from(vec![0x38, 0xed, 0x17, 0x39]),
            method_id: Some([0x38, 0xed, 0x17, 0x39]),
            dex_method: Some(DexMethodId::SwapExactTokensForTokens),
            nonce: 0,
            gas_limit: 200000,
        };

        let message = TransactionMessage::from_decoded(&tx).unwrap();

        assert!(message.hash.starts_with("0x"));
        assert!(message.from.starts_with("0x"));
        assert!(message.to.starts_with("0x"));
        assert_eq!(message.method, "swapExactTokensForTokens");
        assert_eq!(message.method_id, "0x38ed1739");
        assert_eq!(message.value, "1000000000000000000");
        assert_eq!(message.gas_price, "20000000000");
    }

    #[test]
    fn test_message_from_decoded_non_dex_returns_none() {
        use crate::decoder::DecodedTransaction;

        let tx = DecodedTransaction {
            hash: TxHash::ZERO,
            from: Address::ZERO,
            to: Some(Address::ZERO),
            value: U256::ZERO,
            gas_price: 0,
            input: Bytes::from(vec![0xa9, 0x05, 0x9c, 0xbb]), // ERC20 transfer
            method_id: Some([0xa9, 0x05, 0x9c, 0xbb]),
            dex_method: None, // Not a DEX method
            nonce: 0,
            gas_limit: 21000,
        };

        let message = TransactionMessage::from_decoded(&tx);
        assert!(message.is_none());
    }

    #[test]
    fn test_message_from_decoded_contract_creation() {
        use crate::decoder::DecodedTransaction;

        // Contract creation has no `to` address, but could still be filtered
        // (in practice, contract creation wouldn't match DEX methods)
        let tx = DecodedTransaction {
            hash: TxHash::ZERO,
            from: address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
            to: None, // Contract creation
            value: U256::ZERO,
            gas_price: 20000000000,
            input: Bytes::from(vec![0x38, 0xed, 0x17, 0x39]),
            method_id: Some([0x38, 0xed, 0x17, 0x39]),
            dex_method: Some(DexMethodId::SwapExactTokensForTokens),
            nonce: 0,
            gas_limit: 200000,
        };

        let message = TransactionMessage::from_decoded(&tx).unwrap();
        // `to` should be empty string for contract creation
        assert_eq!(message.to, "");
    }

    // ==================== Format helper tests ====================

    #[test]
    fn test_format_address() {
        let addr = address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        let formatted = format_address(addr);
        assert!(formatted.starts_with("0x"));
        assert_eq!(formatted.len(), 42); // "0x" + 40 hex chars
    }

    #[test]
    fn test_format_hash() {
        let hash = b256!("1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
        let formatted = format_hash(hash);
        assert!(formatted.starts_with("0x"));
        assert_eq!(formatted.len(), 66); // "0x" + 64 hex chars
    }

    #[test]
    fn test_format_value() {
        let value = U256::from(1000000000000000000u64);
        let formatted = format_value(value);
        assert_eq!(formatted, "1000000000000000000");
    }

    #[test]
    fn test_format_value_zero() {
        let value = U256::ZERO;
        let formatted = format_value(value);
        assert_eq!(formatted, "0");
    }

    #[test]
    fn test_format_value_large() {
        // 1000 ETH in wei
        let value = U256::from(1000u64) * U256::from(10u64).pow(U256::from(18));
        let formatted = format_value(value);
        assert_eq!(formatted, "1000000000000000000000");
    }

    // ==================== current_timestamp_millis tests ====================

    #[test]
    fn test_current_timestamp_is_reasonable() {
        let ts = current_timestamp_millis();
        // Should be after Jan 1, 2024 (1704067200000 ms)
        assert!(ts > 1704067200000);
        // Should be before Jan 1, 2030 (1893456000000 ms)
        assert!(ts < 1893456000000);
    }

    #[test]
    fn test_current_timestamp_increases() {
        let ts1 = current_timestamp_millis();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let ts2 = current_timestamp_millis();
        assert!(ts2 >= ts1);
    }

    // ==================== DEFAULT_CHANNEL tests ====================

    #[test]
    fn test_default_channel() {
        assert_eq!(DEFAULT_CHANNEL, "mempool_alpha");
    }

    // ==================== All 6 DEX methods message format tests ====================

    #[test]
    fn test_all_dex_methods_format_correctly() {
        use crate::decoder::DecodedTransaction;

        let methods = [
            (DexMethodId::AddLiquidityEth, "addLiquidityETH", "0xf305d719"),
            (DexMethodId::AddLiquidity, "addLiquidity", "0xe8e33700"),
            (DexMethodId::SwapExactEthForTokens, "swapExactETHForTokens", "0x7ff36ab5"),
            (DexMethodId::SwapExactTokensForTokens, "swapExactTokensForTokens", "0x38ed1739"),
            (DexMethodId::SwapTokensForExactTokens, "swapTokensForExactTokens", "0x8803dbee"),
            (DexMethodId::SwapExactTokensForEth, "swapExactTokensForETH", "0x18cbafe5"),
        ];

        for (dex_method, expected_name, expected_id) in methods {
            let tx = DecodedTransaction {
                hash: TxHash::ZERO,
                from: Address::ZERO,
                to: Some(Address::ZERO),
                value: U256::ZERO,
                gas_price: 0,
                input: Bytes::from(dex_method.selector().to_vec()),
                method_id: Some(dex_method.selector()),
                dex_method: Some(dex_method),
                nonce: 0,
                gas_limit: 21000,
            };

            let message = TransactionMessage::from_decoded(&tx).unwrap();
            assert_eq!(message.method, expected_name, "Method name mismatch for {:?}", dex_method);
            assert_eq!(message.method_id, expected_id, "Method ID mismatch for {:?}", dex_method);
        }
    }
}
