# Phase 6: x402 Payment Integration

**Status:** Future
**Sprint:** Post-MVP

> **Note:** This phase is scheduled for future development after Phase 2-5 and 9 are complete.

---

## 6.1 x402 Authentication Flow

1. Client connects to WebSocket
2. Server sends challenge: `{ type: "CHALLENGE", nonce, price }`
3. Client signs and responds: `{ type: "PROOF", signature, pubKey }`
4. Server verifies signature (ecrecover)
5. Server checks balance (Redis cache or on-chain)
6. Stream opens or connection rejected

---

## 6.2 Optimistic Streaming (Whale Tier)

- Skip per-message signatures for whitelisted clients
- Checkpoint signature every 60 seconds
- $1,000/month flat fee

---

## 6.3 Pay-Per-View Tier

- $0.10 - $0.50 per "Alpha Signal"
- Instant settlement via state channels
- Zero-subscription model

---

## 6.4 Tasks

- [ ] Implement challenge generation
- [ ] Implement signature verification (viem/ethers)
- [ ] Implement balance checking (Redis cache)
- [ ] Implement optimistic streaming for whitelisted addresses
- [ ] Add metering for pay-per-view
