# Phase 4: TypeScript Gateway Service

**Status:** In Progress
**Sprint:** Sprint 1-2

---

## 4.1 Dependencies (package.json)

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@fastify/websocket": "^11.x",
    "ioredis": "^5.x",
    "viem": "^2.x",
    "dotenv": "^16.x",
    "pino": "^9.x"
  },
  "devDependencies": {
    "vitest": "^2.x",
    "@vitest/coverage-v8": "^2.x",
    "ioredis-mock": "^8.x",
    "typescript": "^5.x",
    "tsx": "^4.x"
  }
}
```

---

## 4.2 Core Components

### WebSocket Server
- Endpoint: `wss://ws.txnscope.xyz/v1/stream`
- Fastify with `@fastify/websocket`
- Connection management with client tracking
- Heartbeat/ping-pong (30s interval)
- Buffer overflow protection (drop clients > 5MB buffer)

### Redis Subscriber
- Subscribe to `mempool_alpha` channel
- Broadcast to all authenticated clients
- Message batching for efficiency

### API Key Authentication (Phase 1)
- Bearer token validation from `.env` or Redis whitelist
- Simple middleware check on WebSocket upgrade

### Connection Draining
- Monitor client read speed
- Drop slow clients immediately
- Log disconnection reasons

---

## 4.3 API Endpoints

```
GET    /health              - Health check
GET    /v1/balance/:address - Check prepaid balance (future)
WS     /v1/stream           - Transaction stream (requires API key)
```

---

## 4.4 Test-Driven Development Approach

**Test First Philosophy:**
1. Write failing tests that define expected API behavior
2. Implement minimal code to make tests pass
3. Refactor while keeping tests green
4. Test for edge cases and error conditions

**Test Categories:**
- Unit tests: Test individual modules in isolation (auth, message formatting)
- Integration tests: Test component interactions (Redis → WebSocket broadcast)
- E2E tests: Test complete client connection → transaction broadcast flow
- Load tests: Test connection scaling and slow client handling

**Testing Tools:**
- Testing framework: `vitest` (faster) or `jest`
- WebSocket testing: `ws` client library for test connections
- Mocking: `ioredis-mock` for Redis, custom WebSocket mock clients
- Coverage: `vitest coverage` or `jest --coverage`
- Coverage requirements: >80% for core logic

**Test File Structure:**
```
packages/gateway/
├── src/
│   ├── index.ts
│   ├── ws/
│   │   ├── handler.ts
│   │   └── connection.ts
│   ├── redis/
│   │   └── subscriber.ts
│   └── auth/
│       └── apikey.ts
└── tests/
    ├── unit/
    │   ├── auth.test.ts
    │   ├── message-format.test.ts
    │   └── connection-draining.test.ts
    ├── integration/
    │   ├── websocket.test.ts
    │   └── redis-broadcast.test.ts
    └── e2e/
        ├── full-flow.test.ts
        └── load-test.test.ts
```

---

## 4.5 Test Tasks

- [ ] Write unit tests for API key authentication (valid/invalid keys)
- [ ] Write unit tests for message formatting and serialization
- [ ] Write unit tests for slow client detection and draining
- [ ] Write integration test for Redis subscriber → WebSocket broadcast
- [ ] Write integration test for WebSocket connection lifecycle (connect/disconnect)
- [ ] Write E2E test for full client authentication → transaction stream flow
- [ ] Write E2E test for multiple concurrent clients
- [ ] Write load test for 100+ simultaneous connections
- [ ] Achieve >80% code coverage for core modules

---

## 4.6 Implementation Tasks

- [ ] Create `packages/gateway/` with package.json and tsconfig
- [ ] Implement Fastify server with health endpoint
- [ ] Implement WebSocket handler with connection management
- [ ] Implement Redis subscriber
- [ ] Implement API key authentication middleware
- [ ] Implement broadcast logic
- [ ] Add connection draining for slow clients
- [ ] Add logging and metrics
