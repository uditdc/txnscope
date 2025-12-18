# Phase 2: Infrastructure Setup

**Status:** In Progress
**Sprint:** Sprint 1-2

---

## 2.1 Bare Metal Server

- [ ] Rent bare-metal server (Hetzner AX line / Latitude.sh)
- [ ] Minimum spec: 16-core AMD EPYC, 64GB RAM, NVMe SSD

---

## 2.2 Blockchain Node

- [ ] Install Monad node (monad-geth fork) or Berachain (polaris)
- [ ] Configure aggressive mempool retention (`txpool.globalslots`)
- [ ] Enable IPC socket (Unix Socket for 0.01ms latency)
- [ ] Start node sync (checkpoint sync for speed)

---

## 2.3 CPU Pinning Strategy

```
Cores 0-11:  Blockchain Node (syncing is heavy)
Core 12:     Rust Ingestor (single-thread performance)
Core 13:     Redis
Cores 14-15: API Gateway (WebSocket management)
```

---

## 2.4 Redis Setup

- [ ] Install Redis instance
- [ ] Configure for Pub/Sub workload
- [ ] Set up memory limits and eviction policy

---

## 2.5 Test-Driven Development Approach (Anvil-Based)

**Test First Philosophy:**
1. Write tests that define expected infrastructure behavior
2. Start Anvil + Redis locally
3. Run tests to verify connectivity and latency
4. Iterate until all tests pass

**Local Test Stack:**
- **Anvil:** Local blockchain node with IPC socket
- **Redis:** From dev container (docker-compose)
- **Test runner:** Bash scripts + cargo test + vitest

**Test Categories:**
- Infrastructure validation: Verify Anvil IPC and Redis are accessible
- Connectivity tests: Test IPC socket, Redis pub/sub
- Latency tests: Measure baseline latencies

**Testing Tools:**
- Foundry/Anvil for local blockchain
- Bash scripts for infrastructure validation
- `redis-cli` for Redis connectivity tests
- `cast` (Foundry) for sending test transactions

**Test File Structure:**
```
scripts/
├── test-infra/
│   ├── start-test-stack.sh      # Start Anvil + Redis
│   ├── stop-test-stack.sh       # Cleanup
│   ├── validate-anvil.sh        # Check IPC socket
│   ├── validate-redis.sh        # Check Redis latency
│   └── send-mock-swap.sh        # Send test DEX transaction
└── fixtures/
    └── sample-swap-tx.json      # Sample transaction data
```

---

## 2.6 Test Tasks

- [ ] Write script to start/stop Anvil with IPC socket
- [ ] Write script to validate Anvil IPC connectivity
- [ ] Write script to test Redis pub/sub latency (<2ms target)
- [ ] Write script to send mock DEX swap transaction via `cast`
- [ ] Create fixtures for sample DEX transactions (all 6 method types)

---

## 2.7 Implementation Tasks

- [ ] Provision and configure bare-metal server
- [ ] Install and sync blockchain node
- [ ] Configure CPU isolation with `taskset`
- [ ] Set up Redis instance
- [ ] Verify IPC socket connectivity
