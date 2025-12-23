//! Transaction Decoder
//!
//! Decodes pending transactions from RLP-encoded bytes and extracts relevant fields.
//! Supports legacy (type 0), EIP-2930 (type 1), and EIP-1559 (type 2) transactions.

use alloy::consensus::TxEnvelope;
use alloy::primitives::{Address, Bytes, TxHash, U256};
use thiserror::Error;

use crate::filter::{filter_transaction, DexMethodId};

/// Errors that can occur during transaction decoding
#[derive(Error, Debug)]
pub enum DecodeError {
    #[error("Failed to decode RLP: {0}")]
    RlpDecode(String),

    #[error("Empty input data")]
    EmptyInput,

    #[error("Transaction input too short for method extraction")]
    InputTooShort,

    #[error("Invalid transaction type: {0}")]
    InvalidTxType(u8),
}

/// Decoded transaction with extracted fields
#[derive(Debug, Clone)]
pub struct DecodedTransaction {
    /// Transaction hash
    pub hash: TxHash,
    /// Sender address
    pub from: Address,
    /// Recipient address (None for contract creation)
    pub to: Option<Address>,
    /// Transaction value in wei
    pub value: U256,
    /// Gas price (for legacy/EIP-2930) or max fee per gas (for EIP-1559)
    pub gas_price: u128,
    /// Transaction input data (calldata)
    pub input: Bytes,
    /// Extracted method ID (first 4 bytes of input), if present
    pub method_id: Option<[u8; 4]>,
    /// DEX method type, if this is a DEX transaction
    pub dex_method: Option<DexMethodId>,
    /// Transaction nonce
    pub nonce: u64,
    /// Gas limit
    pub gas_limit: u64,
}

impl DecodedTransaction {
    /// Check if this transaction is a DEX transaction we care about
    pub fn is_dex_transaction(&self) -> bool {
        self.dex_method.is_some()
    }

    /// Get the method ID as a hex string with 0x prefix
    pub fn method_id_hex(&self) -> Option<String> {
        self.method_id.map(|id| format!("0x{}", hex::encode(id)))
    }
}

/// Extract transaction fields from a TxEnvelope
fn extract_tx_fields(tx_envelope: &TxEnvelope) -> (Bytes, Option<Address>, U256, u128, u64, u64) {
    match tx_envelope {
        TxEnvelope::Legacy(signed) => {
            let tx = signed.tx();
            (
                tx.input.clone(),
                tx.to.to().copied(),
                tx.value,
                tx.gas_price,
                tx.nonce,
                tx.gas_limit,
            )
        }
        TxEnvelope::Eip2930(signed) => {
            let tx = signed.tx();
            (
                tx.input.clone(),
                tx.to.to().copied(),
                tx.value,
                tx.gas_price,
                tx.nonce,
                tx.gas_limit,
            )
        }
        TxEnvelope::Eip1559(signed) => {
            let tx = signed.tx();
            (
                tx.input.clone(),
                tx.to.to().copied(),
                tx.value,
                tx.max_fee_per_gas,
                tx.nonce,
                tx.gas_limit,
            )
        }
        TxEnvelope::Eip4844(signed) => {
            let tx = signed.tx().tx();
            (
                tx.input.clone(),
                Some(tx.to),
                tx.value,
                tx.max_fee_per_gas,
                tx.nonce,
                tx.gas_limit,
            )
        }
        _ => (Bytes::new(), None, U256::ZERO, 0, 0, 0),
    }
}

/// Decode a transaction from RLP-encoded bytes
///
/// # Arguments
/// * `rlp_bytes` - The RLP-encoded transaction bytes
/// * `from` - The sender address (recovered from signature or provided externally)
///
/// # Returns
/// A `DecodedTransaction` with all relevant fields extracted
pub fn decode_transaction(rlp_bytes: &[u8], from: Address) -> Result<DecodedTransaction, DecodeError> {
    if rlp_bytes.is_empty() {
        return Err(DecodeError::EmptyInput);
    }

    // Decode the transaction envelope (handles all transaction types)
    let tx_envelope: TxEnvelope = alloy::rlp::Decodable::decode(&mut &rlp_bytes[..])
        .map_err(|e| DecodeError::RlpDecode(e.to_string()))?;

    // Extract fields based on transaction type
    let (input, to, value, gas_price, nonce, gas_limit) = extract_tx_fields(&tx_envelope);
    let method_id = extract_method_id(&input);
    let dex_method = filter_transaction(&input);

    Ok(DecodedTransaction {
        hash: *tx_envelope.tx_hash(),
        from,
        to,
        value,
        gas_price,
        input,
        method_id,
        dex_method,
        nonce,
        gas_limit,
    })
}

/// Extract method ID from transaction input data
///
/// # Arguments
/// * `input` - The transaction input/calldata
///
/// # Returns
/// `Some([u8; 4])` if input has at least 4 bytes, `None` otherwise
pub fn extract_method_id(input: &[u8]) -> Option<[u8; 4]> {
    if input.len() < 4 {
        return None;
    }
    let mut method_id = [0u8; 4];
    method_id.copy_from_slice(&input[..4]);
    Some(method_id)
}

/// Parse a hex string to bytes (with or without 0x prefix)
pub fn hex_to_bytes(hex_str: &str) -> Result<Vec<u8>, DecodeError> {
    let hex_str = hex_str.strip_prefix("0x").unwrap_or(hex_str);
    hex::decode(hex_str).map_err(|e| DecodeError::RlpDecode(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::address;

    // ==================== extract_method_id tests ====================

    #[test]
    fn test_extract_method_id_from_valid_input() {
        let input = vec![0x38, 0xed, 0x17, 0x39, 0x00, 0x00, 0x00, 0x00];
        assert_eq!(extract_method_id(&input), Some([0x38, 0xed, 0x17, 0x39]));
    }

    #[test]
    fn test_extract_method_id_from_exact_4_bytes() {
        let input = vec![0x38, 0xed, 0x17, 0x39];
        assert_eq!(extract_method_id(&input), Some([0x38, 0xed, 0x17, 0x39]));
    }

    #[test]
    fn test_extract_method_id_from_empty_input() {
        let input: Vec<u8> = vec![];
        assert_eq!(extract_method_id(&input), None);
    }

    #[test]
    fn test_extract_method_id_from_short_input() {
        let input = vec![0x38, 0xed, 0x17]; // Only 3 bytes
        assert_eq!(extract_method_id(&input), None);
    }

    #[test]
    fn test_extract_method_id_from_1_byte_input() {
        let input = vec![0x38];
        assert_eq!(extract_method_id(&input), None);
    }

    #[test]
    fn test_extract_method_id_from_2_bytes_input() {
        let input = vec![0x38, 0xed];
        assert_eq!(extract_method_id(&input), None);
    }

    // ==================== hex_to_bytes tests ====================

    #[test]
    fn test_hex_to_bytes_with_prefix() {
        let result = hex_to_bytes("0x38ed1739").unwrap();
        assert_eq!(result, vec![0x38, 0xed, 0x17, 0x39]);
    }

    #[test]
    fn test_hex_to_bytes_without_prefix() {
        let result = hex_to_bytes("38ed1739").unwrap();
        assert_eq!(result, vec![0x38, 0xed, 0x17, 0x39]);
    }

    #[test]
    fn test_hex_to_bytes_empty() {
        let result = hex_to_bytes("").unwrap();
        assert_eq!(result, Vec::<u8>::new());
    }

    #[test]
    fn test_hex_to_bytes_invalid() {
        let result = hex_to_bytes("0xGGGG");
        assert!(result.is_err());
    }

    // ==================== DecodedTransaction tests ====================

    #[test]
    fn test_decoded_transaction_is_dex_with_swap() {
        let tx = DecodedTransaction {
            hash: TxHash::ZERO,
            from: Address::ZERO,
            to: Some(Address::ZERO),
            value: U256::ZERO,
            gas_price: 0,
            input: Bytes::from(vec![0x38, 0xed, 0x17, 0x39, 0x00]),
            method_id: Some([0x38, 0xed, 0x17, 0x39]),
            dex_method: Some(DexMethodId::SwapExactTokensForTokens),
            nonce: 0,
            gas_limit: 21000,
        };
        assert!(tx.is_dex_transaction());
    }

    #[test]
    fn test_decoded_transaction_is_not_dex_with_transfer() {
        let tx = DecodedTransaction {
            hash: TxHash::ZERO,
            from: Address::ZERO,
            to: Some(Address::ZERO),
            value: U256::ZERO,
            gas_price: 0,
            input: Bytes::from(vec![0xa9, 0x05, 0x9c, 0xbb, 0x00]),
            method_id: Some([0xa9, 0x05, 0x9c, 0xbb]),
            dex_method: None,
            nonce: 0,
            gas_limit: 21000,
        };
        assert!(!tx.is_dex_transaction());
    }

    #[test]
    fn test_decoded_transaction_method_id_hex() {
        let tx = DecodedTransaction {
            hash: TxHash::ZERO,
            from: Address::ZERO,
            to: Some(Address::ZERO),
            value: U256::ZERO,
            gas_price: 0,
            input: Bytes::from(vec![0x38, 0xed, 0x17, 0x39]),
            method_id: Some([0x38, 0xed, 0x17, 0x39]),
            dex_method: Some(DexMethodId::SwapExactTokensForTokens),
            nonce: 0,
            gas_limit: 21000,
        };
        assert_eq!(tx.method_id_hex(), Some("0x38ed1739".to_string()));
    }

    #[test]
    fn test_decoded_transaction_method_id_hex_none() {
        let tx = DecodedTransaction {
            hash: TxHash::ZERO,
            from: Address::ZERO,
            to: Some(Address::ZERO),
            value: U256::ZERO,
            gas_price: 0,
            input: Bytes::new(),
            method_id: None,
            dex_method: None,
            nonce: 0,
            gas_limit: 21000,
        };
        assert_eq!(tx.method_id_hex(), None);
    }

    // ==================== decode_transaction tests ====================

    #[test]
    fn test_decode_empty_input_returns_error() {
        let from = address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        let result = decode_transaction(&[], from);
        assert!(matches!(result, Err(DecodeError::EmptyInput)));
    }

    #[test]
    fn test_decode_invalid_rlp_returns_error() {
        let from = address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        let invalid_rlp = vec![0xff, 0xff, 0xff, 0xff];
        let result = decode_transaction(&invalid_rlp, from);
        assert!(matches!(result, Err(DecodeError::RlpDecode(_))));
    }

    // ==================== Integration with fixtures ====================

    #[test]
    fn test_extract_method_from_swap_exact_tokens_calldata() {
        // swapExactTokensForTokens calldata from fixtures
        let calldata = hex_to_bytes("0x38ed17390000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000677f50000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48").unwrap();

        let method_id = extract_method_id(&calldata);
        assert_eq!(method_id, Some([0x38, 0xed, 0x17, 0x39]));
    }

    #[test]
    fn test_extract_method_from_add_liquidity_eth_calldata() {
        // addLiquidityETH calldata from fixtures
        let calldata = hex_to_bytes("0xf305d7190000000000000000000000001234567890abcdef1234567890abcdef1234567800000000000000000000000000000000000000000000d3c21bcecceda100000000000000000000000000000000000000000000000000d3c21bcecceda10000000000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000677f5000").unwrap();

        let method_id = extract_method_id(&calldata);
        assert_eq!(method_id, Some([0xf3, 0x05, 0xd7, 0x19]));
    }

    #[test]
    fn test_filter_swap_exact_tokens_calldata() {
        let calldata = hex_to_bytes("0x38ed17390000000000000000000000000000000000000000000000000de0b6b3a7640000").unwrap();
        let dex_method = filter_transaction(&calldata);
        assert_eq!(dex_method, Some(DexMethodId::SwapExactTokensForTokens));
    }

    #[test]
    fn test_filter_add_liquidity_eth_calldata() {
        let calldata = hex_to_bytes("0xf305d7190000000000000000000000001234567890abcdef1234567890abcdef12345678").unwrap();
        let dex_method = filter_transaction(&calldata);
        assert_eq!(dex_method, Some(DexMethodId::AddLiquidityEth));
    }

    #[test]
    fn test_filter_swap_tokens_for_exact_tokens_calldata() {
        let calldata = hex_to_bytes("0x8803dbee000000000000000000000000000000000000000000000000000000003b9aca00").unwrap();
        let dex_method = filter_transaction(&calldata);
        assert_eq!(dex_method, Some(DexMethodId::SwapTokensForExactTokens));
    }

    #[test]
    fn test_filter_swap_exact_eth_for_tokens() {
        let calldata = hex_to_bytes("0x7ff36ab50000000000000000000000000000000000000000000000000000000000000001").unwrap();
        let dex_method = filter_transaction(&calldata);
        assert_eq!(dex_method, Some(DexMethodId::SwapExactEthForTokens));
    }

    #[test]
    fn test_filter_swap_exact_tokens_for_eth() {
        let calldata = hex_to_bytes("0x18cbafe50000000000000000000000000000000000000000000000000000000000000001").unwrap();
        let dex_method = filter_transaction(&calldata);
        assert_eq!(dex_method, Some(DexMethodId::SwapExactTokensForEth));
    }

    #[test]
    fn test_filter_add_liquidity() {
        let calldata = hex_to_bytes("0xe8e337000000000000000000000000001234567890abcdef1234567890abcdef12345678").unwrap();
        let dex_method = filter_transaction(&calldata);
        assert_eq!(dex_method, Some(DexMethodId::AddLiquidity));
    }

    #[test]
    fn test_filter_erc20_transfer_not_dex() {
        // ERC20 transfer(address,uint256) - should NOT match
        let calldata = hex_to_bytes("0xa9059cbb000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266").unwrap();
        let dex_method = filter_transaction(&calldata);
        assert_eq!(dex_method, None);
    }

    #[test]
    fn test_filter_erc20_approve_not_dex() {
        // ERC20 approve(address,uint256) - should NOT match
        let calldata = hex_to_bytes("0x095ea7b3000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266").unwrap();
        let dex_method = filter_transaction(&calldata);
        assert_eq!(dex_method, None);
    }
}
