#!/bin/bash
# Send mock DEX swap transactions to Anvil for testing
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/../fixtures"

# Configuration
ANVIL_IPC_PATH="${ANVIL_IPC_PATH:-/tmp/anvil.ipc}"
RPC_URL="ipc://$ANVIL_IPC_PATH"

# Anvil default accounts (first account is the sender)
SENDER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
SENDER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# Mock token addresses (we'll deploy simple contracts or use pre-seeded addresses)
WETH_ADDRESS="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
USDC_ADDRESS="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
DAI_ADDRESS="0x6B175474E89094C44Da98b954EesEcdB1A8fFe1f5Bca"

# Uniswap V3 SwapRouter02 address (mainnet)
UNISWAP_V3_ROUTER="0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
# Uniswap V2 Router address (mainnet)
UNISWAP_V2_ROUTER="0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_tx() { echo -e "${BLUE}[TX]${NC} $1"; }

# Check dependencies
check_dependencies() {
    if ! command -v cast &> /dev/null; then
        log_error "cast not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        log_error "jq not found. Install: apt install jq"
        exit 1
    fi
}

# Check IPC socket
check_anvil() {
    if [ ! -S "$ANVIL_IPC_PATH" ]; then
        log_error "Anvil IPC socket not found at: $ANVIL_IPC_PATH"
        log_info "Start the test stack first: ./scripts/test-infra/start-test-stack.sh"
        exit 1
    fi
}

# Send a raw transaction with custom calldata
send_raw_tx() {
    local to="$1"
    local calldata="$2"
    local value="${3:-0}"
    local description="$4"

    log_tx "Sending: $description"
    log_info "  To: $to"
    log_info "  Value: $value wei"

    local tx_hash
    tx_hash=$(cast send \
        --rpc-url "$RPC_URL" \
        --private-key "$SENDER_PRIVATE_KEY" \
        "$to" \
        "$calldata" \
        --value "$value" \
        2>&1 | grep "transactionHash" | awk '{print $2}' || true)

    if [ -z "$tx_hash" ]; then
        # Try alternative parsing
        tx_hash=$(cast send \
            --rpc-url "$RPC_URL" \
            --private-key "$SENDER_PRIVATE_KEY" \
            "$to" \
            "$calldata" \
            --value "$value" \
            --json 2>/dev/null | jq -r '.transactionHash' || echo "")
    fi

    if [ -n "$tx_hash" ] && [ "$tx_hash" != "null" ]; then
        log_info "  TX Hash: $tx_hash"
        echo "$tx_hash"
    else
        log_warn "  Transaction sent but couldn't parse hash"
        echo ""
    fi
}

# Uniswap V3: exactInputSingle
send_v3_exact_input_single() {
    log_info "=== Uniswap V3: exactInputSingle ==="

    # Function selector: exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
    # selector: 0x04e45aaf
    local selector="0x04e45aaf"

    # Params struct (simplified - would need proper encoding for real use)
    # tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96
    local calldata="${selector}000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000"

    send_raw_tx "$UNISWAP_V3_ROUTER" "$calldata" "0" "V3 exactInputSingle (1 ETH -> USDC)"
}

# Uniswap V3: exactOutputSingle
send_v3_exact_output_single() {
    log_info "=== Uniswap V3: exactOutputSingle ==="

    # Function selector: exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))
    # selector: 0x5023b4df
    local selector="0x5023b4df"

    local calldata="${selector}000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266000000000000000000000000000000000000000000000000000000003b9aca000000000000000000000000000000000000000000000000001bc16d674ec800000000000000000000000000000000000000000000000000000000000000000000"

    send_raw_tx "$UNISWAP_V3_ROUTER" "$calldata" "0" "V3 exactOutputSingle (? ETH -> 1000 USDC)"
}

# Uniswap V3: multicall
send_v3_multicall() {
    log_info "=== Uniswap V3: multicall ==="

    # Function selector: multicall(uint256,bytes[])
    # selector: 0x5ae401dc
    local selector="0x5ae401dc"

    # Simplified multicall with deadline and empty calls array
    local deadline=$(( $(date +%s) + 3600 ))
    local calldata="${selector}$(printf '%064x' $deadline)0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004deadbeef00000000000000000000000000000000000000000000000000000000"

    send_raw_tx "$UNISWAP_V3_ROUTER" "$calldata" "0" "V3 multicall (batched)"
}

# Uniswap V2: swapExactTokensForTokens
send_v2_swap_exact_tokens() {
    log_info "=== Uniswap V2: swapExactTokensForTokens ==="

    # Function selector: swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
    # selector: 0x38ed1739
    local selector="0x38ed1739"

    local deadline=$(( $(date +%s) + 3600 ))
    local calldata="${selector}0000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266$(printf '%064x' $deadline)0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"

    send_raw_tx "$UNISWAP_V2_ROUTER" "$calldata" "0" "V2 swapExactTokensForTokens (1 WETH -> USDC)"
}

# Uniswap V2: swapTokensForExactTokens
send_v2_swap_tokens_for_exact() {
    log_info "=== Uniswap V2: swapTokensForExactTokens ==="

    # Function selector: swapTokensForExactTokens(uint256,uint256,address[],address,uint256)
    # selector: 0x8803dbee
    local selector="0x8803dbee"

    local deadline=$(( $(date +%s) + 3600 ))
    local calldata="${selector}000000000000000000000000000000000000000000000000000000003b9aca000000000000000000000000000000000000000000000000001bc16d674ec8000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266$(printf '%064x' $deadline)0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"

    send_raw_tx "$UNISWAP_V2_ROUTER" "$calldata" "0" "V2 swapTokensForExactTokens (? WETH -> 1000 USDC)"
}

# Uniswap V2: swapExactETHForTokens
send_v2_swap_exact_eth() {
    log_info "=== Uniswap V2: swapExactETHForTokens ==="

    # Function selector: swapExactETHForTokens(uint256,address[],address,uint256)
    # selector: 0x7ff36ab5
    local selector="0x7ff36ab5"

    local deadline=$(( $(date +%s) + 3600 ))
    local calldata="${selector}0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000008000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266$(printf '%064x' $deadline)0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"

    # Send 1 ETH worth
    send_raw_tx "$UNISWAP_V2_ROUTER" "$calldata" "1000000000000000000" "V2 swapExactETHForTokens (1 ETH -> USDC)"
}

# Uniswap V2: swapTokensForExactETH
send_v2_swap_tokens_for_exact_eth() {
    log_info "=== Uniswap V2: swapTokensForExactETH ==="

    # Function selector: swapTokensForExactETH(uint256,uint256,address[],address,uint256)
    # selector: 0x4a25d94a
    local selector="0x4a25d94a"

    local deadline=$(( $(date +%s) + 3600 ))
    local calldata="${selector}0000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000001bc16d674ec8000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266$(printf '%064x' $deadline)0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

    send_raw_tx "$UNISWAP_V2_ROUTER" "$calldata" "0" "V2 swapTokensForExactETH (? USDC -> 1 ETH)"
}

# Send all mock transactions
send_all() {
    log_info "Sending all mock swap transactions..."
    echo ""

    echo "──────────────────────────────────────────"
    echo "  UNISWAP V3 TRANSACTIONS"
    echo "──────────────────────────────────────────"
    send_v3_exact_input_single
    echo ""
    send_v3_exact_output_single
    echo ""
    send_v3_multicall
    echo ""

    echo "──────────────────────────────────────────"
    echo "  UNISWAP V2 TRANSACTIONS"
    echo "──────────────────────────────────────────"
    send_v2_swap_exact_tokens
    echo ""
    send_v2_swap_tokens_for_exact
    echo ""
    send_v2_swap_exact_eth
    echo ""
    send_v2_swap_tokens_for_exact_eth
    echo ""
}

# Print usage
print_usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  all                     Send all mock swap transactions"
    echo "  v3-exact-input          Send V3 exactInputSingle"
    echo "  v3-exact-output         Send V3 exactOutputSingle"
    echo "  v3-multicall            Send V3 multicall"
    echo "  v2-exact-tokens         Send V2 swapExactTokensForTokens"
    echo "  v2-tokens-for-exact     Send V2 swapTokensForExactTokens"
    echo "  v2-exact-eth            Send V2 swapExactETHForTokens"
    echo "  v2-tokens-for-eth       Send V2 swapTokensForExactETH"
    echo ""
    echo "If no command is specified, 'all' is used by default."
}

main() {
    check_dependencies
    check_anvil

    local command="${1:-all}"

    case "$command" in
        all)
            send_all
            ;;
        v3-exact-input)
            send_v3_exact_input_single
            ;;
        v3-exact-output)
            send_v3_exact_output_single
            ;;
        v3-multicall)
            send_v3_multicall
            ;;
        v2-exact-tokens)
            send_v2_swap_exact_tokens
            ;;
        v2-tokens-for-exact)
            send_v2_swap_tokens_for_exact
            ;;
        v2-exact-eth)
            send_v2_swap_exact_eth
            ;;
        v2-tokens-for-eth)
            send_v2_swap_tokens_for_exact_eth
            ;;
        -h|--help|help)
            print_usage
            ;;
        *)
            log_error "Unknown command: $command"
            print_usage
            exit 1
            ;;
    esac
}

main "$@"
