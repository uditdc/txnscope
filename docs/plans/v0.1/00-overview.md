# TxnScope v0.1 Implementation Plan

## Overview

This plan outlines the complete implementation of TxnScope - a Mempool-as-a-Service infrastructure for AI agents. Built from the Business Plan (README.md) and Technical Spec (prd-v1.1.md).

**Core Thesis:** "The Bloomberg Terminal for AI Agents"
**Target Chains:** Monad, Berachain
**Target Latency:** <50ms (goal: ~17ms vs 200-500ms public RPCs)

---

## Phase Index

| Phase | Name | Status | Sprint |
|-------|------|--------|--------|
| [01](./01-project-setup.md) | Project Setup & Repository Structure | ✅ Complete | - |
| [02](./02-infrastructure.md) | Infrastructure Setup | In Progress | Sprint 1-2 |
| [03](./03-rust-ingestor.md) | Rust Ingestor Service | In Progress | Sprint 1-2 |
| [04](./04-ts-gateway.md) | TypeScript Gateway Service | In Progress | Sprint 1-2 |
| [05](./05-latency-benchmarking.md) | Latency Proof & Benchmarking | In Progress | Sprint 1-2 |
| [06](./06-x402-payments.md) | x402 Payment Integration | Future | Post-MVP |
| [07](./07-smart-contracts.md) | Smart Contracts | Future | Post-MVP |
| [08](./08-client-sdk.md) | Client SDK | Future | Post-MVP |
| [09](./09-devops.md) | DevOps & Deployment | Pending | Sprint 3 |

---

## Local Development & Testing Stack

### Anvil (Local Blockchain Node)
Anvil from Foundry provides a local Ethereum node for TDD:
- **Instant startup** - No sync time, immediate testing
- **IPC socket support** - Same interface as production nodes
- **Deterministic** - Reproducible test scenarios
- **CI/CD friendly** - Runs in GitHub Actions

**Installation:**
```bash
# Install Foundry (includes Anvil)
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

**Usage for Testing:**
```bash
# Start Anvil with IPC socket
anvil --ipc

# IPC socket created at: /tmp/anvil.ipc (or ~/.foundry/anvil.ipc)
```

### Test Infrastructure Architecture
```
┌─────────────┐    IPC     ┌───────────┐     Redis    ┌─────────┐
│   Anvil     │ ──────────▶│  Ingestor │ ────────────▶│  Redis  │
│ (local node)│  (socket)  │  (Rust)   │   (pub/sub)  │ (Docker)│
└─────────────┘            └───────────┘              └─────────┘
                                                           │
                                                           ▼
                                                    ┌───────────┐
                                                    │  Gateway  │
                                                    │(TypeScript)│
                                                    └───────────┘
```

---

## TDD-Based Development Schedule

### Sprint 1: Test Development (Weeks 1-2)
**Approach:** Write all tests first using Anvil + mocks

| Focus | Test Coverage |
|-------|---------------|
| **Infra Tests** | Anvil IPC validation, Redis latency scripts |
| **Ingestor Tests** | Rust unit tests (decoder, filter, publisher) + Anvil integration |
| **Gateway Tests** | TypeScript unit tests (auth, broadcast) + integration tests |
| **Latency Tests** | Delta calculation, timestamp precision tests |

### Sprint 2: Implementation (Weeks 3-4)
**Approach:** Implement code to make all tests pass

| Focus | Implementation |
|-------|----------------|
| **Infrastructure** | Production server setup (Hetzner), real node sync |
| **Ingestor** | Rust implementation (IPC, decoder, filter, publisher) |
| **Gateway** | TypeScript implementation (WebSocket, Redis, auth) |
| **Latency Tools** | Latency logger and benchmark report generation |

### Sprint 3: DevOps & Deployment (Week 5)
**Approach:** Production deployment with monitoring

| Focus | Deliverable |
|-------|-------------|
| **Phase 9** | Dockerfiles, docker-compose, health checks, monitoring |

### Future Development (Post-MVP)
**Approach:** After core system is production-ready

| Focus | Timeline |
|-------|----------|
| **Phase 6** | x402 Payment Integration |
| **Phase 7** | Smart Contracts |
| **Phase 8** | Client SDK |

---

## Success Criteria

### Sprint 1: Test Development (Weeks 1-2)
- [ ] Anvil test infrastructure scripts written and working
- [ ] All Rust Ingestor tests written (inline unit + integration)
- [ ] All TypeScript Gateway tests written (unit, integration, E2E, load)
- [ ] All latency benchmarking tests written
- [ ] Test coverage documented and reviewed

### Sprint 2: Implementation (Weeks 3-4)
- [ ] All infrastructure validation tests passing with Anvil
- [ ] All Rust Ingestor tests passing (>80% coverage)
- [ ] All TypeScript Gateway tests passing (>80% coverage)
- [ ] All latency benchmarking tests passing (>80% coverage)
- [ ] End-to-end latency <50ms (target: ~17ms)
- [ ] Latency logger showing >200ms improvement vs public RPC

### Sprint 3: DevOps & Deployment (Week 5)
- [ ] Dockerfiles built and tested for both services
- [ ] docker-compose orchestration working
- [ ] Health check endpoints operational
- [ ] Prometheus metrics exporting
- [ ] Production deployment successful
- [ ] Demo video ready for grant application

### Future Development (Post-MVP)
- [ ] x402 payment authentication working (Phase 6)
- [ ] DepositVault contract deployed to testnet (Phase 7)
- [ ] Client SDK published to npm (Phase 8)
- [ ] 3 beta testers onboarded

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Node sync delays | Use checkpoint sync, start early |
| IPC reliability | Implement reconnection with exponential backoff |
| Redis bottleneck | Monitor memory, configure eviction policy |
| Slow client accumulation | Drop clients with buffer >5MB |
| Chain reorgs | Disclaimer: "Raw pending data - verify nonce/gas" |

---

## Files to Create

### Phase 1 (Complete) ✅
- `packages/ingestor/Cargo.toml` ✅
- `packages/ingestor/src/main.rs` ✅
- `packages/gateway/package.json` ✅
- `packages/gateway/tsconfig.json` ✅
- `packages/gateway/src/index.ts` ✅
- `.env.example` ✅
- `.devcontainer/*` ✅
- `README.md` ✅

### Sprint 1: Tests (Phase 2-5)

**Infrastructure Test Scripts:**
- `scripts/test-infra/start-test-stack.sh`
- `scripts/test-infra/stop-test-stack.sh`
- `scripts/test-infra/validate-anvil.sh`
- `scripts/test-infra/validate-redis.sh`
- `scripts/test-infra/send-mock-swap.sh`
- `scripts/fixtures/sample-swap-tx.json`

**Rust Ingestor Tests:**
- `packages/ingestor/src/lib.rs`
- `packages/ingestor/tests/anvil_integration.rs`
- `packages/ingestor/tests/mock_pipeline.rs`
- `packages/ingestor/tests/latency_benchmark.rs`

**TypeScript Gateway Tests:**
- `packages/gateway/tests/unit/auth.test.ts`
- `packages/gateway/tests/unit/message-format.test.ts`
- `packages/gateway/tests/integration/websocket.test.ts`
- `packages/gateway/tests/integration/redis-broadcast.test.ts`
- `packages/gateway/tests/e2e/full-flow.test.ts`

**Latency Tool Tests:**
- `scripts/tests/delta-calculation.test.ts`
- `scripts/tests/timestamp-recording.test.ts`

### Sprint 2: Implementation (Phase 2-5)

**Rust Ingestor Implementation:**
- `packages/ingestor/src/ipc.rs`
- `packages/ingestor/src/decoder.rs`
- `packages/ingestor/src/filter.rs`
- `packages/ingestor/src/publisher.rs`

**TypeScript Gateway Implementation:**
- `packages/gateway/src/ws/handler.ts`
- `packages/gateway/src/ws/connection.ts`
- `packages/gateway/src/redis/subscriber.ts`
- `packages/gateway/src/auth/apikey.ts`

**Latency Tools:**
- `scripts/latency-logger.ts`
- `scripts/benchmark.ts`

### Sprint 3: DevOps (Phase 9)
- `docker/Dockerfile.ingestor`
- `docker/Dockerfile.gateway`
- `docker/docker-compose.prod.yml`
- `scripts/deploy.sh`

### Future (Phase 6-8)
- `packages/contracts/foundry.toml`
- `packages/contracts/src/DepositVault.sol`
- `packages/sdk/package.json`
- `packages/sdk/src/index.ts`
