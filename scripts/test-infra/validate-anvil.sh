#!/bin/bash
# Validate Anvil IPC socket connectivity and measure latency
set -e

# Configuration
ANVIL_IPC_PATH="${ANVIL_IPC_PATH:-/tmp/anvil.ipc}"
LATENCY_TARGET_MS=1  # Target latency for IPC calls in milliseconds
NUM_SAMPLES=10       # Number of samples for latency measurement

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_test() { echo -e "${BLUE}[TEST]${NC} $1"; }

# Check if cast is available
check_cast() {
    if ! command -v cast &> /dev/null; then
        log_error "cast not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
        exit 1
    fi
}

# Check IPC socket exists
check_ipc_socket() {
    log_test "Checking IPC socket exists at: $ANVIL_IPC_PATH"

    if [ ! -S "$ANVIL_IPC_PATH" ]; then
        log_error "IPC socket not found at: $ANVIL_IPC_PATH"
        log_info "Start the test stack first: ./scripts/test-infra/start-test-stack.sh"
        exit 1
    fi

    log_info "IPC socket exists"
}

# Test basic RPC call via IPC
test_rpc_call() {
    log_test "Testing RPC call via IPC (eth_chainId)..."

    local chain_id
    chain_id=$(cast chain-id --rpc-url "ipc://$ANVIL_IPC_PATH" 2>/dev/null)

    if [ -z "$chain_id" ]; then
        log_error "Failed to get chain ID via IPC"
        exit 1
    fi

    log_info "Chain ID: $chain_id (expected: 31337 for Anvil)"

    if [ "$chain_id" != "31337" ]; then
        log_warn "Unexpected chain ID. Expected 31337 (Anvil), got $chain_id"
    fi
}

# Test block number retrieval
test_block_number() {
    log_test "Testing block number retrieval..."

    local block_num
    block_num=$(cast block-number --rpc-url "ipc://$ANVIL_IPC_PATH" 2>/dev/null)

    if [ -z "$block_num" ]; then
        log_error "Failed to get block number via IPC"
        exit 1
    fi

    log_info "Current block number: $block_num"
}

# Test getting account balance
test_account_balance() {
    log_test "Testing account balance retrieval..."

    # First test account from Anvil
    local test_account="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

    local balance
    balance=$(cast balance "$test_account" --rpc-url "ipc://$ANVIL_IPC_PATH" 2>/dev/null)

    if [ -z "$balance" ]; then
        log_error "Failed to get balance via IPC"
        exit 1
    fi

    local balance_eth
    balance_eth=$(cast from-wei "$balance" 2>/dev/null || echo "$balance")

    log_info "Test account balance: $balance_eth ETH"
}

# Measure IPC latency
measure_latency() {
    log_test "Measuring IPC latency ($NUM_SAMPLES samples)..."

    local total_ms=0
    local min_ms=999999
    local max_ms=0

    for i in $(seq 1 $NUM_SAMPLES); do
        # Measure time for a simple RPC call (eth_blockNumber)
        local start_ns=$(date +%s%N)
        cast block-number --rpc-url "ipc://$ANVIL_IPC_PATH" > /dev/null 2>&1
        local end_ns=$(date +%s%N)

        local duration_ns=$((end_ns - start_ns))
        local duration_ms=$((duration_ns / 1000000))

        total_ms=$((total_ms + duration_ms))

        if [ $duration_ms -lt $min_ms ]; then
            min_ms=$duration_ms
        fi
        if [ $duration_ms -gt $max_ms ]; then
            max_ms=$duration_ms
        fi
    done

    local avg_ms=$((total_ms / NUM_SAMPLES))

    echo ""
    echo "  Latency Results (IPC Socket):"
    echo "  ─────────────────────────────"
    echo "    Samples:  $NUM_SAMPLES"
    echo "    Min:      ${min_ms}ms"
    echo "    Max:      ${max_ms}ms"
    echo "    Average:  ${avg_ms}ms"
    echo "    Target:   <${LATENCY_TARGET_MS}ms"
    echo ""

    if [ $avg_ms -le $LATENCY_TARGET_MS ]; then
        log_info "Latency is within target (<${LATENCY_TARGET_MS}ms)"
    else
        log_warn "Latency exceeds target. Average: ${avg_ms}ms, Target: <${LATENCY_TARGET_MS}ms"
        log_info "IPC is still faster than HTTP. For production, ensure node runs locally."
    fi
}

# Print summary
print_summary() {
    echo ""
    echo "============================================"
    echo "  Anvil IPC Validation Complete"
    echo "============================================"
    echo ""
    echo "  Status: ${GREEN}PASS${NC}"
    echo "  IPC Socket: $ANVIL_IPC_PATH"
    echo ""
    echo "============================================"
}

main() {
    log_info "Validating Anvil IPC connectivity..."
    echo ""

    check_cast
    check_ipc_socket
    test_rpc_call
    test_block_number
    test_account_balance
    measure_latency
    print_summary
}

main "$@"
