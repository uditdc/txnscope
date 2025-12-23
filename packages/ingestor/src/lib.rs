//! TxnScope Ingestor Library
//!
//! This crate provides components for ingesting pending blockchain transactions,
//! filtering for DEX-related methods, and publishing to Redis.

pub mod decoder;
pub mod filter;
pub mod ipc;
pub mod publisher;

// Re-export commonly used types
pub use decoder::{decode_transaction, DecodedTransaction};
pub use filter::{is_dex_method, get_method_name, DexMethodId};
pub use publisher::{Publisher, TransactionMessage};
