# Phase 0 Research — VTEX Product Feed MCP

**Date:** 2026-05-07
**Feature:** specs/001-vtex-product-feed-mcp

---

## Decision 1: MCP Server SDK and Transport

### Decision
Use the official **TypeScript MCP SDK** (`@modelcontextprotocol/sdk`) with **Streamable HTTP transport** (HTTP + Server-Sent Events).

### Rationale
- The project already has a `package.json` / `manifest.json` — TypeScript is the native fit.
- Streamable HTTP allows a single server process to serve multiple concurrent callers (agents, dashboards, support tools) via HTTP POST + SSE. Stdio requires spawning one process per client and is only suitable for local CLI tooling.
- Session management via `MCP-Session-Id` headers and SSE event IDs provide built-in reconnection resilience.

### Alternatives considered
- **Python SDK** — Tier 1 supported but mismatched to the Node.js ecosystem.
- **stdio transport** — Simpler to start but fundamentally single-client; not suitable for production multi-caller use.

### Key implementation caveats
- Validate `Origin` headers on every request; bind to `localhost` only in development.
- Assign cryptographically secure session IDs at initialization.
- Include SSE event IDs so clients can resume after disconnection.
- All tool inputs must be validated server-side; return structured errors (with `isError: true`) so callers can self-correct.
- MCP does not broadcast — each server message routes to one connected stream.

### Tool schema pattern
Tools are defined with JSON Schema `inputSchema` and `outputSchema`. The SDK handles validation. Tool results support `text`, `image`, `audio`, `resource`, and structured JSON content types.

---

## Decision 2: Feed State Store Technology

### Decision
**DynamoDB — single table design.**

### Rationale
All four access patterns are efficiently served:
1. **Point lookup** `(accountName, channelId, skuId)` → direct `GetItem`, P95 < 10ms, well within the 200ms SLA.
2. **Sync history range scan** → `Query` on main table SK prefix `SYNC#`, ISO 8601 timestamp in SK gives lexicographic ordering without a GSI.
3. **Issue list (100k+, paginated)** → GSI-1 with cursor-based pagination; partition sharding if per-channel write volume is extreme.
4. **Cross-channel comparison** → GSI-2 sparse index keyed by `(accountName, skuId)`.

DynamoDB TTL natively handles the 90-day sync history and 30-day resolved issue retention requirements with no application-level cleanup jobs.

Tenant isolation (per `accountName`) is enforced at the partition level — no cross-tenant leakage at the application layer.

### Table design

**Main table**

| Key | Pattern |
|-----|---------|
| PK | `ACCT#{accountName}#CHAN#{channelId}` |
| SK | `SKU#{skuId}` (current feed state) |
| SK | `SYNC#{iso8601}#{skuId}` (sync history, TTL = 90d) |
| SK | `ISSUE#{issueId}` (open issues, TTL = 30d after resolution) |

**GSI-1 — Issue queries**

| Key | Pattern |
|-----|---------|
| PK | `ACCT#{accountName}#CHAN#{channelId}#ISSUES` |
| SK | `{severity}#{issueType}#{issueId}` |

Supports filtering by `severity` and `issueType` via SK prefix. Cursor-based pagination with `LastEvaluatedKey`.

**GSI-2 — Cross-channel comparison**

| Key | Pattern |
|-----|---------|
| PK | `ACCT#{accountName}#SKU#{skuId}` |
| SK | `CHAN#{channelId}` |

Sparse — current-state records only, not history or issues. Single `Query` returns all channels for a SKU.

### Alternatives considered
- **PostgreSQL** — Strong consistency, flexible queries; higher operational overhead, vertical scaling pressure at extreme event throughput.
- **MySQL** — Already in use by some connectors (MagazineLuiza, Shopee) but poor fit for unbounded horizontal scale.
- **S3** — Used by MercadoLivre and ViaVarejo for SKU maps; unsuitable for low-latency point reads.

### Key caveats
- DynamoDB TTL deletion is eventual (up to 48h lag). Add `FilterExpression: #ttl > :now` guard to all queries over expiry-sensitive records.
- `Query` returns max 1 MB per call; always check `LastEvaluatedKey`, never item count, to detect end-of-page.
- Hot-partition risk on GSI-1 if a single channel generates extreme issue write volume; mitigate with shard suffix on the GSI PK and scatter-gather reads.

---

## Decision 3: Redis Usage Scope

### Decision
Redis serves two purposes:
1. **Deduplication** — `SET NX` per `(accountName, skuId, eventType)` with per-channel TTL from `channelConfig.dedupTtlSeconds`. Key pattern: `dedup:{accountName}:{skuId}:{eventType}`.
2. **Mapping Cache** — Hash per `(accountName, channelId)` storing `vtexCategoryId → channelCategoryId` and `vtexSpecValue → channelAttrValue` mappings. TTL = 1 hour, refreshed on each Mapper webhook delivery.

### Rationale
Both use cases are purely ephemeral — loss is acceptable. Redis is already present in all five existing connectors. No new infrastructure is needed.

---

## Decision 4: VTEX Broadcaster Subscription and Reliability

### Decision
Subscribe to VTEX Broadcaster via webhook registration for each `accountName`. Route events to SQS queues immediately upon receipt; do not process inline.

### Key risk (Open Question 3 — unresolved)
The observed event loss rate and maximum delivery lag for VTEX Broadcaster have not been measured. The platform **must** implement a periodic full-reconciliation scan (comparable to existing CompareAll jobs) to detect and recover drift. Cadence to be determined after baseline measurement from existing connectors.

---

## Decision 5: VTEX Checkout Simulation for Non-BR Accounts

### Decision
This remains **Open Question 1** — not yet validated in production. The platform spec requires validation before Phase 0 completes (calling simulation with non-BRL `country` + `postalCode` and confirming the currency in the response matches `channelConfig.currency`).

**Validation plan:** Call `POST /api/checkout/pub/orderForms/simulation` for 3 non-BR test accounts (one US, one EU, one Asia-Pacific) with correct country codes and postal codes. Verify: (a) response currency matches expected; (b) `sellingPrice` is non-zero and reasonable; (c) `logisticsInfo` contains delivery channel data.

---

## Resolved Unknowns Summary

| Unknown | Resolution |
|---------|-----------|
| MCP SDK and transport | TypeScript SDK, Streamable HTTP |
| Feed State Store technology | DynamoDB single-table |
| Redis usage scope | Dedup (SET NX) + Mapping Cache |
| VTEX Broadcaster reliability | Unresolved — requires measurement (Open Question 3) |
| Non-BR Checkout simulation behavior | Unresolved — requires validation test (Open Question 1) |
