#!/bin/bash
# Start test infrastructure stack: Anvil (blockchain) + Redis
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Configuration
ANVIL_IPC_PATH="${ANVIL_IPC_PATH:-/tmp/anvil.ipc}"
ANVIL_PID_FILE="/tmp/anvil.pid"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check for required tools
check_dependencies() {
    local missing=()

    if ! command -v anvil &> /dev/null; then
        missing+=("anvil (install via: curl -L https://foundry.paradigm.xyz | bash && foundryup)")
    fi

    if ! command -v redis-cli &> /dev/null; then
        missing+=("redis-cli (install via: apt install redis-tools)")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing dependencies:"
        for dep in "${missing[@]}"; do
            echo "  - $dep"
        done
        exit 1
    fi
}

# Start Anvil with IPC socket
start_anvil() {
    # Check if Anvil is already running
    if [ -f "$ANVIL_PID_FILE" ] && kill -0 "$(cat "$ANVIL_PID_FILE")" 2>/dev/null; then
        log_warn "Anvil is already running (PID: $(cat "$ANVIL_PID_FILE"))"
        return 0
    fi

    # Clean up stale IPC socket
    if [ -S "$ANVIL_IPC_PATH" ]; then
        rm -f "$ANVIL_IPC_PATH"
    fi

    log_info "Starting Anvil with IPC socket at: $ANVIL_IPC_PATH"

    # Start Anvil in background with IPC enabled
    # - --ipc: Enable IPC socket
    # - --ipc-path: Path to IPC socket
    # - --block-time 1: Mine a block every second
    # - --accounts 10: Create 10 test accounts
    # - --balance 10000: Each account gets 10000 ETH
    anvil \
        --ipc \
        --ipc-path "$ANVIL_IPC_PATH" \
        --block-time 1 \
        --accounts 10 \
        --balance 10000 \
        > /tmp/anvil.log 2>&1 &

    echo $! > "$ANVIL_PID_FILE"
    log_info "Anvil started with PID: $(cat "$ANVIL_PID_FILE")"

    # Wait for IPC socket to be ready
    local retries=30
    while [ ! -S "$ANVIL_IPC_PATH" ] && [ $retries -gt 0 ]; do
        sleep 0.1
        retries=$((retries - 1))
    done

    if [ ! -S "$ANVIL_IPC_PATH" ]; then
        log_error "Anvil IPC socket not created after 3 seconds"
        cat /tmp/anvil.log
        exit 1
    fi

    log_info "Anvil IPC socket ready"
}

# Check Redis connectivity
check_redis() {
    log_info "Checking Redis connectivity at: $REDIS_URL"

    # Extract host and port from URL
    local redis_host=$(echo "$REDIS_URL" | sed -E 's|redis://([^:]+):([0-9]+).*|\1|')
    local redis_port=$(echo "$REDIS_URL" | sed -E 's|redis://([^:]+):([0-9]+).*|\2|')

    if redis-cli -h "$redis_host" -p "$redis_port" ping | grep -q "PONG"; then
        log_info "Redis is running and responding"
    else
        log_error "Redis is not responding. Make sure Redis is running."
        log_info "Start Redis via docker-compose: cd .devcontainer && docker-compose up -d redis"
        exit 1
    fi
}

# Print connection info
print_info() {
    echo ""
    echo "============================================"
    echo "  Test Stack Ready"
    echo "============================================"
    echo ""
    echo "  Anvil (Blockchain):"
    echo "    IPC Socket: $ANVIL_IPC_PATH"
    echo "    HTTP RPC:   http://localhost:8545"
    echo "    Chain ID:   31337"
    echo "    Logs:       /tmp/anvil.log"
    echo ""
    echo "  Redis:"
    echo "    URL: $REDIS_URL"
    echo ""
    echo "  Test Commands:"
    echo "    Validate Anvil:  ./scripts/test-infra/validate-anvil.sh"
    echo "    Validate Redis:  ./scripts/test-infra/validate-redis.sh"
    echo "    Send Mock Swap:  ./scripts/test-infra/send-mock-swap.sh"
    echo ""
    echo "  Stop Stack:"
    echo "    ./scripts/test-infra/stop-test-stack.sh"
    echo ""
    echo "============================================"
}

main() {
    log_info "Starting test infrastructure stack..."
    check_dependencies
    start_anvil
    check_redis
    print_info
}

main "$@"
