# Implementation Plan — VTEX Product Feed MCP

**Date:** 2026-05-07
**Spec:** specs/001-vtex-product-feed-mcp/spec.md
**Research:** specs/001-vtex-product-feed-mcp/research.md
**Data Model:** specs/001-vtex-product-feed-mcp/data-model.md

---

## Technical Context

| Dimension | Decision | Source |
|-----------|----------|--------|
| Runtime | TypeScript / Node.js ≥ 20 | Existing package.json ecosystem |
| MCP SDK | `@modelcontextprotocol/sdk` (TypeScript) | research.md — Decision 1 |
| MCP Transport | Streamable HTTP (HTTP + SSE) | research.md — Decision 1 |
| Queue | AWS SQS with DLQ per event type per account | spec FR-004–006 |
| Deduplication | Redis `SET NX` per `(accountName, skuId, eventType)` | research.md — Decision 3 |
| Mapping Cache | Redis Hash per `(accountName, channelId, vtexCategoryId)` | research.md — Decision 3 |
| SKU Enrichment Cache | Redis String (JSON) per `(accountName, skuId)` | spec FR-010 |
| Feed State Store | DynamoDB single table (`vtex-product-feed`) | research.md — Decision 2 |
| Channel Config | DynamoDB table (`vtex-channel-config`) | research.md — Decision 2 |
| Authentication (Phase 1–2) | VTEX Admin token (`AppKey` + `AppToken`) | spec Clarifications |
| Availability target | 99.5% monthly uptime | spec Clarifications |
| Scale assumption | Unbounded; instrument from existing connectors before infra sizing | spec Clarifications |

### Unresolved before Phase 0 completes
1. **Open Question 1** — Validate Checkout simulation for non-BR accounts (correct currency, non-zero price).
2. **Open Question 3** — Measure VTEX Broadcaster event loss rate and max lag (determines reconciliation cadence).

---

## Phase 0 — Prerequisites (Weeks 1–4, no new infrastructure)

**Goal:** Fix critical shared bugs, establish baseline measurements, unblock Phase 1.

### P0-1: Fix hardcoded postal code (all 5 connectors)
- Each connector team adds `country` and `representativePostalCode` to their channel registration config.
- Remove hardcoded `"04538132"` from all simulation calls.
- Done when: no active channel executes simulation without both config values present.

### P0-2: Standardize VTEX Bridge schema
- Each connector team updates Bridge writes to the 7-field schema: `skuId`, `accountName`, `channelId`, `status`, `type`, `message`, `timestamp`.
- Done when: all Bridge documents for all connectors match the schema.

### P0-3: Validate Checkout simulation parity
- Call `POST /api/checkout/pub/orderForms/simulation` for 3 non-BR accounts (US, EU, APAC) with correct `country` + `postalCode`.
- Compare results with current Fulfillment simulation for 1 single-seller account per connector.
- Done when: results documented per connector; differences reviewed and accepted or flagged.
- **Blocks Phase 1 resolver build.**

### P0-4: Baseline measurements
- Instrument 2 connectors with simulation call counters for 1 week.
- Monitor Broadcaster delivery for 1 connector for 2 weeks; run CompareAll-style reconciliation to measure event loss rate and max lag.
- Done when: numbers available to size SQS queues, Redis TTLs, and DynamoDB capacity.

---

## Phase 1 — MVP (Months 1–3)

**Goal:** Event ingestion → full 10-step pipeline → Feed State Store → 2 MVP MCP tools.

**Prerequisites:** Phase 0 complete (postal code fix + simulation parity validated).

---

### 1.1 — Channel Config Service

**Deliverable:** HTTP API for channel registration and retrieval, backed by `vtex-channel-config` DynamoDB table.

**Tasks:**
- `POST /channels` — validate all required fields (FR-001); reject if missing.
- `GET /channels/{channelId}` — retrieve config.
- `PUT /channels/{channelId}` — update config; validate `country` + `representativePostalCode`.
- Enforce: no simulation can execute without both values (FR-002).
- `active: false` channels must not receive events (FR-003).

**Acceptance:**
- Registration with any missing required field returns `400` with field-level errors.
- Attempting to activate a channel without `country`/`representativePostalCode` is rejected.
- Channel with `active: false` does not appear in event routing.

---

### 1.2 — Broadcaster Event Ingestion

**Deliverable:** Webhook endpoint that receives VTEX Broadcaster events and routes to SQS queues.

**Tasks:**
- `POST /internal/broadcaster/{accountName}` — receive Broadcaster event (contract: `broadcaster-webhook.md`).
- Route by `Domain` to `vtex-feed-{accountName}-catalog|price|stock` queue (FR-004, FR-005).
- Apply Redis dedup `SET NX` with per-channel TTL before enqueue (FR-007).
- Return HTTP 200 immediately; all processing is async.
- Create DLQ pair for each queue; DLQ messages generate `SYNC_EXHAUSTED` OfferIssue (FR-006).

**Acceptance:**
- Duplicate events within TTL window are discarded (one message in SQS per dedup key).
- Event for unknown `accountName` returns `200` (never block Broadcaster delivery).
- Queue names match convention `vtex-feed-{accountName}-{eventType}`.

---

### 1.3 — Feed Orchestrator — Steps 1–7

**Deliverable:** SQS consumer that processes each event through the first 7 pipeline steps.

**Tasks:**

**Step 1 — Eligibility Gate (FR-009)**
- Fetch SKU from VTEX Catalog API; check `IsActive`, `SalesChannels`, `IsProductActive`.
- Ineligible SKU: ack message, exit pipeline, no write, no issue.

**Step 2 — SKU Enrichment (FR-010)**
- `GET /api/catalog_system/pvt/sku/stockkeepingunitbyid/{skuId}`.
- Cache result in Redis per `(accountName, skuId)` with TTL = `dedupTtlSeconds.catalog`.
- On failure: generate `CONTENT_FETCH_ERROR` OfferIssue; re-queue with backoff.

**Step 3 — Content Normalization (FR-011)**
- Strip HTML from description; extract EAN; normalize dimensions; select main image; compute `contentVersion` SHA-256.

**Step 4 — Category & Attribute Mapping (FR-012)**
- Resolve from Redis Mapping Cache. On cache miss: generate `MISSING_MAPPING` issue; halt pipeline.
- Set `mappingStatus: complete | partial | missing`.

**Step 5 & 6 — Price and Inventory Resolution (FR-013, FR-014, FR-015)**
- Call `POST /api/checkout/pub/orderForms/simulation` with `country`, `postalCode`, `salesChannel` from channel config.
- Extract `sellingPrice`, `listPrice`, `basePrice` from `items[0]`.
- Extract `sellableQuantity` from `sum(logisticsInfo[*].deliveryChannels["delivery"].stockBalance)`.
- On `sellingPrice = 0`: generate `ZERO_PRICE` issue; halt.
- On simulation API error: re-queue with exponential backoff (1s, 5s, 30s, 5min, 30min); generate `SIMULATION_ERROR` after max retries (FR-013 clarification).
- Apply `minimumStock` threshold: if `simulatedStock ≤ minimumStock`, `sellableQuantity = 0`.
- Cache simulation result per `(accountName, skuId, salesChannel, country, postalCode)` with TTL = `dedupTtlSeconds.price`.

**Step 7 — Availability Calculation (FR-016)**
- Compute `isAvailable = catalogEligibility AND priceEligibility AND inventoryEligibility`.
- Set `unavailableReason` enum.

**Acceptance:**
- Full pipeline executes end-to-end for at least 2 test channels.
- Ineligible SKU exits silently (no DynamoDB write, no OfferIssue).
- `MISSING_MAPPING` halts pipeline and writes issue record.
- Simulation failure re-queues with correct backoff schedule.

---

### 1.4 — ProductFeed Assembly and Connector Dispatch (Steps 8–9)

**Deliverable:** Assemble canonical `ProductFeed`, check idempotency, dispatch to connector.

**Tasks:**

**Step 8 — Assembly (FR-017)**
- Merge all resolver outputs into `ProductFeed` (schema: `data-model.md`).
- Compute `feedVersion` SHA-256 of `(contentVersion + sellingPrice + sellableQuantity + isAvailable)`.
- If `feedVersion` matches last dispatched version: write `syncStatus: skipped`, exit.

**Step 9 — Dispatch (FR-018)**
- Set `syncStatus: in_flight` in DynamoDB.
- POST `ProductFeed` to `channelConfig.dispatchEndpoint` (contract: `connector-api.md`).
- On `DispatchResult.retry`: re-enqueue with backoff; increment `retryCount`.
- On `DispatchResult.error` + `retryable: false`: write `DISPATCH_ERROR` OfferIssue.
- On max retries exhausted: move to DLQ; write `SYNC_EXHAUSTED` issue; set `syncStatus: exhausted`.
- `/health` check before dispatch; skip + re-queue if connector unhealthy.

**Acceptance:**
- `feedVersion` match skips dispatch and writes `syncStatus: skipped`.
- Exponential backoff schedule: 1s, 5s, 30s, 5min, 30min.
- DLQ message generates `SYNC_EXHAUSTED` OfferIssue exactly once.

---

### 1.5 — Feed State Write (Step 10)

**Deliverable:** DynamoDB writer for `FeedState`, `SyncEvent`, and `OfferIssue` records.

**Tasks:**
- Write `FeedState` record after every dispatch attempt (success or failure) — FR-019.
- Write `SyncEvent` record with TTL = 90 days — FR-036.
- Write Bridge document via VTEX Bridge API using 7-field schema — FR-038.
- Create/resolve `OfferIssue` records on pipeline events.
- Emit metrics: `feed.sync.total`, `feed.sync.success`, `feed.sync.error`, `feed.sync.skipped` — FR-039.

**Acceptance:**
- P99 write latency < 50ms (DynamoDB local; production target).
- `FeedState.syncStatus` reflects correct state after every pipeline step.
- `SyncEvent` TTL attribute set correctly.

---

### 1.6 — MCP Tool: `getProductFeedState`

**Deliverable:** First MVP MCP tool backed by the Feed State Store.

**Tasks:**
- Implement Streamable HTTP MCP server with `@modelcontextprotocol/sdk`.
- Authenticate via VTEX Admin token validation.
- Implement `getProductFeedState` tool (schema: `contracts/mcp-tools.md`).
- Query `FeedState` record from DynamoDB `GetItem`.
- Compute `dataFreshness` from `resolvedAt` timestamps vs channel config TTLs.
- Return `404` with structured error if no record exists.

**Acceptance:**
- P95 response latency < 200ms (FR-023 / spec Success Criteria).
- `isStale` always populated; correct value verified against TTL.
- Tool returns `404` for unknown `(skuId, channelId, accountName)` — not a crash.

---

### 1.7 — MCP Tool: `listProductFeedIssues`

**Deliverable:** Second MVP MCP tool for issue inspection.

**Tasks:**
- Implement `listProductFeedIssues` tool (schema: `contracts/mcp-tools.md`).
- Query GSI-1 with optional `severity` and `issueType` SK prefix filters.
- Implement cursor-based pagination using DynamoDB `LastEvaluatedKey`.
- Return `nextCursor` absent when no more results.
- Add `FilterExpression: #ttl > :now` guard to exclude TTL-expired records (DynamoDB TTL lag).

**Acceptance:**
- Pagination correct for 100k+ records — verified with load test.
- `issueType` and `severity` filters work independently and combined.
- `nextCursor` absent on last page.

---

## Phase 2 — Shared Resolvers (Months 3–6)

**Prerequisite:** OfferIssue taxonomy agreed across all channel teams.

| Deliverable | Key tasks | Success metric |
|-------------|-----------|----------------|
| `explainOfferAvailability` MCP tool | Query FeedState, build structured breakdown, resolve simulation params | Explains all 8 `unavailableReason` values correctly |
| `StockAdjustmentHook` interface | Platform calls connector hook endpoint; enforces cap at simulated stock | Hook cannot increase stock; validated in connector test |
| Logistics Resolver (optional) | Connector-declared; platform adds logistics data to `connectorContext` | Connector can declare and receive logistics context |

---

## Phase 3 — Mapping and Content (Months 6–12)

| Deliverable | Key tasks | Success metric |
|-------------|-----------|----------------|
| Mapping Gateway with VTEX Mapper webhook | Register webhook at startup; update Redis cache; invalidate Feed State on mapping change | Cache hit rate ≥ 95% for mapping reads |
| `getMarketplaceMappingStatus` MCP tool | Query Mapping Cache; return status + missing mappings | Covers all 3 `mappingStatus` values |
| Catalog Content Gateway | `contentVersion` change detection; separate cache TTL for content vs price/stock | Content re-fetched only on change; verified with hash comparison |
| `ValidationRuleSet` registry | Connector declares content validation rules; platform applies pre-dispatch | Content violations surfaced as `CONTENT_VIOLATION` OfferIssue |

---

## Phase 4 — Orchestration and Action Tools (Months 12–18)

| Deliverable | Key tasks | Success metric |
|-------------|-----------|----------------|
| `retryFeedSync` MCP action tool | Rate limit (1/60s per key); idempotency key; blast-radius guards | 0 cases exceeding rate limit in load test |
| `compareFeedStateAcrossChannels` MCP tool | GSI-2 query; single response for all channels per SKU | Returns all active channels in ≤ 500ms |
| Per-role access control (MCP auth) | Define roles: Store Admin, Support Agent, Connector Service Account; audit log for `retryFeedSync` | Each role only accesses permitted tools |
| Full reconciliation scan | Periodic job comparing Feed State Store vs VTEX live state; re-queues drifted SKUs | Drift detected within 1 reconciliation cycle |

---

## Phase 5 — Advanced Tools (Months 18–24)

| Deliverable | Key tasks |
|-------------|-----------|
| `simulateProductFeed` MCP tool | Full pipeline dry run with override params; `isHypothetical: true` always |
| `getFeedSyncHistory` MCP tool | DynamoDB range query on `SYNC#` SK prefix; cursor pagination |
| Multi-tenancy audit | Verify partition isolation; pen test cross-tenant access |
| `ProductFeed` schema versioning | Define semantic versioning policy; connector migration guide |

---

## Open Pre-conditions (blocks listed)

| # | Condition | Blocks |
|---|-----------|--------|
| 1 | Validate Checkout simulation for non-BR accounts | Phase 0 completion |
| 2 | Measure Broadcaster loss rate + lag | Phase 1 SQS sizing, reconciliation cadence |
| 3 | Agree OfferIssue taxonomy across connector teams | Phase 2 `explainOfferAvailability` |
| 4 | Name platform team owner | Phase 1 kickoff |
| 5 | Define per-role MCP access model | Phase 4 action tools |
| 6 | Define `ProductFeed` schema versioning policy | Phase 2+ |

---

## Artifacts index

| File | Purpose |
|------|---------|
| `spec.md` | Feature specification (source of truth) |
| `research.md` | Phase 0 technical decisions |
| `data-model.md` | DynamoDB table design, Redis structures, TypeScript types |
| `contracts/mcp-tools.md` | JSON Schema for all 8 MCP tools |
| `contracts/connector-api.md` | HTTP contract for connector adapters |
| `contracts/broadcaster-webhook.md` | Incoming VTEX Broadcaster event format |
| `quickstart.md` | Local dev setup |
| `checklists/requirements.md` | Spec quality checklist |
