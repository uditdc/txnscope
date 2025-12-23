//! DEX Method Filtering
//!
//! Filters transactions based on method IDs to identify DEX-related operations.
//! Targets Uniswap V2/V3 style routers.

use std::collections::HashMap;
use std::sync::LazyLock;

/// The 6 DEX method IDs we're interested in filtering
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DexMethodId {
    /// addLiquidityETH - 0xf305d719
    AddLiquidityEth,
    /// addLiquidity - 0xe8e33700
    AddLiquidity,
    /// swapExactETHForTokens - 0x7ff36ab5
    SwapExactEthForTokens,
    /// swapExactTokensForTokens - 0x38ed1739
    SwapExactTokensForTokens,
    /// swapTokensForExactTokens - 0x8803dbee
    SwapTokensForExactTokens,
    /// swapExactTokensForETH - 0x18cbafe5
    SwapExactTokensForEth,
}

impl DexMethodId {
    /// Returns the 4-byte method selector
    pub fn selector(&self) -> [u8; 4] {
        match self {
            DexMethodId::AddLiquidityEth => [0xf3, 0x05, 0xd7, 0x19],
            DexMethodId::AddLiquidity => [0xe8, 0xe3, 0x37, 0x00],
            DexMethodId::SwapExactEthForTokens => [0x7f, 0xf3, 0x6a, 0xb5],
            DexMethodId::SwapExactTokensForTokens => [0x38, 0xed, 0x17, 0x39],
            DexMethodId::SwapTokensForExactTokens => [0x88, 0x03, 0xdb, 0xee],
            DexMethodId::SwapExactTokensForEth => [0x18, 0xcb, 0xaf, 0xe5],
        }
    }

    /// Returns the human-readable method name
    pub fn name(&self) -> &'static str {
        match self {
            DexMethodId::AddLiquidityEth => "addLiquidityETH",
            DexMethodId::AddLiquidity => "addLiquidity",
            DexMethodId::SwapExactEthForTokens => "swapExactETHForTokens",
            DexMethodId::SwapExactTokensForTokens => "swapExactTokensForTokens",
            DexMethodId::SwapTokensForExactTokens => "swapTokensForExactTokens",
            DexMethodId::SwapExactTokensForEth => "swapExactTokensForETH",
        }
    }

    /// Returns the hex-encoded method ID with 0x prefix
    pub fn hex(&self) -> &'static str {
        match self {
            DexMethodId::AddLiquidityEth => "0xf305d719",
            DexMethodId::AddLiquidity => "0xe8e33700",
            DexMethodId::SwapExactEthForTokens => "0x7ff36ab5",
            DexMethodId::SwapExactTokensForTokens => "0x38ed1739",
            DexMethodId::SwapTokensForExactTokens => "0x8803dbee",
            DexMethodId::SwapExactTokensForEth => "0x18cbafe5",
        }
    }
}

/// Static lookup table for method IDs
static DEX_METHODS: LazyLock<HashMap<[u8; 4], DexMethodId>> = LazyLock::new(|| {
    let mut map = HashMap::new();
    map.insert([0xf3, 0x05, 0xd7, 0x19], DexMethodId::AddLiquidityEth);
    map.insert([0xe8, 0xe3, 0x37, 0x00], DexMethodId::AddLiquidity);
    map.insert([0x7f, 0xf3, 0x6a, 0xb5], DexMethodId::SwapExactEthForTokens);
    map.insert([0x38, 0xed, 0x17, 0x39], DexMethodId::SwapExactTokensForTokens);
    map.insert([0x88, 0x03, 0xdb, 0xee], DexMethodId::SwapTokensForExactTokens);
    map.insert([0x18, 0xcb, 0xaf, 0xe5], DexMethodId::SwapExactTokensForEth);
    map
});

/// Check if a 4-byte method ID is a DEX method we're interested in
///
/// # Arguments
/// * `method_id` - The first 4 bytes of the transaction input data
///
/// # Returns
/// `true` if this is a DEX method we should forward, `false` otherwise
pub fn is_dex_method(method_id: &[u8; 4]) -> bool {
    DEX_METHODS.contains_key(method_id)
}

/// Get the DEX method enum for a given selector, if it matches
///
/// # Arguments
/// * `method_id` - The first 4 bytes of the transaction input data
///
/// # Returns
/// `Some(DexMethodId)` if this is a known DEX method, `None` otherwise
pub fn get_dex_method(method_id: &[u8; 4]) -> Option<DexMethodId> {
    DEX_METHODS.get(method_id).copied()
}

/// Get the human-readable method name for a given selector
///
/// # Arguments
/// * `method_id` - The first 4 bytes of the transaction input data
///
/// # Returns
/// `Some(&str)` with the method name if known, `None` otherwise
pub fn get_method_name(method_id: &[u8; 4]) -> Option<&'static str> {
    get_dex_method(method_id).map(|m| m.name())
}

/// Extract method ID from transaction input data
///
/// # Arguments
/// * `input` - The full transaction input/calldata
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

/// Filter transaction input - returns the DexMethodId if this is a DEX transaction
///
/// # Arguments
/// * `input` - The full transaction input/calldata
///
/// # Returns
/// `Some(DexMethodId)` if this is a DEX transaction, `None` otherwise
pub fn filter_transaction(input: &[u8]) -> Option<DexMethodId> {
    extract_method_id(input).and_then(|id| get_dex_method(&id))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== is_dex_method tests ====================

    #[test]
    fn test_filter_add_liquidity_eth() {
        // 0xf305d719 - addLiquidityETH
        let method_id: [u8; 4] = [0xf3, 0x05, 0xd7, 0x19];
        assert!(is_dex_method(&method_id));
    }

    #[test]
    fn test_filter_add_liquidity() {
        // 0xe8e33700 - addLiquidity
        let method_id: [u8; 4] = [0xe8, 0xe3, 0x37, 0x00];
        assert!(is_dex_method(&method_id));
    }

    #[test]
    fn test_filter_swap_exact_eth_for_tokens() {
        // 0x7ff36ab5 - swapExactETHForTokens
        let method_id: [u8; 4] = [0x7f, 0xf3, 0x6a, 0xb5];
        assert!(is_dex_method(&method_id));
    }

    #[test]
    fn test_filter_swap_exact_tokens_for_tokens() {
        // 0x38ed1739 - swapExactTokensForTokens
        let method_id: [u8; 4] = [0x38, 0xed, 0x17, 0x39];
        assert!(is_dex_method(&method_id));
    }

    #[test]
    fn test_filter_swap_tokens_for_exact_tokens() {
        // 0x8803dbee - swapTokensForExactTokens
        let method_id: [u8; 4] = [0x88, 0x03, 0xdb, 0xee];
        assert!(is_dex_method(&method_id));
    }

    #[test]
    fn test_filter_swap_exact_tokens_for_eth() {
        // 0x18cbafe5 - swapExactTokensForETH
        let method_id: [u8; 4] = [0x18, 0xcb, 0xaf, 0xe5];
        assert!(is_dex_method(&method_id));
    }

    #[test]
    fn test_filter_unknown_method_returns_false() {
        // Random method ID
        let method_id: [u8; 4] = [0x12, 0x34, 0x56, 0x78];
        assert!(!is_dex_method(&method_id));
    }

    #[test]
    fn test_filter_erc20_transfer_returns_false() {
        // 0xa9059cbb - ERC20 transfer(address,uint256)
        let method_id: [u8; 4] = [0xa9, 0x05, 0x9c, 0xbb];
        assert!(!is_dex_method(&method_id));
    }

    #[test]
    fn test_filter_erc20_approve_returns_false() {
        // 0x095ea7b3 - ERC20 approve(address,uint256)
        let method_id: [u8; 4] = [0x09, 0x5e, 0xa7, 0xb3];
        assert!(!is_dex_method(&method_id));
    }

    #[test]
    fn test_filter_zero_method_returns_false() {
        let method_id: [u8; 4] = [0x00, 0x00, 0x00, 0x00];
        assert!(!is_dex_method(&method_id));
    }

    // ==================== get_method_name tests ====================

    #[test]
    fn test_get_method_name_add_liquidity_eth() {
        let method_id: [u8; 4] = [0xf3, 0x05, 0xd7, 0x19];
        assert_eq!(get_method_name(&method_id), Some("addLiquidityETH"));
    }

    #[test]
    fn test_get_method_name_add_liquidity() {
        let method_id: [u8; 4] = [0xe8, 0xe3, 0x37, 0x00];
        assert_eq!(get_method_name(&method_id), Some("addLiquidity"));
    }

    #[test]
    fn test_get_method_name_swap_exact_eth_for_tokens() {
        let method_id: [u8; 4] = [0x7f, 0xf3, 0x6a, 0xb5];
        assert_eq!(get_method_name(&method_id), Some("swapExactETHForTokens"));
    }

    #[test]
    fn test_get_method_name_swap_exact_tokens_for_tokens() {
        let method_id: [u8; 4] = [0x38, 0xed, 0x17, 0x39];
        assert_eq!(get_method_name(&method_id), Some("swapExactTokensForTokens"));
    }

    #[test]
    fn test_get_method_name_swap_tokens_for_exact_tokens() {
        let method_id: [u8; 4] = [0x88, 0x03, 0xdb, 0xee];
        assert_eq!(get_method_name(&method_id), Some("swapTokensForExactTokens"));
    }

    #[test]
    fn test_get_method_name_swap_exact_tokens_for_eth() {
        let method_id: [u8; 4] = [0x18, 0xcb, 0xaf, 0xe5];
        assert_eq!(get_method_name(&method_id), Some("swapExactTokensForETH"));
    }

    #[test]
    fn test_get_method_name_unknown_returns_none() {
        let method_id: [u8; 4] = [0x12, 0x34, 0x56, 0x78];
        assert_eq!(get_method_name(&method_id), None);
    }

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

    // ==================== filter_transaction tests ====================

    #[test]
    fn test_filter_transaction_dex_method() {
        // swapExactTokensForTokens with some calldata
        let input = vec![
            0x38, 0xed, 0x17, 0x39, // method ID
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // some params
        ];
        assert_eq!(filter_transaction(&input), Some(DexMethodId::SwapExactTokensForTokens));
    }

    #[test]
    fn test_filter_transaction_non_dex_method() {
        // ERC20 transfer
        let input = vec![
            0xa9, 0x05, 0x9c, 0xbb, // transfer method ID
            0x00, 0x00, 0x00, 0x00,
        ];
        assert_eq!(filter_transaction(&input), None);
    }

    #[test]
    fn test_filter_transaction_empty_input() {
        let input: Vec<u8> = vec![];
        assert_eq!(filter_transaction(&input), None);
    }

    #[test]
    fn test_filter_transaction_short_input() {
        let input = vec![0x38, 0xed];
        assert_eq!(filter_transaction(&input), None);
    }

    // ==================== DexMethodId enum tests ====================

    #[test]
    fn test_dex_method_id_selector() {
        assert_eq!(DexMethodId::AddLiquidityEth.selector(), [0xf3, 0x05, 0xd7, 0x19]);
        assert_eq!(DexMethodId::AddLiquidity.selector(), [0xe8, 0xe3, 0x37, 0x00]);
        assert_eq!(DexMethodId::SwapExactEthForTokens.selector(), [0x7f, 0xf3, 0x6a, 0xb5]);
        assert_eq!(DexMethodId::SwapExactTokensForTokens.selector(), [0x38, 0xed, 0x17, 0x39]);
        assert_eq!(DexMethodId::SwapTokensForExactTokens.selector(), [0x88, 0x03, 0xdb, 0xee]);
        assert_eq!(DexMethodId::SwapExactTokensForEth.selector(), [0x18, 0xcb, 0xaf, 0xe5]);
    }

    #[test]
    fn test_dex_method_id_name() {
        assert_eq!(DexMethodId::AddLiquidityEth.name(), "addLiquidityETH");
        assert_eq!(DexMethodId::AddLiquidity.name(), "addLiquidity");
        assert_eq!(DexMethodId::SwapExactEthForTokens.name(), "swapExactETHForTokens");
        assert_eq!(DexMethodId::SwapExactTokensForTokens.name(), "swapExactTokensForTokens");
        assert_eq!(DexMethodId::SwapTokensForExactTokens.name(), "swapTokensForExactTokens");
        assert_eq!(DexMethodId::SwapExactTokensForEth.name(), "swapExactTokensForETH");
    }

    #[test]
    fn test_dex_method_id_hex() {
        assert_eq!(DexMethodId::AddLiquidityEth.hex(), "0xf305d719");
        assert_eq!(DexMethodId::AddLiquidity.hex(), "0xe8e33700");
        assert_eq!(DexMethodId::SwapExactEthForTokens.hex(), "0x7ff36ab5");
        assert_eq!(DexMethodId::SwapExactTokensForTokens.hex(), "0x38ed1739");
        assert_eq!(DexMethodId::SwapTokensForExactTokens.hex(), "0x8803dbee");
        assert_eq!(DexMethodId::SwapExactTokensForEth.hex(), "0x18cbafe5");
    }

    // ==================== All 6 methods comprehensive test ====================

    #[test]
    fn test_all_six_dex_methods_are_recognized() {
        let methods = [
            ([0xf3, 0x05, 0xd7, 0x19], DexMethodId::AddLiquidityEth),
            ([0xe8, 0xe3, 0x37, 0x00], DexMethodId::AddLiquidity),
            ([0x7f, 0xf3, 0x6a, 0xb5], DexMethodId::SwapExactEthForTokens),
            ([0x38, 0xed, 0x17, 0x39], DexMethodId::SwapExactTokensForTokens),
            ([0x88, 0x03, 0xdb, 0xee], DexMethodId::SwapTokensForExactTokens),
            ([0x18, 0xcb, 0xaf, 0xe5], DexMethodId::SwapExactTokensForEth),
        ];

        for (selector, expected_method) in methods {
            assert!(is_dex_method(&selector), "Method {:?} should be recognized", expected_method);
            assert_eq!(get_dex_method(&selector), Some(expected_method));
            assert!(get_method_name(&selector).is_some());
        }
    }

    #[test]
    fn test_exactly_six_methods_in_lookup() {
        // Verify we have exactly 6 methods
        assert_eq!(DEX_METHODS.len(), 6);
    }
}
