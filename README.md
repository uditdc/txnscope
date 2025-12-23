# TxnScope

> **The Bloomberg Terminal for AI Agents**

TxnScope is a Mempool-as-a-Service (MaaS) infrastructure built for the AI Agent Economy. We provide sub-50ms access to pending blockchain transactions, giving AI agents the speed advantage they need to be profitable.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new)

## The Problem

While 19% of all blockchain activity is now driven by AI agents, these agents are currently "blind"—relying on slow, public RPC nodes that deliver transaction data 2-3 seconds too late. In DeFi, milliseconds matter.

## Our Solution

**TxnScope provides a bare-metal, low-latency "Fast Lane"** that delivers pending transaction data to agents **milliseconds** before it hits the block.

- **Target Latency:** <50ms (goal: ~17ms)
- **Comparison:** Public RPCs deliver in 200-500ms
- **Advantage:** 150-450ms head start
- **Monetization:** x402 payment standard for agent-native payments

## Architecture

```
[Blockchain Node] <==IPC==> [Ingestor] --> [Redis Pub/Sub] --> [Gateway] <==WS/x402==> [AI Agent]
     (Monad/Berachain)      (Rust)         (In-Memory)       (TypeScript)
```

### Core Components

1. **Ingestor Service** (Rust)

   - Connects to blockchain node via IPC (Unix socket)
   - Filters DEX liquidity events (addLiquidity, swap methods)
   - Zero-copy RLP decoding for maximum performance
   - Publishes to Redis in <7ms

2. **Gateway Service** (TypeScript)

   - Fastify WebSocket server
   - API key authentication (Phase 1)
   - Redis subscriber → client broadcast
   - Connection management & rate limiting

3. **Redis Pub/Sub**
   - Sub-millisecond message delivery
   - Decouples ingestion from distribution
   - Handles burst traffic gracefully

## x402 Payment Integration (Phase 2)

TxnScope uses the [x402 Payment Required](https://www.x402.org/) standard for agent-native monetization:

- **HTTP 402 Flow:** Agents receive payment-required responses with pricing metadata
- **State Channels:** Near-instant settlement without per-transaction gas costs
- **Pay-per-Request:** No subscriptions required; agents pay only for data consumed
- **Smart Contract Escrow:** Funds held in on-chain escrow, released on valid delivery

This enables autonomous AI agents to programmatically pay for premium mempool access.

## Quick Start

### Option 1: GitHub Codespaces (Recommended)

The dev container includes:

- ✅ Rust toolchain (stable)
- ✅ Node.js 20.x
- ✅ Redis 7
- ✅ All VS Code extensions

### Option 2: Local Development

**Prerequisites:**

- Rust (install from [rustup.rs](https://rustup.rs))
- Node.js 20.x
- Redis 7

**Setup:**

```bash
# Clone the repository
git clone https://github.com/uditdc/txnscope
cd txnscope

# Install TypeScript gateway dependencies
cd packages/gateway
npm install

# Run the gateway
npm run dev

# In another terminal: Run the Rust ingestor
cd packages/ingestor
cargo run
```

## Project Structure

```
txnscope/
├── packages/
│   ├── ingestor/          # Rust service (IPC → Redis)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       └── main.rs
│   ├── gateway/           # TypeScript API (Redis → WebSocket)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── ws/        # WebSocket handlers
│   │       ├── redis/     # Redis subscriber
│   │       └── auth/      # API key authentication
│   ├── contracts/         # Solidity (Phase 2: x402 payments)
│   └── sdk/               # Client SDK (Phase 2)
├── docker/                # Production Dockerfiles
├── scripts/               # Latency logger & benchmarks
├── .devcontainer/         # GitHub Codespaces config
└── docs/
    ├── prd-v1.1.md       # Technical specification
    └── plans/
        └── v0.1.md       # Implementation plan
```

## Development Workflow

### Running the Ingestor

```bash
cd packages/ingestor

# Development (with hot reload)
cargo watch -x run

# Check compilation
cargo check

# Run tests
cargo test

# Build release
cargo build --release
```

### Running the Gateway

```bash
cd packages/gateway

# Development (with hot reload)
npm run dev

# Build
npm run build

# Production
npm start
```

### Testing Redis Connection

```bash
# Ping Redis
redis-cli ping

# Monitor Redis pub/sub
redis-cli
> SUBSCRIBE mempool_alpha
```

## Target Method IDs (DEX Filters)

The ingestor filters for these high-value DeFi methods:

```
0xf305d719 - addLiquidityETH
0xe8e33700 - addLiquidity
0x7ff36ab5 - swapExactETHForTokens
0x38ed1739 - swapExactTokensForTokens
0x8803dbee - swapTokensForExactTokens
0x18cbafe5 - swapExactTokensForETH
```

## Configuration

Copy `.env.example` to `.env` and configure:

```env
# Blockchain Node
NODE_IPC_PATH=/path/to/geth.ipc
CHAIN_ID=monad

# Redis
REDIS_URL=redis://localhost:6379
REDIS_CHANNEL=mempool_alpha

# Gateway
WS_PORT=8080
API_PORT=3000

# Authentication
API_KEYS=your-key-1,your-key-2

# x402 Payments (Phase 2)
X402_CONTRACT_ADDRESS=0x...
X402_ENABLED=false
```

## Performance Targets

| Component           | Latency Target |
| ------------------- | -------------- |
| Node Detection      | T+0ms          |
| Decode & Filter     | <5ms           |
| Redis Push          | <2ms           |
| WebSocket Broadcast | <10ms          |
| **Total**           | **~17ms**      |

## Documentation

- [Technical Specification](./docs/prd-v1.1.md) - System architecture & design

## Contributing

We're currently in stealth mode building the MVP. Stay tuned for contribution guidelines.

## License

Proprietary - All rights reserved

---

**Built with:**

- 🦀 Rust (Alloy, Tokio, Redis)
- 📗 TypeScript (Fastify, WebSocket, ioredis, Viem)
- 🔴 Redis (Pub/Sub)
- 🐳 Docker & GitHub Codespaces
