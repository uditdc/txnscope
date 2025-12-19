#!/bin/bash
# Validate Redis connectivity and measure pub/sub latency
set -e

# Configuration
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
REDIS_CHANNEL="${REDIS_CHANNEL:-mempool_alpha}"
LATENCY_TARGET_MS=2  # Target latency for pub/sub in milliseconds
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

# Parse Redis URL
parse_redis_url() {
    REDIS_HOST=$(echo "$REDIS_URL" | sed -E 's|redis://([^:]+):([0-9]+).*|\1|')
    REDIS_PORT=$(echo "$REDIS_URL" | sed -E 's|redis://([^:]+):([0-9]+).*|\2|')
}

# Check if redis-cli is available
check_redis_cli() {
    if ! command -v redis-cli &> /dev/null; then
        log_error "redis-cli not found. Install: apt install redis-tools"
        exit 1
    fi
}

# Test basic connectivity (PING)
test_ping() {
    log_test "Testing Redis PING..."

    local response
    response=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" PING 2>/dev/null)

    if [ "$response" != "PONG" ]; then
        log_error "Redis PING failed. Response: $response"
        log_info "Ensure Redis is running. Start via: cd .devcontainer && docker-compose up -d redis"
        exit 1
    fi

    log_info "Redis PING: PONG"
}

# Test SET/GET operations
test_set_get() {
    log_test "Testing SET/GET operations..."

    local test_key="txnscope:test:$(date +%s)"
    local test_value="test_value_$(date +%s%N)"

    # SET
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" SET "$test_key" "$test_value" EX 10 > /dev/null 2>&1

    # GET
    local retrieved
    retrieved=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" GET "$test_key" 2>/dev/null)

    if [ "$retrieved" != "$test_value" ]; then
        log_error "SET/GET mismatch. Expected: $test_value, Got: $retrieved"
        exit 1
    fi

    # Cleanup
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" DEL "$test_key" > /dev/null 2>&1

    log_info "SET/GET operations working correctly"
}

# Test PUBLISH (without subscriber)
test_publish() {
    log_test "Testing PUBLISH to channel: $REDIS_CHANNEL..."

    local test_message='{"type":"test","timestamp":'$(date +%s)'}'

    local subscribers
    subscribers=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" PUBLISH "$REDIS_CHANNEL" "$test_message" 2>/dev/null)

    log_info "PUBLISH successful (delivered to $subscribers subscribers)"
}

# Measure SET/GET latency
measure_set_get_latency() {
    log_test "Measuring SET/GET latency ($NUM_SAMPLES samples)..."

    local total_ms=0
    local min_ms=999999
    local max_ms=0

    for i in $(seq 1 $NUM_SAMPLES); do
        local test_key="txnscope:latency:$i"
        local test_value="value_$i"

        # Measure SET + GET round trip
        local start_ns=$(date +%s%N)
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" SET "$test_key" "$test_value" EX 5 > /dev/null 2>&1
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" GET "$test_key" > /dev/null 2>&1
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

        # Cleanup
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" DEL "$test_key" > /dev/null 2>&1
    done

    local avg_ms=$((total_ms / NUM_SAMPLES))

    echo ""
    echo "  SET/GET Latency Results:"
    echo "  ────────────────────────"
    echo "    Samples:  $NUM_SAMPLES"
    echo "    Min:      ${min_ms}ms"
    echo "    Max:      ${max_ms}ms"
    echo "    Average:  ${avg_ms}ms"
    echo "    Target:   <${LATENCY_TARGET_MS}ms"
    echo ""

    if [ $avg_ms -le $LATENCY_TARGET_MS ]; then
        log_info "SET/GET latency is within target (<${LATENCY_TARGET_MS}ms)"
    else
        log_warn "SET/GET latency exceeds target. Average: ${avg_ms}ms, Target: <${LATENCY_TARGET_MS}ms"
    fi
}

# Measure PUBLISH latency (time to publish, not round-trip)
measure_publish_latency() {
    log_test "Measuring PUBLISH latency ($NUM_SAMPLES samples)..."

    local total_ms=0
    local min_ms=999999
    local max_ms=0

    for i in $(seq 1 $NUM_SAMPLES); do
        local test_message='{"seq":'$i',"ts":'$(date +%s%N)'}'

        local start_ns=$(date +%s%N)
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" PUBLISH "$REDIS_CHANNEL" "$test_message" > /dev/null 2>&1
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
    echo "  PUBLISH Latency Results:"
    echo "  ─────────────────────────"
    echo "    Samples:  $NUM_SAMPLES"
    echo "    Min:      ${min_ms}ms"
    echo "    Max:      ${max_ms}ms"
    echo "    Average:  ${avg_ms}ms"
    echo "    Target:   <${LATENCY_TARGET_MS}ms"
    echo ""

    if [ $avg_ms -le $LATENCY_TARGET_MS ]; then
        log_info "PUBLISH latency is within target (<${LATENCY_TARGET_MS}ms)"
    else
        log_warn "PUBLISH latency exceeds target. Average: ${avg_ms}ms, Target: <${LATENCY_TARGET_MS}ms"
    fi
}

# Get Redis info
print_redis_info() {
    log_test "Getting Redis server info..."

    local version
    version=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" INFO server 2>/dev/null | grep redis_version | cut -d: -f2 | tr -d '\r')

    local connected_clients
    connected_clients=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" INFO clients 2>/dev/null | grep connected_clients | cut -d: -f2 | tr -d '\r')

    local used_memory
    used_memory=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" INFO memory 2>/dev/null | grep used_memory_human | cut -d: -f2 | tr -d '\r')

    echo ""
    echo "  Redis Server Info:"
    echo "  ───────────────────"
    echo "    Version:           $version"
    echo "    Connected Clients: $connected_clients"
    echo "    Memory Used:       $used_memory"
    echo ""
}

# Print summary
print_summary() {
    echo ""
    echo "============================================"
    echo "  Redis Validation Complete"
    echo "============================================"
    echo ""
    echo "  Status: ${GREEN}PASS${NC}"
    echo "  Redis URL: $REDIS_URL"
    echo "  Pub/Sub Channel: $REDIS_CHANNEL"
    echo ""
    echo "============================================"
}

main() {
    log_info "Validating Redis connectivity..."
    echo ""

    parse_redis_url
    check_redis_cli
    test_ping
    test_set_get
    test_publish
    print_redis_info
    measure_set_get_latency
    measure_publish_latency
    print_summary
}

main "$@"
