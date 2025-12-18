# TxnScope: Technical Specification
**Version:** 1.1 (Phase 1: Speed Validation)
**Stack:** TypeScript, Rust, Redis
**Auth Model:** API Key (Free Tier / Whitelist)
**Endpoints:** `api.txnscope.xyz`, `ws.txnscope.xyz`
**Infrastructure:** Single Bare Metal (Co-located)

---

## 1. System Architecture High-Level

The architecture is streamlined for maximum throughput and minimum "hops." We have removed the payment verification overhead to test raw metal speeds.

`[Blockchain Node]` <==IPC==> `[Ingestor Service]` --> `[Redis Pub/Sub]` --> `[API Gateway]` <==WS==> `[AI Agent]`

### Core Components (All on Localhost):

1.  **The Node (Source of Truth):**
    * **Software:** Custom fork of `monad-geth` (or Berachain `polaris`).
    * **Config:** `txpool.globalslots` increased; Garbage Collection tuned for aggressive mempool retention.
    * **Connection:** IPC (Inter-Process Communication) via Unix Socket (Not HTTP/TCP) for **0.01ms** latency.

2.  **The Ingestor (The "Ear"):**
    * **Language:** Rust (Alloy-rs) or C++.
    * **Function:** Listens to `newPendingTransactions` via IPC.
    * **Logic:**
        * **Decode:** RLPD (Recursive Length Prefix) decode immediately.
        * **Filter (Zero-Copy):** Check `MethodID` (First 4 bytes of input).
        * **Pass:** If `addLiquidity` (0xf305d719) OR `swap` family -> **Push**.
        * **Drop:** Everything else (Approvals, Transfers).
    * **Output:** Pushes minimized binary/JSON payload to Redis Channel `mempool_alpha`.

3.  **The Distribution Layer (The Buffer):**
    * **Tech:** Redis (In-memory data store).
    * **Role:** Pub/Sub mechanism. Decouples the heavy ingestion from client connections. Ensures the node never hangs if 500 clients connect at once.

4.  **The Gateway (The "Bouncer"):**
    * **Language:** TypeScript (Fastify + `ws`).
    * **Role:** Manages WebSocket connections.
    * **Auth:** Simple Bearer Token (API Key) check from `.env` or Redis whitelist.
    * **Broadcast:** Subscribes to Redis -> Pushes to connected WebSockets.

---

## 2. Hardware Strategy (CPU Pinning)
*Risk:* The API Gateway (Node.js) eats CPU and slows down the Blockchain Node.
*Solution:* We isolate processes to specific CPU cores using `taskset`.

**Example Server (16 Core AMD EPYC):**
* **Cores 0-11:** Dedicated to **Blockchain Node** (Syncing is heavy).
* **Core 12:** Dedicated to **Rust Ingestor** (Needs 100% single-thread performance).
* **Core 13:** Dedicated to **Redis**.
* **Cores 14-15:** Dedicated to **API Gateway** (WebSocket management).

*Result:* Even if 10,000 clients spam your API Gateway, Cores 0-11 remain untouched, ensuring the Node never lags behind the network.

---

## 3. Technology Stack Selection

| Component | Technology | Reasoning |
| :--- | :--- | :--- |
| **Node Client** | **Reth / Geth** | Industry standard, robust. |
| **Ingestion** | **Rust** (Alloy-rs) | Zero GC pauses, critical for "Hot Path" filtering. |
| **API Server** | **TypeScript** (Fastify) | Fastest Node.js framework; strong typing. |
| **Database** | **Redis** | Sub-millisecond Pub/Sub glue. |
| **DevOps** | **Docker Compose** | Simple containerization for Phase 1. |

---

## 4. Latency Benchmarks (The Product)
Since we are not charging yet, our "Product" is the **Latency Log**. We must prove we are faster than public RPCs.

**The "Latency Logger" Tool:**
A script running on a separate server that subscribes to **TxnScope** and **Alchemy/QuickNode** simultaneously.

**Logic:**
1.  Listen for Tx Hash `0x123...` on TxnScope.
2.  Listen for Tx Hash `0x123...` on Public RPC.
3.  Calculate `Delta = Timestamp(Public) - Timestamp(TxnScope)`.
4.  **Target:** Delta > 150ms (positive).

| Step | Time Budget | Note |
| :--- | :--- | :--- |
| Node Detection | T+0ms | Instant (Bare Metal) |
| Ingest & Decode | 5ms | Rust native decoding |
| Redis Push | 2ms | Localhost (IPC) |
| WebSocket Push | 10ms | Network propagation |
| **Total Latency** | **~17ms** | **vs. Public RPC (200-500ms)** |

---

## 5. Security & Risk Mitigation (Phase 1)
* **Connection Draining:** If a client reads too slowly, the WebSocket buffer fills up.
    * *Fix:* Drop clients immediately if their buffer exceeds 5MB. "Keep up or get out."
* **Chain Reorgs:** We stream *pending* data. We do not validate block inclusion.
    * *Disclaimer:* "Raw Data Stream - Use logic to verify nonce/gas."

---

## 6. Week 1 Build Sprint (Revised)

* **Day 1: Infrastructure**
    * Rent Bare Metal (Hetzner AX line / Latitude).
    * Start Node Sync (Monad Devnet / Berachain Artio).
    * Configure `taskset` for CPU isolation.
* **Day 2: The Ingestor (Rust)**
    * Connect to `geth.ipc`.
    * Implement basic filter (Log only `swap` method IDs).
    * Push to Redis.
* **Day 3: The Gateway (TypeScript)**
    * Setup Fastify WebSocket server.
    * Implement API Key middleware.
    * Connect Redis Subscriber -> WebSocket Broadcast.
* **Day 4: The Proof**
    * Build `benchmark.ts` script.
    * Run live comparison against a public RPC.
    * Generate a `latency_report.md` with 1 hour of data.
* **Day 5: Demo Asset**
    * Record screen showing the `benchmark.ts` log output (Scrolling green text showing "+200ms WIN").