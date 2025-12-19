#!/bin/bash
# Stop test infrastructure stack and cleanup
set -e

# Configuration
ANVIL_IPC_PATH="${ANVIL_IPC_PATH:-/tmp/anvil.ipc}"
ANVIL_PID_FILE="/tmp/anvil.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Stop Anvil
stop_anvil() {
    if [ -f "$ANVIL_PID_FILE" ]; then
        local pid=$(cat "$ANVIL_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log_info "Stopping Anvil (PID: $pid)..."
            kill "$pid"
            sleep 0.5

            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                log_warn "Anvil didn't stop gracefully, force killing..."
                kill -9 "$pid" 2>/dev/null || true
            fi

            log_info "Anvil stopped"
        else
            log_warn "Anvil process not found (PID: $pid)"
        fi
        rm -f "$ANVIL_PID_FILE"
    else
        # Try to find any anvil process
        local anvil_pid=$(pgrep -x anvil 2>/dev/null || true)
        if [ -n "$anvil_pid" ]; then
            log_info "Found Anvil process (PID: $anvil_pid), stopping..."
            kill "$anvil_pid" 2>/dev/null || true
            sleep 0.5
            kill -9 "$anvil_pid" 2>/dev/null || true
            log_info "Anvil stopped"
        else
            log_info "No Anvil process running"
        fi
    fi
}

# Cleanup IPC socket
cleanup_ipc() {
    if [ -S "$ANVIL_IPC_PATH" ]; then
        log_info "Removing IPC socket: $ANVIL_IPC_PATH"
        rm -f "$ANVIL_IPC_PATH"
    fi
}

# Cleanup log files
cleanup_logs() {
    if [ -f "/tmp/anvil.log" ]; then
        log_info "Removing Anvil log file"
        rm -f "/tmp/anvil.log"
    fi
}

main() {
    log_info "Stopping test infrastructure stack..."
    stop_anvil
    cleanup_ipc
    cleanup_logs
    log_info "Test stack stopped and cleaned up"
}

main "$@"
