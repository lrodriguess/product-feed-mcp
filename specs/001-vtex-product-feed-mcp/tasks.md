# Tasks — VTEX Product Feed MCP

**Feature:** VTEX Product Feed MCP Platform
**Plan:** specs/001-vtex-product-feed-mcp/plan.md
**Spec:** specs/001-vtex-product-feed-mcp/spec.md
**Generated:** 2026-05-07

---

## User Stories → Phase Mapping

| User Story | Description | Phase | Priority |
|------------|-------------|-------|----------|
| US4 | New channel onboarded and begins receiving events | Phase 3 | P1 |
| US5 | Connector receives dispatch and returns a result | Phase 4–5 | P1 |
| US2 | Operator confirms the last synced price for a SKU | Phase 6 | P1 |
| US3 | Platform operator lists all open feed issues | Phase 7 | P1 |
| US6 | SKU with missing mapping is blocked and surfaced | Phase 8 | P2 |
| US1 | Support agent diagnoses why a SKU is unavailable | Phase 9 | P2 |
| US7 | Manual re-sync triggered for a single SKU | Phase 10 | P3 |

---

## Phase 1 — Project Setup

**Goal:** Initialise the repository, install dependencies, and wire local infrastructure.

- [ ] T001 Initialise TypeScript project: `package.json`, `tsconfig.json`, `src/` directory in repo root
- [ ] T002 Install runtime dependencies: `@modelcontextprotocol/sdk`, `@aws-sdk/client-dynamodb`, `@aws-sdk/client-sqs`, `ioredis`, `zod`, `express`, `dotenv`
- [ ] T003 Install dev dependencies: `typescript`, `ts-node`, `@types/node`, `@types/express`, `jest`, `ts-jest`, `supertest`
- [ ] T004 Create `docker-compose.yml` with services: `dynamodb-local` (port 8000), `redis` (port 6379), `localstack` for SQS (port 4566)
- [ ] T005 Create `.env.example` with all variables from `specs/001-vtex-product-feed-mcp/quickstart.md` env section
- [ ] T006 Create `src/config/env.ts` — load and validate env vars using `zod`; throw on missing required values
- [ ] T007 [P] Create `src/config/aws.ts` — initialise DynamoDB and SQS clients from env; support `DYNAMODB_ENDPOINT` and `AWS_ENDPOINT` overrides for local dev
- [ ] T008 [P] Create `src/config/redis.ts` — initialise `ioredis` client from `REDIS_URL`; export singleton
- [ ] T009 Create `scripts/db-bootstrap.ts` — create `vtex-product-feed` main table with GSI-1 and GSI-2, and `vtex-channel-config` table (schema from `specs/001-vtex-product-feed-mcp/data-model.md`)
- [ ] T010 Add `yarn db:bootstrap`, `yarn dev`, `yarn build`, `yarn test` scripts to `package.json`

---

## Phase 2 — Foundational Infrastructure

**Goal:** Shared clients and middleware used by all user stories. Must be complete before Phase 3.

- [ ] T011 Create `src/clients/vtex-catalog.ts` — typed wrapper for `GET /api/catalog_system/pvt/sku/stockkeepingunitbyid/{skuId}?an={accountName}`; includes `AppKey`/`AppToken` auth headers
- [ ] T012 [P] Create `src/clients/vtex-simulation.ts` — typed wrapper for `POST /api/checkout/pub/orderForms/simulation`; accepts `(skuId, salesChannel, accountName, country, postalCode)`; returns raw simulation response
- [ ] T013 [P] Create `src/clients/vtex-bridge.ts` — typed wrapper for writing VTEX Bridge documents using the 7-field schema from `specs/001-vtex-product-feed-mcp/spec.md` FR-038
- [ ] T014 Create `src/middleware/vtex-auth.ts` — Express middleware that validates `X-VTEX-API-AppKey` + `X-VTEX-API-AppToken` headers; returns `403` if absent or invalid
- [ ] T015 [P] Create `src/store/feed-state.ts` — DynamoDB repository for `FeedState` records: `getByKey(accountName, channelId, skuId)`, `upsert(record)`, key pattern `ACCT#{accountName}#CHAN#{channelId}` / `SKU#{skuId}`
- [ ] T016 [P] Create `src/store/sync-event.ts` — DynamoDB repository for `SyncEvent` records: `write(event)`, `queryHistory(accountName, channelId, skuId, since?, limit?)`, TTL = 90 days; SK pattern `SYNC#{iso8601}#{skuId}`
- [ ] T017 [P] Create `src/store/offer-issue.ts` — DynamoDB repository for `OfferIssue` records: `create(issue)`, `resolve(issueId)`, `listByChannel(accountName, channelId, filters, cursor, limit)` using GSI-1; TTL set 30d after `resolvedAt`
- [ ] T018 Create `src/cache/redis-dedup.ts` — `acquireDedup(accountName, skuId, eventType, ttlSeconds): Promise<boolean>` using `SET NX EX`; returns `true` if slot acquired
- [ ] T019 [P] Create `src/cache/sku-enrichment.ts` — `get(accountName, skuId): CachedSku | null`, `set(accountName, skuId, data, ttlSeconds)` using `ioredis`
- [ ] T020 [P] Create `src/cache/mapping-cache.ts` — `get(accountName, channelId, vtexCategoryId)`, `set(accountName, channelId, vtexCategoryId, mapping, ttlSeconds)`, `invalidate(accountName, channelId)` using Redis Hash
- [ ] T021 Create `src/types/index.ts` — export all TypeScript interfaces from `specs/001-vtex-product-feed-mcp/data-model.md`: `ChannelConfig`, `ProductFeed`, `FeedState`, `SyncEvent`, `OfferIssue`, `DispatchResult`, `MappingResult`, `AvailabilityResult`, `PriceResult`, `InventoryResult`
- [ ] T022 Create `src/sqs/client.ts` — typed SQS helpers: `enqueue(queueUrl, body)`, `getQueueUrl(accountName, eventType)` returning `vtex-feed-{accountName}-{eventType}`
- [ ] T023 Create `src/sqs/bootstrap-queues.ts` — ensure main queue + DLQ pair exist for a given `(accountName, eventType)`; idempotent (uses `CreateQueue` with `GetQueueAttributes` guard)

---

## Phase 3 — US4: Channel Registration and Onboarding

**Story goal:** A platform administrator registers a new channel, and it begins receiving product feed events.

**Independent test:** `POST /channels` with valid payload returns `201`; second `POST /channels` for same `channelId` returns `409`; channel with `active: false` is excluded from event routing.

- [ ] T024 [US4] Create `src/channels/channel-config.repository.ts` — DynamoDB CRUD for `vtex-channel-config` table: `create`, `getById`, `update`, `list(accountName)`
- [ ] T025 [US4] Create `src/channels/channel-config.validator.ts` — `zod` schema enforcing all required fields from spec FR-001: `channelId`, `connectorType`, `accountName`, `salesChannel`, `tradePolicy`, `country`, `representativePostalCode`, `currency`, `dedupTtlSeconds`, `minimumStock`, `maxRetries`, `dispatchEndpoint`, `active`
- [ ] T026 [US4] Create `src/channels/channel-config.service.ts` — `register(payload)`: validate → check duplicate `channelId` (409) → write to DynamoDB → bootstrap SQS queues via `bootstrap-queues.ts`; `getById(channelId)`; `update(channelId, patch)`: re-validate required fields on activation
- [ ] T027 [US4] Create `src/channels/channel-config.router.ts` — Express router: `POST /channels`, `GET /channels/:channelId`, `PUT /channels/:channelId`; apply `vtex-auth` middleware to all routes
- [ ] T028 [US4] Add `POST /channels` validation: reject if `country` or `representativePostalCode` is absent when `active: true` (spec FR-002)
- [ ] T029 [US4] Wire `channel-config.router.ts` into main Express app at `src/app.ts`

---

## Phase 4 — US5 (Part A): Broadcaster Event Ingestion

**Story goal:** VTEX Broadcaster posts an event; the platform deduplicates and routes it to the correct SQS queue.

**Independent test:** POST to `/internal/broadcaster/{accountName}` with a stock event → message in `vtex-feed-{accountName}-stock` queue; second identical POST within TTL → no new SQS message (dedup).

- [ ] T030 [US5] Create `src/broadcaster/event.types.ts` — TypeScript types for VTEX Broadcaster payload (from `specs/001-vtex-product-feed-mcp/contracts/broadcaster-webhook.md`): `BroadcasterEvent`, `EventDomain`, `EventType`
- [ ] T031 [US5] Create `src/broadcaster/event-router.ts` — `routeEvent(event): EventType` mapping `Domain` → `catalog | price | stock` per routing table in `broadcaster-webhook.md`
- [ ] T032 [US5] Create `src/broadcaster/ingestion.handler.ts` — `handleEvent(accountName, event)`: (1) look up active channels for `accountName`, (2) apply `acquireDedup`, (3) `enqueue` to SQS, (4) return immediately; always `200`
- [ ] T033 [US5] Create `src/broadcaster/ingestion.router.ts` — `POST /internal/broadcaster/:accountName`; no auth (Broadcaster cannot send tokens); validate payload shape with `zod`
- [ ] T034 [US5] Wire `ingestion.router.ts` into `src/app.ts`

---

## Phase 5 — US5 (Part B): Feed Orchestrator — 10-Step Pipeline

**Story goal:** An SQS event triggers the full pipeline; a `ProductFeed` is assembled, dispatched to the connector, and the result written to the Feed State Store.

**Independent test:** Enqueue a stock event for a registered test channel → after processing: `FeedState` in DynamoDB has `syncStatus: synced`; Bridge document written; `SyncEvent` record present with 90d TTL.

- [ ] T035 [US5] Create `src/pipeline/step1-eligibility.ts` — fetch SKU from `vtex-catalog` client (or enrichment cache); check `IsActive`, `IsProductActive`, `SalesChannels.includes(salesChannel)`; return `{ eligible: boolean }`
- [ ] T036 [US5] Create `src/pipeline/step2-enrichment.ts` — fetch full SKU from `vtex-catalog` client; write to `sku-enrichment` cache; on API failure generate `CONTENT_FETCH_ERROR` OfferIssue and throw `RetryableError`
- [ ] T037 [US5] Create `src/pipeline/step3-normalization.ts` — `normalizeSku(rawSku)`: strip HTML, extract EAN, normalize dimensions (both `Dimension` + `RealDimension`), select main image, compute `contentVersion` SHA-256
- [ ] T038 [US5] Create `src/pipeline/step4-mapping.ts` — read from `mapping-cache`; if cache miss for `vtexCategoryId` → create `MISSING_MAPPING` OfferIssue → throw `PipelineHaltError`; set `mappingStatus`
- [ ] T039 [US5] Create `src/pipeline/step5-price.ts` — call `vtex-simulation` client with channel config `(country, postalCode, salesChannel)`; extract `sellingPrice`, `listPrice`, `basePrice`; on `sellingPrice = 0` → create `ZERO_PRICE` issue + `PipelineHaltError`; on API error → `RetryableError`; cache result in Redis
- [ ] T040 [US5] Create `src/pipeline/step6-inventory.ts` — extract `sellableQuantity` from same simulation response (`sum of logisticsInfo[*].deliveryChannels["delivery"].stockBalance`); apply `minimumStock` threshold
- [ ] T041 [US5] Create `src/pipeline/step7-availability.ts` — compute `isAvailable = catalogEligibility AND priceEligibility AND inventoryEligibility`; set `unavailableReason` enum
- [ ] T042 [US5] Create `src/pipeline/step8-assembly.ts` — merge all resolver outputs; compute `feedVersion` SHA-256 of `(contentVersion + sellingPrice + sellableQuantity + isAvailable)`; if matches last dispatched version → set `syncStatus: skipped`, skip dispatch
- [ ] T043 [US5] Create `src/pipeline/step9-dispatch.ts` — `POST {dispatchEndpoint}` with `ProductFeed` payload (contract from `specs/001-vtex-product-feed-mcp/contracts/connector-api.md`); set `syncStatus: in_flight` before call; handle `DispatchResult.status: retry | error | success`; exponential backoff: 1s, 5s, 30s, 5min, 30min
- [ ] T044 [US5] Create `src/pipeline/step10-state-write.ts` — write `FeedState` to DynamoDB; write `SyncEvent` with TTL = 90d; write Bridge document via `vtex-bridge` client; emit `feed.sync.*` metrics
- [ ] T045 [US5] Create `src/pipeline/errors.ts` — `RetryableError`, `PipelineHaltError`, `MaxRetriesExhaustedError` with structured fields for issue creation
- [ ] T046 [US5] Create `src/pipeline/orchestrator.ts` — compose steps 1–10 in sequence; catch `PipelineHaltError` (write issue, ack message, no retry); catch `RetryableError` (re-enqueue with backoff); catch `MaxRetriesExhaustedError` (move to DLQ, write `SYNC_EXHAUSTED` issue)
- [ ] T047 [US5] Create `src/sqs/consumer.ts` — SQS long-poll consumer loop; receive messages from all active channel queues; call `orchestrator.run(event)`; ack on success or halt; nack/visibility-timeout on retry
- [ ] T048 [US5] Wire `sqs/consumer.ts` startup into `src/index.ts`; start consumer alongside Express server

---

## Phase 6 — US2: `getProductFeedState` MCP Tool

**Story goal:** An operator or agent calls `getProductFeedState` and receives the full canonical feed state with freshness indicators.

**Independent test:** Call `tools/call` with `getProductFeedState` for a known `(skuId, channelId, accountName)` → response includes `productFeed`, `dataFreshness.isStale`, and `priceAgeSeconds`; call for unknown key → structured `404` error response with `isError: true`.

- [ ] T049 [US2] Create `src/mcp/server.ts` — initialise `@modelcontextprotocol/sdk` MCP server with Streamable HTTP transport; bind to `MCP_PORT`; apply VTEX token auth via `vtex-auth` middleware on all requests
- [ ] T050 [US2] Create `src/mcp/tools/get-product-feed-state.ts` — input schema from `specs/001-vtex-product-feed-mcp/contracts/mcp-tools.md`; query `feed-state.repository.getByKey`; compute `dataFreshness` by comparing `priceResolvedAt`, `stockResolvedAt`, `contentResolvedAt` against `channelConfig.dedupTtlSeconds`; return `404` error if no record found
- [ ] T051 [US2] Register `getProductFeedState` tool in `src/mcp/server.ts`
- [ ] T052 [US2] Wire MCP server startup into `src/index.ts`

---

## Phase 7 — US3: `listProductFeedIssues` MCP Tool

**Story goal:** A monitoring tool calls `listProductFeedIssues` and receives a paginated list of open issues, filterable by severity and type.

**Independent test:** Seed 150 open `DISPATCH_ERROR` issues for `channelId: test-channel`; call `listProductFeedIssues` with `limit: 20` → `issues.length = 20`, `nextCursor` present; follow cursor → next 20 returned; `severity: "error"` filter excludes warnings; calling with `skuId` filter returns only that SKU's issues.

- [ ] T053 [US3] Create `src/mcp/tools/list-product-feed-issues.ts` — input schema from `contracts/mcp-tools.md`; query GSI-1 via `offer-issue.repository.listByChannel` with optional `severity`+`issueType` SK prefix filter and `skuId` attribute filter; add `FilterExpression: #ttl > :now` guard; return cursor-based pagination via `nextCursor`
- [ ] T054 [US3] Register `listProductFeedIssues` tool in `src/mcp/server.ts`

---

## Phase 8 — US6: Mapping Gateway and VTEX Mapper Webhook

**Story goal:** A SKU without a category mapping is blocked in the pipeline and surfaced as a `MISSING_MAPPING` issue; when the operator completes the mapping in VTEX Mapper, the platform invalidates the cache and re-queues the SKU.

**Independent test:** Process an event for a SKU whose VTEX category has no Mapping Cache entry → `FeedState.syncStatus` is not `synced`; `OfferIssue` with `issueType: MISSING_MAPPING` exists; POST a Mapper webhook delivery for that category → cache updated → re-queue triggered → SKU proceeds through pipeline.

- [ ] T055 [P] [US6] Create `src/mapper/mapper-webhook.handler.ts` — receive `POST /internal/mapper/webhook/:channelId`; parse mapping payload (contract from `specs/001-vtex-product-feed-mcp/vtex-product-feed-mcp-platform-spec.md` Section 4.2); update `mapping-cache` for each `vtexCategoryId`; invalidate affected `FeedState` records; re-queue SKUs with open `MISSING_MAPPING` issues
- [ ] T056 [US6] Create `src/mapper/mapper-webhook.router.ts` — `POST /internal/mapper/webhook/:channelId`; apply `vtex-auth` middleware
- [ ] T057 [US6] Update `src/pipeline/step4-mapping.ts` — on cache miss, check for existing open `MISSING_MAPPING` issue; deduplicate issue creation (do not create duplicate open issues for same `(skuId, channelId)`)
- [ ] T058 [US6] Create `src/mcp/tools/get-marketplace-mapping-status.ts` — input schema from `contracts/mcp-tools.md`; read from `mapping-cache`; return `mappingStatus`, `categoryMapping`, `attributeMapping[]`, `missingMappings[]`
- [ ] T059 [US6] Register `getMarketplaceMappingStatus` tool in `src/mcp/server.ts`
- [ ] T060 [US6] Wire `mapper-webhook.router.ts` into `src/app.ts`

---

## Phase 9 — US1: `explainOfferAvailability` MCP Tool

**Story goal:** A support agent calls `explainOfferAvailability` and receives a structured breakdown explaining exactly why a SKU is or is not available on a channel.

**Independent test:** For a SKU with `syncStatus: synced` and `isAvailable: false, unavailableReason: ZERO_STOCK` → response shows `inventoryEligibility.pass: false` with detail containing the minimum stock threshold value; `lastSimulationParams` populated with `country` and `postalCode`.

- [ ] T061 [US1] Create `src/mcp/tools/explain-offer-availability.ts` — input schema from `contracts/mcp-tools.md`; query `FeedState`; build structured `breakdown` from stored eligibility fields; populate `lastSimulationParams` from `FeedState.simulationCountry` / `simulationPostalCode`; generate human-readable `detail` string for each eligibility check
- [ ] T062 [US1] Register `explainOfferAvailability` tool in `src/mcp/server.ts`

---

## Phase 10 — US7: `retryFeedSync` Action Tool

**Story goal:** A support agent triggers a manual re-sync for a single SKU; the platform enqueues it and returns an idempotency key.

**Independent test:** Call `retryFeedSync` for `(skuId, channelId)` → `enqueued: true`; call again within 60 seconds → `enqueued: false, reason: "rate_limited"`; call when sync is already `in_flight` → `enqueued: false, reason: "already_in_flight"`.

- [ ] T063 [US7] Create `src/mcp/tools/retry-feed-sync.ts` — input schema from `contracts/mcp-tools.md`; enforce rate limit using Redis `SET NX` with 60s TTL on key `retry-rate:{accountName}:{channelId}:{skuId}`; check `FeedState.syncStatus` for `in_flight`; enqueue to appropriate SQS queue; return `enqueued`, `idempotencyKey`, `estimatedProcessingMs`, `reason`
- [ ] T064 [US7] Register `retryFeedSync` tool in `src/mcp/server.ts`

---

## Phase 11 — Remaining Read Tools

**Goal:** Complete the full MCP tool surface area for cross-channel comparison and history.

- [ ] T065 [P] Create `src/mcp/tools/compare-feed-state-across-channels.ts` — input schema from `contracts/mcp-tools.md`; query GSI-2 (`ACCT#{accountName}#SKU#{skuId}`) to get all active channel states; return `rows[]` with price, stock, availability, syncStatus, openIssueCount per channel
- [ ] T066 [P] Create `src/mcp/tools/get-feed-sync-history.ts` — input schema from `contracts/mcp-tools.md`; query `SyncEvent` records from `sync-event.repository`; apply `since` ISO 8601 filter via SK range; cursor pagination
- [ ] T067 [P] Create `src/mcp/tools/simulate-product-feed.ts` — run full pipeline steps 1–8 with optional `overrides` (country, postalCode, minimumStock) applied to a cloned channel config; never write to Feed State Store; always return `isHypothetical: true`
- [ ] T068 Register `compareFeedStateAcrossChannels`, `getFeedSyncHistory`, `simulateProductFeed` tools in `src/mcp/server.ts`

---

## Phase 12 — Polish and Cross-Cutting Concerns

**Goal:** Health endpoints, structured logging, metrics, `StockAdjustmentHook`, graceful shutdown.

- [ ] T069 Create `GET /health` endpoint in `src/app.ts` — return `{ status: "ok", uptime: N }` with `200`; used by load balancers and connector health checks
- [ ] T070 [P] Create `src/observability/metrics.ts` — counters for `feed.sync.total`, `feed.sync.success`, `feed.sync.error`, `feed.sync.skipped`; histograms for `feed.simulation.latency_ms`, `feed.dispatch.latency_ms`; gauge for `feed.queue.depth` (spec FR-039)
- [ ] T071 [P] Create `src/observability/logger.ts` — structured JSON logger (e.g. `pino`); include `accountName`, `channelId`, `skuId`, `traceId` in all pipeline log lines
- [ ] T072 Create `src/pipeline/stock-adjustment-hook.ts` — if `channelConfig.stockAdjustmentHookEndpoint` present, call connector's `/config/stock-adjustment-hook` during Step 6; cap `adjustedStock` at `rawSimulatedStock`; validate response (spec FR-015)
- [ ] T073 [P] Add `SIMULATION_ERROR` OfferIssue creation to `step5-price.ts` — after max retries exhausted on simulation API failure (spec FR-013 clarification)
- [ ] T074 [P] Add `TTL guard` to all DynamoDB reads in `offer-issue.ts` and `sync-event.ts` — `FilterExpression: #ttl > :now` on queries that touch expiry-sensitive records
- [ ] T075 Implement graceful shutdown in `src/index.ts` — on `SIGTERM`: stop accepting new SQS messages, drain in-flight pipeline tasks, close DynamoDB/Redis connections, exit `0`
- [ ] T076 [P] Create `scripts/db-seed.ts` — seed one test `ChannelConfig`, one `FeedState` record, and 5 `OfferIssue` records for local dev and integration tests
- [ ] T077 [P] Add `MCP-Session-Id` session management to `src/mcp/server.ts` — generate cryptographically secure session IDs at initialization; require in subsequent requests; include SSE event IDs for reconnection resumability
- [ ] T078 Add `Origin` header validation to MCP server — reject requests with unexpected origins; bind to `localhost` in development (spec research.md Decision 1 security caveat)
- [ ] T079 [P] Create `src/channels/channel-config.router.ts` health guard — `GET /channels/:channelId/health` proxies to `connector.dispatchEndpoint/health`; used by platform before dispatch
- [ ] T080 Add `X-Platform-Signature` HMAC-SHA256 signing to `step9-dispatch.ts` — sign dispatch request body with connector secret; connector can verify authenticity (contract `connector-api.md`)

---

## Dependencies (Story Completion Order)

```
Phase 1 (Setup)
  └── Phase 2 (Foundational Infrastructure)
        ├── Phase 3 (US4: Channel Config)
        │     └── Phase 4 (US5-A: Broadcaster Ingestion)
        │           └── Phase 5 (US5-B: Feed Orchestrator)
        │                 ├── Phase 6 (US2: getProductFeedState)
        │                 ├── Phase 7 (US3: listProductFeedIssues)
        │                 ├── Phase 8 (US6: Mapping Gateway)
        │                 │     └── Phase 9 (US1: explainOfferAvailability)
        │                 └── Phase 10 (US7: retryFeedSync)
        │
        Phase 11 (Remaining Read Tools — parallel after Phase 6)
        Phase 12 (Polish — parallel after Phase 5)
```

---

## Parallel Execution Opportunities

| Session | Tasks runnable in parallel (different files, no shared state) |
|---------|---------------------------------------------------------------|
| Phase 2 setup | T007, T008, T015, T016, T017, T018, T019, T020 — all independent infrastructure files |
| Phase 5 pipeline | T035–T044 — each step is a separate file; steps 3, 4, 5, 6, 7 have no shared write targets |
| Phase 11 | T065, T066, T067 — independent tool files |
| Phase 12 | T070, T071, T074, T076, T077 — all cross-cutting, independent files |

---

## MVP Scope (Phase 1 only)

To ship the minimum viable platform with the two MVP MCP tools:

**Complete:** T001–T054 (Phases 1–7)

This delivers:
- Channel registration and validation (US4)
- Broadcaster ingestion + dedup (US5-A)
- Full 10-step pipeline with dispatch (US5-B)
- `getProductFeedState` MCP tool (US2)
- `listProductFeedIssues` MCP tool (US3)

**Deferred to Phase 2+:** T055–T080 (Mapping Gateway, remaining tools, polish)

---

## Summary

| Phase | Tasks | User Story | Notes |
|-------|-------|------------|-------|
| 1 — Setup | T001–T010 | — | 10 tasks |
| 2 — Foundational | T011–T023 | — | 13 tasks |
| 3 — Channel Config | T024–T029 | US4 | 6 tasks |
| 4 — Broadcaster Ingestion | T030–T034 | US5-A | 5 tasks |
| 5 — Feed Orchestrator | T035–T048 | US5-B | 14 tasks |
| 6 — getProductFeedState | T049–T052 | US2 | 4 tasks |
| 7 — listProductFeedIssues | T053–T054 | US3 | 2 tasks |
| 8 — Mapping Gateway | T055–T060 | US6 | 6 tasks |
| 9 — explainOfferAvailability | T061–T062 | US1 | 2 tasks |
| 10 — retryFeedSync | T063–T064 | US7 | 2 tasks |
| 11 — Remaining Read Tools | T065–T068 | — | 4 tasks |
| 12 — Polish | T069–T080 | — | 12 tasks |
| **Total** | **T001–T080** | | **80 tasks** |
