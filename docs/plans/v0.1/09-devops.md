# Phase 9: DevOps & Deployment

**Status:** Pending
**Sprint:** Sprint 3

---

## 9.1 Docker Configuration

**Dockerfile.ingestor**
```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY packages/ingestor .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/ingestor /usr/local/bin/
CMD ["ingestor"]
```

**Dockerfile.gateway**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY packages/gateway/package*.json ./
RUN npm ci --only=production
COPY packages/gateway/dist ./dist
CMD ["node", "dist/index.js"]
```

---

## 9.2 docker-compose.yml

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  ingestor:
    build:
      context: .
      dockerfile: docker/Dockerfile.ingestor
    volumes:
      - /path/to/geth.ipc:/geth.ipc
    depends_on: [redis]

  gateway:
    build:
      context: .
      dockerfile: docker/Dockerfile.gateway
    ports: ["8080:8080"]
    depends_on: [redis, ingestor]
```

---

## 9.3 Environment Configuration

```env
# Node
NODE_IPC_PATH=/path/to/geth.ipc
CHAIN_ID=monad

# Redis
REDIS_URL=redis://localhost:6379

# Gateway
WS_PORT=8080
API_PORT=3000

# Auth
API_KEYS=key1,key2,key3
WHALE_WHITELIST=0x...,0x...

# x402 (Phase 2)
PRICE_PER_SIGNAL=100
```

---

## 9.4 Monitoring

- Health check endpoints (`/health`)
- Prometheus metrics export
- Latency histograms
- Connection count tracking

---

## 9.5 Test-Driven Development Approach

**Test Categories:**
- Build tests: Verify Dockerfiles build successfully
- Health check tests: Verify `/health` endpoints respond
- Integration tests: Verify container orchestration works
- Shutdown tests: Verify graceful shutdown handling

---

## 9.6 Test Tasks

- [ ] Write test to verify Dockerfile.ingestor builds
- [ ] Write test to verify Dockerfile.gateway builds
- [ ] Write test for docker-compose service startup
- [ ] Write test for health check endpoint responses
- [ ] Write test for graceful shutdown handling

---

## 9.7 Implementation Tasks

- [ ] Create Dockerfile.ingestor
- [ ] Create Dockerfile.gateway
- [ ] Create docker-compose.prod.yml
- [ ] Set up health check endpoints
- [ ] Add Prometheus metrics
- [ ] Create deployment scripts
