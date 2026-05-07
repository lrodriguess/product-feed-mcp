# Feature Specification: VTEX Product Feed MCP

**Version:** 0.1 (draft)
**Status:** Draft
**Feature Directory:** specs/001-vtex-product-feed-mcp

---

## Summary

The VTEX Product Feed MCP is a Model Context Protocol server that acts as the canonical product feed protocol between VTEX and any marketplace or channel connector. It consumes VTEX Broadcaster events, resolves price and inventory via VTEX Checkout simulation, maintains feed state, and dispatches canonical product objects to registered connectors — while exposing a set of stateless MCP tools that allow agents, dashboards, and support tools to query feed state and explain offer availability without interacting with queues or VTEX APIs directly.

---

## Problem Statement

Today, each VTEX marketplace connector independently implements price resolution, inventory resolution, availability calculation, deduplication, and observability. This creates five variants of the same logic, all with a critical shared bug: the postal code used for simulation is hardcoded to São Paulo (`04538132`) regardless of the account's country. Each connector also uses the VTEX Fulfillment simulation API with `seller: "1"`, which excludes multi-seller and franchise configurations.

There is no shared feed state that can answer the question "what did connector X last send to the marketplace for SKU Y?" without querying each connector individually. Support agents and automation tools have no standard interface to inspect feed state, diagnose availability issues, or trigger re-syncs.

This feature builds the platform layer and MCP interface that eliminates this duplication and provides a single source of truth for all product feed operations.

---

## Goals

- Provide a single, channel-agnostic pipeline for resolving and dispatching product feed data from VTEX to any registered connector.
- Replace the hardcoded postal code bug with a mandatory, per-channel `representativePostalCode` + `country` configuration.
- Replace Fulfillment simulation with Checkout simulation as the canonical source of price and inventory truth.
- Expose a Feed State Store that records every dispatch outcome and is queryable without per-connector knowledge.
- Expose an MCP tool interface that allows external applications (agents, dashboards, support tools) to query feed state, explain offer availability, and trigger re-syncs without knowing about queues, simulation, or sync cycles.
- Allow connectors to focus exclusively on marketplace-specific payload transformation and API calls.

## Non-Goals

- This specification does not cover the implementation of any specific marketplace connector (Amazon, MercadoLivre, MagazineLuiza, Shopee, ViaVarejo). Connectors implement the `ConnectorAdapter` interface; their internal logic is out of scope.
- This specification does not cover the migration of existing connectors to the new platform. Migration is a separate initiative.
- This specification does not define the VTEX Mapper attribute schema for any channel. Mapper configuration is owned by channel operators.
- This specification does not cover consumer-facing storefront features.

---

## User Scenarios & Testing

### Scenario 1: Support agent diagnoses why a SKU is unavailable on a marketplace

**Actor:** Support agent using an agent tool backed by the MCP server
**Goal:** Understand why SKU `1001` is not listed on channel `amazon-br`
**Steps:**
1. Agent calls `explainOfferAvailability` with `skuId: "1001"`, `channelId: "amazon-br"`, `accountName: "mystore"`
2. Platform queries Feed State Store and returns a structured breakdown
3. Response shows `inventoryEligibility: false` with detail `"sellableQuantity = 0 after minimum stock threshold (5)"`
**Expected outcome:** Agent receives a human-readable explanation identifying the root cause without accessing VTEX or the connector directly.

---

### Scenario 2: Operator confirms the last synced price for a SKU

**Actor:** Channel operator or automated monitoring tool
**Goal:** Confirm what price was last dispatched to a channel for a specific SKU
**Steps:**
1. Caller invokes `getProductFeedState` with `skuId`, `channelId`, `accountName`
2. Platform returns the full `ProductFeed` snapshot stored in the Feed State Store
3. Response includes `sellingPrice`, `currency`, `lastSyncAt`, `isStale` indicator
**Expected outcome:** Caller sees the exact price and stock that were dispatched, and whether the data is stale relative to the channel's configured TTL.

---

### Scenario 3: Platform operator lists all open feed issues for a channel

**Actor:** Platform monitoring tool or on-call engineer
**Goal:** Identify all SKUs with dispatch errors or missing mappings on `shopee-br`
**Steps:**
1. Caller invokes `listProductFeedIssues` with `channelId: "shopee-br"`, `severity: "error"`, `limit: 100`, `offset: 0`
2. Platform returns paginated list of `OfferIssue` records
3. Each record contains `skuId`, `issueType`, `description`, `createdAt`
**Expected outcome:** Caller receives all open error-level issues for the channel, paginated correctly.

---

### Scenario 4: A new channel is onboarded and begins receiving product feed events

**Actor:** Platform administrator
**Goal:** Register a new channel `my-connector-us` and have it start receiving product feed dispatches
**Steps:**
1. Admin submits a channel configuration with `channelId`, `salesChannel`, `tradePolicy`, `country: "USA"`, `representativePostalCode: "10001"`, `minimumStock`, `dedupTtlSeconds`, and connector `dispatchEndpoint`
2. Platform validates all required fields; rejects if any are missing
3. Platform activates the channel; subsequent Broadcaster events for the account are routed through the 10-step pipeline and dispatched to the connector's endpoint
**Expected outcome:** The channel is active within one registration call; the first qualifying Broadcaster event triggers the full pipeline and results in a dispatch to the connector.

---

### Scenario 5: A connector receives a product feed dispatch and returns a result

**Actor:** Connector adapter service
**Goal:** Receive a canonical `ProductFeed` object, transform it into a marketplace payload, and confirm the result
**Steps:**
1. Platform POSTs a `ProductFeed` dispatch to `{connector.dispatchEndpoint}`
2. Connector uses the pre-resolved `mapping` section to build the marketplace-specific payload
3. Connector calls the marketplace API and returns `DispatchResult` with `status: "success"` and `externalOfferId`
4. Platform writes `syncStatus: "synced"` and `lastSuccessfulSyncAt` to the Feed State Store
**Expected outcome:** Connector only transforms and calls the marketplace API; it does not call VTEX APIs or recompute availability.

---

### Scenario 6: A SKU with a missing category mapping is blocked and surfaced as an issue

**Actor:** Feed pipeline (automated)
**Goal:** Prevent a SKU without a mapped channel category from being dispatched with incorrect data
**Steps:**
1. Broadcaster event triggers pipeline for SKU `2002` on channel `magazineluiza-br`
2. Step 4 (Category & Attribute Mapping) finds no entry in the Mapping Cache for the SKU's VTEX category
3. Platform halts the pipeline and creates an `OfferIssue` with `issueType: "MISSING_MAPPING"`, `severity: "error"`
4. Issue is queryable via `listProductFeedIssues`
**Expected outcome:** No dispatch occurs; issue is surfaced for the operator to resolve in VTEX Mapper.

---

### Scenario 7: A manual re-sync is triggered for a single SKU

**Actor:** Support agent or automation script
**Goal:** Force a fresh sync for SKU `1001` on channel `amazon-br` after a mapping issue is resolved
**Steps:**
1. Caller invokes `retryFeedSync` with `skuId: "1001"`, `channelId: "amazon-br"`, `syncType: "full"`
2. Platform checks rate limit (max 1 manual retry per key per 60 seconds); enqueues if within limit
3. Returns `enqueued: true`, `estimatedProcessingMs`, `idempotencyKey`
**Expected outcome:** SKU is re-processed through the full pipeline; result is written to Feed State Store.

---

## Functional Requirements

### Channel Registration and Configuration

- **FR-001:** A channel registration must include all required fields: `channelId`, `connectorType`, `accountName`, `salesChannel`, `tradePolicy`, `country` (ISO 3166-1 alpha-3), `representativePostalCode`, `currency`, `dedupTtlSeconds` (per event type), `minimumStock`, `active`. Registrations with missing required fields must be rejected.
- **FR-002:** `country` and `representativePostalCode` must be stored and used in every simulation call for the channel. No system-wide default postal code exists.
- **FR-003:** A channel with `active: false` must not receive events or dispatches.

### Broadcaster Event Ingestion

- **FR-004:** The platform must subscribe to VTEX Broadcaster webhooks and route incoming events by event type to separate SQS queues: `catalog`, `price`, `stock`.
- **FR-005:** Queue naming must follow the convention `vtex-feed-{accountName}-{eventType}`.
- **FR-006:** Each queue must have a paired Dead Letter Queue. Messages exceeding the retry threshold must be moved to the DLQ and generate an `OfferIssue` with `issueType: SYNC_EXHAUSTED`.
- **FR-007:** Deduplication must be applied per `(accountName, skuId, eventType)` using the channel's configured `dedupTtlSeconds` for that event type. No system default TTL exists.

### Feed Orchestration Pipeline (10 Steps)

- **FR-008:** The platform must execute all 10 pipeline steps in order for every triggered event: Eligibility Gate → SKU Enrichment → Content Normalization → Category & Attribute Mapping → Price Resolution → Inventory Resolution → Availability Calculation → ProductFeed Assembly → Connector Dispatch → Feed State Write.
- **FR-009 (Step 1 — Eligibility):** Base eligibility must be enforced: `IsActive = true AND SalesChannels contains channelConfig.salesChannel AND IsProductActive = true`. An ineligible SKU must exit the pipeline silently (no issue, no dispatch).
- **FR-010 (Step 2 — Enrichment):** The platform must fetch full SKU and product data from the VTEX Catalog API and cache the result per `(accountName, skuId)` with a TTL equal to the channel's `catalog` dedup TTL.
- **FR-011 (Step 3 — Normalization):** The platform must strip HTML from `ProductDescription`, extract EAN from `AlternateIds`, normalize dimensions from both `Dimension` and `RealDimension`, select the main image, and compute a `contentVersion` hash.
- **FR-012 (Step 4 — Mapping):** The platform must resolve `(vtexCategoryId → channelCategoryId)` and `(vtexSpecValue → channelAttrValue)` from the Mapping Cache. A SKU with no channel category mapping must halt the pipeline and generate a `MISSING_MAPPING` issue.
- **FR-013 (Step 5 & 6 — Price and Inventory):** The platform must call the VTEX Checkout simulation API (`POST /api/checkout/pub/orderForms/simulation`) with the channel's `country`, `representativePostalCode`, and `salesChannel`. The `seller` field must be omitted. Price and inventory must be extracted from the same response. If the simulation API returns an error or is unavailable, the platform must halt the pipeline, re-queue the event using the same exponential backoff schedule as FR-018, and generate a `SIMULATION_ERROR` OfferIssue after max retries are exhausted. Stale cached simulation results must not be used as a fallback.
- **FR-014:** `sellingPrice = 0` must halt the pipeline and generate a `ZERO_PRICE` issue. A `listPrice < sellingPrice` must be normalized to `listPrice = sellingPrice`.
- **FR-015 (Step 6 — Inventory):** `sellableQuantity` must be set to `0` when `simulatedStock <= channelConfig.minimumStock`. Connectors may register a `StockAdjustmentHook` but cannot increase stock beyond the simulated value.
- **FR-016 (Step 7 — Availability):** `isAvailable` must be computed as: `catalogEligibility AND priceEligibility AND inventoryEligibility`. The platform must set `unavailableReason` to the appropriate enum value when `isAvailable = false`.
- **FR-017 (Step 8 — Assembly):** The platform must compute a `feedVersion` hash of content, price, inventory, and availability. If `feedVersion` matches the last dispatched version for `(skuId, channelId)`, dispatch must be skipped and `syncStatus: SKIPPED_NO_CHANGE` written.
- **FR-018 (Step 9 — Dispatch):** The platform must POST the `ProductFeed` to the connector's registered `dispatchEndpoint`. On `DispatchResult.retry`, the platform must re-enqueue with exponential backoff (1s, 5s, 30s, 5min, 30min). After `maxRetries`, move to DLQ and create `SYNC_EXHAUSTED` issue.
- **FR-019 (Step 10 — State Write):** After every dispatch attempt, the platform must write a `FeedStateEvent` to the Feed State Store and a Bridge document to VTEX Bridge using the standardized 7-field schema.

### Category and Attribute Mapping via VTEX Mapper

- **FR-020:** The platform must register a webhook endpoint with VTEX Mapper at startup to receive mapping updates.
- **FR-021:** On receiving a Mapper webhook delivery, the platform must update the Mapping Cache for `(accountName, channelId, vtexCategoryId)` and invalidate affected Feed State Store records.
- **FR-022:** The `mappingStatus` for each `(accountName, channelId, skuId)` must be tracked as `complete | partial | missing` and updated on every Mapper webhook delivery and pipeline evaluation.

### MCP Tools — Read Tools

- **FR-023 (`getProductFeedState`):** Must return the full canonical `ProductFeed` snapshot and `dataFreshness` (age in seconds per field, `isStale` flag) for a given `(skuId, channelId, accountName)`.
- **FR-024 (`listProductFeedIssues`):** Must return paginated open `OfferIssue` records for a channel, filterable by `issueType`, `severity`, and `skuId`. Must support at least 100k records with correct pagination.
- **FR-025 (`explainOfferAvailability`):** Must return `isAvailable`, `unavailableReason`, a structured breakdown of eligibility checks, and the last simulation parameters used.
- **FR-026 (`getMarketplaceMappingStatus`):** Must return `mappingStatus`, resolved category mapping, attribute mapping list, and any `missingMappings` for a `(skuId, channelId, accountName)`.
- **FR-027 (`compareFeedStateAcrossChannels`):** Must return feed state rows for all active channels for a given `(skuId, accountName)` in a single response.
- **FR-028 (`getFeedSyncHistory`):** Must return recent sync events for a `(skuId, channelId, accountName)` with retention of 90 days.
- **FR-029 (`simulateProductFeed`):** Must run the full pipeline with optionally overridden simulation parameters and return the result without persisting it. Must always return `isHypothetical: true`.

### MCP Tools — Action Tools

- **FR-030 (`retryFeedSync`):** Must enqueue a re-sync for one SKU on one channel. Must enforce a rate limit of 1 manual retry per `(skuId, channelId)` per 60 seconds. Must return `enqueued: false` if a sync is already in-flight for the key.

### Connector Interface

- **FR-031:** The connector must expose a `dispatchEndpoint` (POST), a `/health` endpoint (GET), and optionally a `/config/stock-adjustment-hook` endpoint.
- **FR-032:** The connector must not call VTEX Catalog, Pricing, Inventory, or Simulation APIs. It must consume only the `ProductFeed` and `connectorContext` provided in the dispatch payload.
- **FR-033:** The connector must not recompute `isAvailable` or `sellableQuantity`. It must consume the platform's computed values.
- **FR-034:** The connector must return `DispatchResult` with `status: "success" | "error" | "retry"`. It must not return `success` before the marketplace API call is confirmed.

### Feed State Store

- **FR-035:** The Feed State Store must be partitioned by `(accountName, channelId)` at the infrastructure level. Data must not be readable across tenant boundaries at the application level.
- **FR-035a:** The `syncStatus` field must follow this state machine: `pending` (event received, not yet processing) → `in_flight` (pipeline actively executing) → one of the terminal states: `synced` (dispatch confirmed), `skipped` (no change detected, dispatch not needed), `error` (dispatch failed, retries remaining), or `exhausted` (all retries consumed, message in DLQ). Transitions must only move forward; a record in `synced` or `exhausted` may be reset to `pending` only by a new incoming event or a manual `retryFeedSync` call.
- **FR-036:** Active feed state must be retained indefinitely. Sync history events must be retained for 90 days. Resolved `OfferIssue` records must be retained for 30 days after resolution.
- **FR-037:** Every resolved field must include a `resolvedAt` timestamp. `isStale` must be computed by comparing `resolvedAt` against the channel's configured TTL.

### Observability

- **FR-038:** All Bridge writes must use the standardized 7-field schema: `skuId`, `accountName`, `channelId`, `status` (`Success | Warning | Error`), `type` (`Catalog | Price | Stock | Availability`), `message`, `timestamp`.
- **FR-039:** The platform must emit the following metrics: `feed.sync.total`, `feed.sync.success`, `feed.sync.error`, `feed.sync.skipped`, `feed.simulation.latency_ms`, `feed.dispatch.latency_ms`, `feed.queue.depth` — each with the labels specified in the architecture document.

---

## Clarifications

### Session 2026-05-07

- Q: What is the platform availability target? → A: 99.5% monthly uptime (≤3.6h/month)
- Q: What happens when the VTEX Checkout simulation API is unavailable? → A: Halt pipeline, re-queue with exponential backoff; generate `SIMULATION_ERROR` OfferIssue after max retries exhausted
- Q: What is the complete `syncStatus` state machine? → A: `pending | in_flight | synced | skipped | error | exhausted` (full lifecycle including transient queue states)
- Q: What are the scale assumptions for SKU volume and event throughput? → A: No fixed threshold defined — scale varies significantly by season and account; actual numbers must be measured from existing integrations before Phase 1 infrastructure sizing
- Q: What authentication mechanism do MCP tools use in Phase 1–2? → A: VTEX Admin token (`VtexIdclientAutCookie` or `X-VTEX-API-AppKey/AppToken`), same as all other VTEX private APIs; per-role access model deferred to Phase 4

---

## Success Criteria

| Criterion | Metric | Target |
|-----------|--------|--------|
| Platform is available for event processing and MCP tool calls | Monthly uptime | ≥ 99.5% (≤ 3.6h downtime/month) |
| Support agents can identify why any SKU is unavailable on any channel | Time to identify root cause of an availability issue | Under 2 minutes using `explainOfferAvailability` |
| Feed state is readable without connector knowledge | `getProductFeedState` available for all registered channels | 100% of registered channels queryable |
| Simulation uses correct country and postal code | Channels with non-BR postal code return expected currency | 0 channels with hardcoded `04538132` in production |
| No unnecessary marketplace API calls | Dispatch skipped when feed has not changed | `SKIPPED_NO_CHANGE` rate ≥ 30% on price/stock event load |
| Feed state reads are fast enough for real-time support tools | `getProductFeedState` P95 response time | Under 200ms |
| Issues are surfaced and actionable | `listProductFeedIssues` query covers all channel issue types | 100% of `IssueType` enum values representable |
| Connectors are stateless regarding feed resolution | Connector codebase does not contain VTEX simulation or pricing calls | Verified by connector team audit |
| Manual re-sync does not cause blast radius | Rate limit enforced on `retryFeedSync` | 0 cases of more than 1 manual retry per key per 60 seconds |

---

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| `ChannelConfig` | Runtime registration for a connected channel | `channelId`, `accountName`, `salesChannel`, `country`, `representativePostalCode`, `minimumStock`, `dedupTtlSeconds`, `active` |
| `ProductFeed` | Canonical, versioned output object assembled per sync cycle | `identity`, `catalogContent`, `mapping`, `price`, `inventory`, `availability`, `feedState`, `connectorContext` |
| `FeedStateEvent` | Persisted record of one dispatch attempt | `accountName`, `channelId`, `skuId`, `syncStatus` (`pending \| in_flight \| synced \| skipped \| error \| exhausted`), `sellingPrice`, `sellableQuantity`, `isAvailable`, `feedVersion`, `lastSyncAt` |
| `OfferIssue` | Normalized record of a feed problem with severity and resolution tracking | `issueId`, `accountName`, `channelId`, `skuId`, `issueType`, `severity`, `description`, `createdAt`, `resolvedAt` |
| `MappingCache` | Cached resolution of VTEX Mapper output per channel | `accountName`, `channelId`, `vtexCategoryId → channelCategoryId`, `vtexSpecValue → channelAttrValue`, `mappingStatus` |
| `ConnectorAdapter` | External service implementing the dispatch contract | `dispatchEndpoint`, `healthEndpoint`, `stockAdjustmentHook (optional)` |
| `DispatchResult` | Response from a connector after processing a dispatch | `dispatchId`, `status`, `externalOfferId`, `errorCode`, `retryable` |

---

## Dependencies

- **VTEX Broadcaster:** Source of real-time catalog, price, and stock change events. Platform depends on Broadcaster reliability for consistency. Known risk: event loss rate and lag must be measured (see Open Questions).
- **VTEX Checkout Simulation API** (`POST /api/checkout/pub/orderForms/simulation`): Sole source of price and inventory truth. Platform depends on its availability and correctness.
- **VTEX Catalog API** (`GET /api/catalog_system/pvt/sku/stockkeepingunitbyid/{skuId}`): Source of enrichment data for Step 2.
- **VTEX Mapper** (`/api/mkp-category-mapper`): Source of truth for category and attribute mappings. Platform registers a webhook to receive mapping updates.
- **AWS SQS:** Queue infrastructure for event routing and retry management.
- **Redis:** Deduplication state and Mapping Cache.
- **Feed State Store (storage):** Persistent store for feed state and issue records. Technology is an implementation decision to be made by the platform team during Phase 1 infrastructure design. The store must support point lookups by `(accountName, channelId, skuId)`, range queries for sync history, and pagination for issue lists at 100k+ record scale.
- **Platform team ownership:** Organizational decision required before Phase 1 begins. No implementation should proceed without a named team owning the platform.

---

## Assumptions

- The VTEX Checkout simulation API returns the correct effective price and stock for any `(country, postalCode, salesChannel)` combination, including non-Brazilian accounts. This must be validated before Phase 1 begins (Open Question 1).
- For single-seller accounts, the Checkout simulation response is price- and stock-equivalent to the current Fulfillment simulation. This must be verified per connector before migration (Open Question 2).
- VTEX Broadcaster delivers events with sufficient reliability (< 0.1% loss rate over 24h) for the platform's consistency model. A full reconciliation scan (comparable to existing CompareAll jobs) is assumed to compensate for any losses (Open Question 3).
- No fixed SKU volume or event throughput threshold is assumed. The platform must be designed to scale horizontally. Actual peak numbers must be instrumented from existing integrations before Phase 1 infrastructure sizing (see Open Question 5 — simulation call volume measurement).
- Connectors will implement the `ConnectorAdapter` interface and migrate off direct VTEX API calls within the migration timeline. This spec does not define that timeline.
- The `minimumStock` threshold will be configured per channel. A threshold of `0` is valid (no zeroing).
- `dedupTtlSeconds` must be configured per event type per channel. There is no system-wide default.
- MCP tools in Phase 1–2 authenticate using VTEX Admin token (`VtexIdclientAutCookie` or `X-VTEX-API-AppKey/AppToken`), consistent with all other VTEX private APIs. Per-role access control (Store Admin, Support Agent, Connector Service Account) and audit logging for `retryFeedSync` are deferred to Phase 4.

---

## Open Questions

| # | Question | Blocks |
|---|----------|--------|
| 1 | Does the VTEX Checkout simulation called with a non-BRL `country` + `postalCode` return the expected currency and correct price for non-Brazilian channels? | Phase 0 completion and all non-BR channel registrations |
| 2 | For single-seller VTEX accounts, do Checkout simulation and Fulfillment simulation return identical price and stock values? | Connector migration to the new resolver (Phase 1) |
| 3 | What is the observed VTEX Broadcaster event loss rate and maximum delivery lag across active connectors? | SQS queue sizing and reconciliation cadence design (Phase 1) |
| 4 | Which team owns the platform (Feed State Store, Resolvers, MCP Interface) and what is their mandate to enforce the `ConnectorAdapter` contract across connector teams? | Phase 1 kickoff |
| 5 | What storage technology is intended for the shared Feed State Store? (Current connectors use SQL, MySQL, and S3 for state; a single technology must be chosen.) | Data model design and infrastructure provisioning (Phase 1) |
| 6 | Phase 1–2 auth: VTEX Admin token (resolved). Phase 4: which roles (Store Admin, Support Agent, Connector Service Account) can invoke which tools, and is an audit log required for `retryFeedSync`? | Phase 4 action tools; security review |
| 7 | What is the `ProductFeed` schema versioning contract? How are breaking changes communicated to connectors over the 24-month build timeline? | Phase 2 onwards |
