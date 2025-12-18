# Phase 8: Client SDK

**Status:** Future
**Sprint:** Post-MVP

> **Note:** This phase is scheduled for future development after Phase 2-5 and 9 are complete.

---

## 8.1 TypeScript SDK

```typescript
import { TxnScope } from 'txnscope';

const client = new TxnScope({
  apiKey: 'your-api-key',
  // OR for x402
  privateKey: '0x...'
});

client.on('transaction', (tx) => {
  console.log('New liquidity event:', tx);
});

client.on('error', (err) => {
  console.error('Connection error:', err);
});

await client.connect();
```

---

## 8.2 Features

- Auto-reconnection with backoff
- Event-based API
- TypeScript types
- x402 signing helpers

---

## 8.3 Tasks

- [ ] Create `packages/sdk/` with package.json
- [ ] Implement WebSocket client
- [ ] Implement auto-reconnection
- [ ] Implement x402 signing (optional)
- [ ] Add TypeScript types
- [ ] Write documentation
