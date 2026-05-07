# VTEX Product Feed MCP — Specification & Implementation Plan

**Version:** 0.1 (draft)  
**Date:** 2026-05-07  
**Status:** In progress — architecture pivot from channel comparison to generic platform spec  
**Previous version:** `product-feed-architecture-comparison-report-2026-05-07.md`

---

## 1. Purpose and Scope

This document specifies the **VTEX Product Feed MCP** — a Model Context Protocol server that acts as the canonical product feed protocol between VTEX and any marketplace or channel connector.

The platform has two responsibilities:

1. **Internally:** consume VTEX Broadcaster events, manage AWS SQS queues, resolve price/inventory/availability via VTEX Checkout simulation, maintain feed state, and dispatch canonical `ProductFeed` objects to registered connectors.
2. **Externally:** expose a set of MCP tools that allow any external application — agents, support tools, dashboards, connector adapters — to query feed state, explain offer availability, and trigger sync operations. External callers are fully **stateless**: they have no knowledge of queues, simulation, or synchronization cycles.

The platform is channel-agnostic. A connector registers a channel configuration (country, postal code, sales channel, trade policy) and implements the `ConnectorAdapter` interface. The platform handles everything upstream.

---

## 2. Core Design Principles

1. **One canonical feed model, many marketplace payloads.** The platform resolves data once from VTEX. Each connector transforms it into a marketplace-specific payload independently.
2. **The platform owns all queues.** Broadcaster webhook events are received and processed entirely inside the platform via AWS SQS. Connectors and external callers never interact with queues directly.
3. **Checkout simulation is the canonical price and inventory source.** It is the only VTEX API that correctly models multi-seller, franchise, and white-label availability. The `seller` field is omitted from requests — VTEX resolves the winning seller from the trade policy.
4. **Country and representative postal code are required per-channel configuration.** There is no system-wide default. A channel without these values cannot have simulation executed.
5. **Separate static content from dynamic offer state.** Catalog content (title, images, attributes) changes infrequently. Price and stock change continuously. Different cache TTLs and pipelines apply to each.
6. **Availability is a computed business outcome.** `isAvailable` is derived from active status, stock, minimum stock threshold, and eligibility — not a raw stock number.
7. **Every offer state must be explainable.** Any MCP tool call must be able to reconstruct why an offer is in its current state.
8. **External callers are stateless.** An MCP client sends a tool call and receives a structured response. It has no subscription, no queue, no polling loop.

---

## 3. System Architecture

### 3.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MCP PLATFORM                                  │
│                                                                       │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │  Broadcaster         │    │  Feed Orchestrator               │   │
│  │  Event Ingestion     │───▶│  (per-event pipeline)            │   │
│  │  (SQS management)    │    └──────────┬───────────────────────┘   │
│  └──────────────────────┘               │                            │
│                                    ┌────▼──────────────────────┐    │
│  ┌───────────────────┐             │  Resolvers                │    │
│  │  Catalog Content  │◀────────────│  · Price (Checkout Sim)   │    │
│  │  Gateway          │             │  · Inventory              │    │
│  └───────────────────┘             │  · Availability           │    │
│  ┌───────────────────┐             │  · Logistics (optional)   │    │
│  │  Mapping Gateway  │◀────────────└────────────────────────────┘   │
│  └───────────────────┘                          │                    │
│                                    ┌────────────▼──────────────┐    │
│  ┌───────────────────┐             │  Canonical ProductFeed    │    │
│  │  Feed State Store │◀────────────│  (assembled, versioned)   │    │
│  └───────────────────┘             └────────────┬──────────────┘    │
│  ┌───────────────────┐                          │                    │
│  │  Observability &  │◀─────────────────────────┤                    │
│  │  Issue Layer      │                          │                    │
│  └───────────────────┘             ┌────────────▼──────────────┐    │
│                                    │  Connector Dispatch        │    │
│  ┌───────────────────┐             │  (to registered adapters) │    │
│  │  MCP Interface    │◀────────────└───────────────────────────┘    │
│  │  (tool server)    │                                               │
│  └─────────┬─────────┘                                               │
└────────────┼────────────────────────────────────────────────────────┘
             │  MCP tool calls (stateless)
             ▼
    External Applications
    (agents, dashboards, support tools, connector adapters)
```

### 3.2 External Caller Model

External applications interact with the platform exclusively through MCP tool calls. They:

- Do **not** subscribe to queues or events.
- Do **not** call VTEX APIs directly through this platform.
- Do **not** maintain any local state about sync cycles.
- Receive a structured response to each tool call and nothing more.

A connector adapter may itself be an MCP client: it calls `getProductFeedState` or subscribes to a platform-managed dispatch webhook to receive the canonical `ProductFeed` object, then transforms it into a marketplace payload and calls the marketplace API.

### 3.3 Queue Management Architecture

The platform manages all SQS infrastructure internally. External systems have no visibility into this layer.

```
VTEX Broadcaster webhook
        │
        ▼
┌───────────────────────────────────────────────────┐
│  Broadcaster Event Ingestion Service              │
│  · Validates webhook signature                    │
│  · Extracts: accountName, skuId, eventType        │
│  · Routes to the correct SQS queue               │
└────────────────────┬──────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ Catalog  │ │  Price   │ │  Stock   │
  │  Queue   │ │  Queue   │ │  Queue   │
  └────┬─────┘ └────┬─────┘ └────┬─────┘
       └────────────┴────────────┘
                    │
                    ▼
          Feed Orchestrator
          (per-event resolution pipeline)
```

**Queue naming convention:** `vtex-feed-{accountName}-{eventType}` (e.g., `vtex-feed-mystore-stock`).  
**Dead-letter queues:** each queue has a paired DLQ. Messages that exceed the retry threshold are moved to DLQ and generate an `OfferIssue` record with `issueType: SYNC_EXHAUSTED`.  
**Deduplication:** Redis SET NX per `(accountName, skuId, eventType)` with a per-channel-configurable TTL. The platform applies the registered TTL; there is no system-wide default.

---

## 4. Channel Configuration and Mapper Registration

A channel is onboarded in two steps: runtime configuration and VTEX Mapper registration. These are independent — runtime config controls simulation and queue behavior; the Mapper defines how VTEX catalog attributes translate into the channel's own schema.

### 4.1 Runtime Configuration

Every channel must register the following values before any synchronization can occur. Missing required fields cause the registration to be rejected.

```json
{
  "channelId":               "my-connector-us",
  "connectorType":           "marketplace",
  "accountName":             "mystore",
  "salesChannel":            2,
  "tradePolicy":             "2",
  "affiliateId":             "ABC",
  "country":                 "USA",
  "representativePostalCode": "10001",
  "currency":                "USD",
  "dedupTtlSeconds": {
    "catalog": 1800,
    "price":   3600,
    "stock":   300
  },
  "minimumStock": 5,
  "active":       true
}
```

| Field | Required | Description |
|---|---|---|
| `channelId` | ✅ | Unique identifier for this channel |
| `connectorType` | ✅ | `marketplace` \| `erp` \| `feed` |
| `accountName` | ✅ | VTEX account name |
| `salesChannel` | ✅ | VTEX sales channel / trade policy scope for simulation |
| `tradePolicy` | ✅ | VTEX trade policy ID |
| `affiliateId` | optional | Affiliate ID for affiliate-scoped pricing |
| `country` | ✅ | ISO 3166-1 alpha-3 country code (`"BRA"`, `"USA"`, `"DEU"`, …) |
| `representativePostalCode` | ✅ | Central postal code used in all simulation requests for this channel — must be valid in the declared country |
| `currency` | ✅ | Expected output currency; validated against simulation response |
| `dedupTtlSeconds` | ✅ | Per-event-type deduplication TTL; no system default |
| `minimumStock` | ✅ | Stock threshold below which `sellableQuantity` is zeroed |
| `active` | ✅ | Must be `true` for the channel to receive events |

> **No defaults, no fallbacks.** Every simulation call uses `country` and `representativePostalCode` from the channel config. A channel without valid values for these fields will not have simulation executed.

---

### 4.2 Attribute and Category Mapping via VTEX Mapper

The channel's **attribute and category schema is not declared in the platform** — it is defined in VTEX Mapper (`/api/mkp-category-mapper`). The Mapper is the source of truth for how VTEX catalog fields translate into the channel's own fields.

**The flow:**

```
1. Channel operator opens VTEX Admin → Mapper UI
   Uploads the channel's category tree to Mapper

2. VTEX Mapper processes the tree asynchronously
   Computes VTEX category ↔ channel category associations
   Sends the result to the platform's Mapper webhook endpoint

3. Platform stores the mapping in the Mapping Cache
   Key: (accountName, channelId, vtexCategoryId)
   TTL: 1 hour (refreshed on every new webhook delivery)

4. Channel operator completes attribute mapping in Mapper UI
   Maps: VTEX specification name → channel attribute name
           VTEX specification value → channel attribute value

5. Platform Mapping Gateway reads cached mappings at dispatch time
   Resolves categories and attributes for each SKU
   Includes the resolved mapping in the ProductFeed object (Section 7.3)

6. Connector adapter receives the ProductFeed with pre-resolved mappings
   Uses them to build the marketplace-specific payload
   Does not need to call Mapper or VTEX Catalog APIs itself
```

**Platform-side Mapper integration:**

The platform registers a webhook endpoint with VTEX Mapper at startup. When a channel operator updates mappings in the Mapper UI, Mapper POSTs the updated mapping set to the platform. The platform stores it in the Mapping Cache and invalidates affected Feed State Store records, triggering re-sync for SKUs whose mapped categories or attributes changed.

```
POST {platform}/internal/mapper/webhook/{channelId}
Body: {
  "mappings": [
    {
      "vtexCategoryId":      "15",
      "channelCategoryId":   "CAT-001",
      "channelCategoryName": "Electronics > Phones",
      "attributes": [
        {
          "vtexSpecName":    "Color",
          "channelAttrId":   "COLOR",
          "channelAttrName": "Cor",
          "valueMapping": [
            { "vtexValue": "Black", "channelValue": "Preto" }
          ]
        }
      ]
    }
  ]
}
```

**What the platform does with mapper data:**
- Resolves `(vtexCategoryId → channelCategoryId)` and `(vtexSpecValue → channelAttrValue)` for every SKU at dispatch time
- Populates the `mapping` section of the `ProductFeed` object (Section 7.3)
- Sets `mappingStatus: "complete" | "partial" | "missing"` per SKU
- Creates an `OfferIssue` of type `MISSING_MAPPING` and halts the pipeline for any SKU whose VTEX category has no mapped channel category

**What the connector does not need to do:**
- Declare attribute schemas, field constraints, or JSON schemas to the platform
- Call the Mapper API directly
- Maintain its own mapping cache

The connector receives a `ProductFeed` with the mapping already resolved. It applies the `mapping` section to construct its marketplace payload. If a required attribute has no mapped value, the platform has already flagged it as a `MISSING_MAPPING` issue before dispatch.

---

## 5. VTEX Product Feed Standard Process

This is the canonical 10-step pipeline executed by the Feed Orchestrator for every triggered event (incremental from Broadcaster, or full-scan).

```
Event trigger (Broadcaster or full-scan)
      │
      ▼
Step 1: Eligibility Gate ──── rejected ──▶ no-op
      │ eligible
      ▼
Step 2: SKU Enrichment ──────── failed ───▶ OfferIssue: CONTENT_FETCH_ERROR
      │
      ▼
Step 3: Content Normalization
      │
      ▼
Step 4: Category & Attribute Mapping ─── missing ─▶ OfferIssue: MISSING_MAPPING
      │ mapped
      ▼
Step 5: Price Resolution (Checkout Simulation)
      │
Step 6: Inventory Resolution (same simulation response)
      │
Step 7: Availability Calculation
      │
      ▼
Step 8: Canonical ProductFeed Assembly
      │
      ▼
Step 9: Connector Dispatch ──── error ───▶ OfferIssue: DISPATCH_ERROR + retry
      │ success
      ▼
Step 10: Feed State Write + Observability
```

---

### Step 1: Eligibility Gate

**Purpose:** Determine whether a SKU should enter the synchronization pipeline for this channel.

**Base eligibility (platform-enforced, all channels):**
```
IsActive = true
AND SalesChannels contains channelConfig.salesChannel
AND IsProductActive = true (when applicable)
```

**Extension point:** each connector may register an additional eligibility predicate. The platform applies it as an AND condition on top of the base gate. The platform never removes base eligibility checks; connectors may only add stricter conditions.

**Outputs:**
- `eligible: true` → proceed to Step 2
- `eligible: false` → pipeline ends, no-op (not an error, not logged as an issue)

---

### Step 2: SKU Enrichment

**Purpose:** Fetch the full SKU and product data from VTEX Catalog API.

**Primary call (platform-managed):**
```
GET /api/catalog_system/pvt/sku/stockkeepingunitbyid/{skuId}?an={accountName}
```

**Response fields used by the platform:**
- `Id`, `ProductId`, `ProductName`, `NameComplete`
- `IsActive`, `IsKit`
- `Images[]` (url, imageLabel, isMain)
- `Dimension`, `RealDimension` (height, width, length, weight)
- `AlternateIds` (EAN/GTIN)
- `SkuSpecifications[]` (variation attributes)
- `ProductSpecifications[]` (product-level attributes)
- `SalesChannels[]`

**Caching:** the platform caches SKU enrichment results per `(accountName, skuId)` with a TTL aligned to the channel's `catalog` dedup TTL. Cache is invalidated on `HasStockKeepingUnitModified` Broadcaster events.

**Connector extension:** connectors may declare additional VTEX catalog calls they require (e.g., brand details, category tree, parent product). The platform executes these and includes results in the `ConnectorContext` passed at dispatch.

---

### Step 3: Content Normalization

**Purpose:** Produce a clean, validated `CatalogContent` object from the raw VTEX SKU response.

**Platform-applied transformations (all channels):**
- Strip HTML tags from `ProductDescription`
- Extract EAN from `AlternateIds.Ean` or `AlternateIds.RefId`
- Normalize dimensions: extract from `Dimension` (package) and `RealDimension` (real), preserve both
- Select main image: first image where `isMain = true`, or first image if none flagged
- Derive `contentVersion`: SHA-256 hash of the normalized content fields — used for change detection

**Connector responsibility for content rules:** the platform normalizes VTEX content into the canonical form. Field-level constraints (character limits, required fields, format rules) are specific to the channel's marketplace schema — the connector applies them when transforming the canonical `CatalogContent` into the marketplace payload. If the connector determines that a required field is missing or violates a constraint, it returns `DispatchResult.status: "error"` with an `errorCode` that the platform records as an `OfferIssue` of type `CONTENT_VIOLATION`.

---

### Step 4: Category and Attribute Mapping

**Purpose:** Resolve VTEX categories and specifications to the channel's own attribute and category schema, as defined by the channel operator in VTEX Mapper.

**Source of truth:** VTEX Mapper (`/api/mkp-category-mapper`). The channel operator configures all mappings in the Mapper UI — there is no JSON schema or attribute contract declared to the platform. The platform receives mapping updates via a Mapper webhook (Section 4.2) and caches them internally.

**Mapping resolution at dispatch time:**
```
vtexCategoryId    → channelCategoryId      (from Mapping Cache)
vtexSpecName      → channelAttrId          (from Mapping Cache)
vtexSpecValue     → channelAttrValue       (from Mapping Cache value map)
```

**Missing mapping behavior:** if the Mapping Cache contains no entry for a SKU's VTEX category, the platform writes an `OfferIssue` of type `MISSING_MAPPING` and **halts the pipeline for this SKU**. This is a blocking condition — there is no fallback category. The issue is surfaced via `listProductFeedIssues` and `getMarketplaceMappingStatus` so the channel operator can complete the mapping in the Mapper UI.

**Mapping status:** tracked per `(accountName, channelId, skuId)` as `complete | partial | missing`. Updated whenever the platform receives a new Mapper webhook delivery or re-evaluates a SKU.

---

### Step 5: Price Resolution

**Purpose:** Determine the effective selling price and list price for the channel.

**API:** VTEX Checkout simulation (see Section 6).

**Platform-managed simulation request:**
```
POST /api/checkout/pub/orderForms/simulation?sc={salesChannel}&an={accountName}
Body: {
  "items": [{ "id": "{skuId}", "quantity": 1 }],
  "country": "{channelConfig.country}",
  "postalCode": "{channelConfig.representativePostalCode}"
}
```

**Price fields extracted:**
- `items[0].sellingPrice` (in centavos/smallest unit) → `sellingPrice`
- `items[0].listPrice` (in centavos) → `listPrice`
- `items[0].price` (base price before promotions) → `basePrice`
- `totals[].value` (for tax breakdowns, if present) → `taxContext`

**Price validation (platform-enforced):**
- `sellingPrice = 0` → pipeline halted; `OfferIssue` type `ZERO_PRICE`
- `listPrice < sellingPrice` → platform normalizes: `listPrice = sellingPrice`
- Currency of response validated against `channelConfig.currency`; mismatch → `OfferIssue` type `CURRENCY_MISMATCH`

**Simulation cache:** result cached per `(accountName, skuId, salesChannel, country, postalCode)` with TTL from `channelConfig.dedupTtlSeconds.price`. The Price and Inventory Resolvers share the same simulation call.

---

### Step 6: Inventory Resolution

**Purpose:** Determine the sellable stock quantity for the channel.

**Source:** the same Checkout simulation response used in Step 5 (single API call, shared cache).

**Stock extraction:**
```
logisticsInfo[*]
  .deliveryChannels
  .filter(c => c.id == "delivery")
  .stockBalance
  → sum across all delivery-eligible sellers
```

Because the Checkout simulation evaluates all sellers in the trade policy (not only seller `"1"`), the `stockBalance` represents the true available stock as a buyer would see it.

**Platform-applied stock rule:**
```
if (not eligible) → sellableQuantity = 0
else if (simulatedStock <= channelConfig.minimumStock) → sellableQuantity = 0
else → sellableQuantity = simulatedStock
```

**Connector extension:** connectors may register a `StockAdjustmentHook` that receives `(rawSimulatedStock, channelConfig)` and returns an adjusted quantity. This is the correct extension point for marketplace-specific stock transformations (e.g., caps, fulfillment warehouse exclusions, third-party warehouse additions). The hook cannot increase stock beyond the simulated value.

---

### Step 7: Availability Calculation

**Purpose:** Compute the canonical `isAvailable` flag and `unavailableReason`.

**Platform formula:**
```
catalogEligibility = (IsActive AND IsProductActive AND inSalesChannel)
priceEligibility   = (sellingPrice > 0)
inventoryEligibility = (sellableQuantity > 0)

isAvailable = catalogEligibility AND priceEligibility AND inventoryEligibility
```

**`unavailableReason` enum (when `isAvailable = false`):**
- `SKU_INACTIVE` — `IsActive = false`
- `PRODUCT_INACTIVE` — `IsProductActive = false`
- `NOT_IN_SALES_CHANNEL` — SKU not in channel's trade policy
- `ZERO_PRICE` — simulation returned price = 0
- `ZERO_STOCK` — `sellableQuantity = 0` after minimum stock threshold
- `BELOW_MINIMUM_STOCK` — stock > 0 but ≤ `minimumStock`
- `CONTENT_VIOLATION` — content validation failed and connector blocked publication
- `MISSING_MAPPING` — no category or required attribute mapping

**Important:** the platform computes `isAvailable` and `unavailableReason`. The connector adapter receives this value and translates it into the marketplace-specific status communication (e.g., PAUSED, UNLIST, stock=0, deactivation). The adapter must **not** recompute availability from raw inputs.

---

### Step 8: Canonical ProductFeed Assembly

**Purpose:** Assemble the complete, versioned `ProductFeed` object that is dispatched to the connector and stored in the Feed State Store.

The `ProductFeed` object is defined in Section 7. At this step:

- All resolver outputs are merged into a single object.
- A `feedVersion` is computed as a hash of content, price, inventory, and availability fields.
- `assembledAt` timestamp is recorded.
- If `feedVersion` matches the last dispatched version for this `(skuId, channelId)`, the dispatch is skipped (idempotency — no unnecessary marketplace API calls).

---

### Step 9: Connector Dispatch

**Purpose:** Deliver the canonical `ProductFeed` to the registered connector adapter.

**Dispatch model:** the platform calls the connector's registered `dispatchEndpoint` with the `ProductFeed` payload. The connector adapter is responsible for:
- Transforming `ProductFeed` into the marketplace-specific payload
- Calling the marketplace API
- Returning a `DispatchResult` (`success | error | retry`) to the platform

**Dispatch contract:**
```json
POST {connector.dispatchEndpoint}
{
  "feedVersion": "sha256:...",
  "channelId": "my-connector-us",
  "productFeed": { ... },
  "connectorContext": { ... }
}
```

**Platform-managed retry:** on `DispatchResult.retry`, the platform re-enqueues the event with exponential backoff (1s, 5s, 30s, 5min, 30min). After `maxRetries` (configurable per channel, default 5), the message is moved to DLQ and an `OfferIssue` of type `SYNC_EXHAUSTED` is created.

**Platform-managed deduplication:** before dispatching, the platform checks whether `feedVersion` matches the last successfully dispatched version. If it matches, dispatch is skipped and `syncStatus: SKIPPED_NO_CHANGE` is written to the Feed State Store.

---

### Step 10: Feed State Write and Observability

**Purpose:** Persist the outcome and make it queryable.

After every dispatch attempt (success or failure):

1. **Feed State Store write:** `(accountName, channelId, skuId)` → `{ price, stock, isAvailable, unavailableReason, syncStatus, lastSyncAt, lastError, feedVersion }`.
2. **Bridge document write:** VTEX Bridge document per `(accountName, skuId, channelId)` using the standardized 7-field schema (see Section 8.3).
3. **OfferIssue write** (if applicable): normalized issue record with `issueType`, `severity`, `description`, `resolvedAt`.
4. **Metric emission:** `feed.sync.total`, `feed.sync.success`, `feed.sync.error`, `feed.sync.skipped` counters per channel.

---

## 6. Checkout Simulation — Canonical API

The platform uses the VTEX Checkout simulation API as the sole source of price and inventory truth.

### Why Checkout simulation, not Fulfillment simulation

| | Fulfillment Simulation | Checkout Simulation |
|---|---|---|
| **Endpoint** | `POST /api/fulfillment/pvt/orderForms/simulation` | `POST /api/checkout/pub/orderForms/simulation` |
| **Seller scope** | Single seller specified by caller (all existing connectors hardcode `seller: "1"`) | All sellers in the trade policy; VTEX resolves the winning offer |
| **Multi-seller / franchise** | Not modeled — sub-sellers and franchise stores are excluded | Included — returns the buyer-visible effective offer |
| **Promotions** | Applied for the specified seller only | Applied across all eligible sellers |
| **`country` + `postalCode`** | Item-level parameters | Top-level request parameters — natural fit for per-channel config |

The Fulfillment simulation with `seller: "1"` returns **structurally incorrect** results for any account with more than one seller (franchise networks, white-label resellers, marketplace sub-sellers). The platform does not use it.

### Canonical simulation request

```
POST /api/checkout/pub/orderForms/simulation?sc={salesChannel}&an={accountName}
Content-Type: application/json

{
  "items": [
    { "id": "{skuId}", "quantity": 1 }
  ],
  "country": "{channelConfig.country}",
  "postalCode": "{channelConfig.representativePostalCode}"
}
```

The `seller` field is intentionally omitted. `affiliateId` is appended as a query parameter only when the channel config declares one.

### Cache key

```
{accountName}:{skuId}:{salesChannel}:{country}:{postalCode}
TTL: channelConfig.dedupTtlSeconds.price (also used for stock — same response)
```

### What the platform extracts

```json
{
  "price": {
    "sellingPrice":  items[0].sellingPrice,
    "listPrice":     items[0].listPrice,
    "basePrice":     items[0].price,
    "currency":      channelConfig.currency,
    "simulationCountry":    channelConfig.country,
    "simulationPostalCode": channelConfig.representativePostalCode,
    "resolvedAt":    "ISO-8601 timestamp"
  },
  "inventory": {
    "sellableQuantity": sum of logisticsInfo[*].deliveryChannels["delivery"].stockBalance,
    "resolvedAt": "ISO-8601 timestamp"
  }
}
```

---

## 7. Canonical ProductFeed Model

The `ProductFeed` is the platform's output object. It is passed to connector adapters, stored in the Feed State Store, and returned by MCP read tools.

### 7.1 Identity

```json
{
  "identity": {
    "accountName":          "mystore",
    "salesChannel":         2,
    "tradePolicy":          "2",
    "channelId":            "my-connector-us",
    "productId":            "42",
    "skuId":                "1001",
    "feedVersion":          "sha256:abc123...",
    "assembledAt":          "2026-05-07T14:00:00Z"
  }
}
```

### 7.2 Catalog Content

```json
{
  "catalogContent": {
    "title":           "Product Name — SKU Variant",
    "description":     "Plain text, HTML stripped",
    "brand":           "Brand Name",
    "vtexCategoryId":  "15",
    "vtexCategoryPath": "/1/5/15/",
    "specifications":  [{ "name": "Color", "value": "Black", "isVariation": true }],
    "images":          [{ "url": "https://...", "label": "Main", "isMain": true }],
    "ean":             "7891234567890",
    "dimensions": {
      "realHeight": 10.0, "realWidth": 5.0, "realLength": 15.0, "realWeight": 300.0,
      "packageHeight": 12.0, "packageWidth": 7.0, "packageLength": 17.0, "packageWeight": 350.0,
      "unit": "cm_g"
    },
    "isKit":           false,
    "contentVersion":  "sha256:def456...",
    "contentUpdatedAt": "2026-05-07T14:00:00Z"
  }
}
```

### 7.3 Mapping

Resolved by the platform's Mapping Gateway from the cached VTEX Mapper output (Section 4.2). The connector receives this pre-resolved — it does not query the Mapper itself.

```json
{
  "mapping": {
    "vtexCategoryId":      "15",
    "channelCategoryId":   "CAT-001",
    "channelCategoryName": "Electronics > Phones",
    "attributes": [
      {
        "vtexSpecName":    "Color",
        "vtexSpecValue":   "Black",
        "channelAttrId":   "COLOR",
        "channelAttrValue": "Preto"
      }
    ],
    "mappingStatus":       "complete",
    "missingMappings":     [],
    "mappingResolvedAt":   "2026-05-07T14:00:00Z"
  }
}
```

`mappingStatus` values:
- `complete` — all required VTEX categories and attributes have a channel mapping
- `partial` — category is mapped but one or more attributes are missing a value mapping
- `missing` — no channel category mapping for this SKU's VTEX category (pipeline halted)

### 7.4 Price

```json
{
  "price": {
    "sellingPrice":          2499.90,
    "listPrice":             2999.90,
    "basePrice":             2999.90,
    "currency":              "USD",
    "sourceOfCalculation":   "checkout_simulation",
    "simulationCountry":     "USA",
    "simulationPostalCode":  "10001",
    "resolvedAt":            "2026-05-07T14:00:00Z"
  }
}
```

### 7.5 Inventory

```json
{
  "inventory": {
    "simulatedStockBalance": 150,
    "sellableQuantity":      145,
    "minimumStockThreshold": 5,
    "resolvedAt":            "2026-05-07T14:00:00Z"
  }
}
```

### 7.6 Availability

```json
{
  "availability": {
    "isAvailable":         true,
    "sellableQuantity":    145,
    "unavailableReason":   null,
    "catalogEligibility":  true,
    "priceEligibility":    true,
    "inventoryEligibility": true,
    "computedAt":          "2026-05-07T14:00:00Z"
  }
}
```

### 7.7 Feed State

```json
{
  "feedState": {
    "syncStatus":           "synced",
    "lastSyncAt":           "2026-05-07T14:00:00Z",
    "lastSuccessfulSyncAt": "2026-05-07T14:00:00Z",
    "lastError":            null,
    "openIssues":           [],
    "retryCount":           0,
    "feedVersion":          "sha256:abc123..."
  }
}
```

### 7.8 Connector Context

Optional additional data the platform passes to the connector adapter. Not stored in the Feed State Store. Populated by connector-registered additional VTEX calls (category tree, brand details, parent product relationships).

```json
{
  "connectorContext": {
    "rawSkuResponse":       { ... },
    "categoryTree":         [ ... ],
    "additionalFetches":    { }
  }
}
```

---

## 8. MCP Tools Specification

All tools are served by the MCP Interface layer. External callers are stateless — they call a tool and receive a response.

### 8.1 Read Tools (no side effects)

---

#### `getProductFeedState`

Returns the current canonical feed state for a SKU on a channel.

```typescript
input: {
  skuId:     string,
  channelId: string,
  accountName: string
}

output: {
  productFeed: ProductFeed,        // full canonical object
  dataFreshness: {
    priceAge:     number,          // seconds since last price resolution
    stockAge:     number,          // seconds since last stock resolution
    contentAge:   number,          // seconds since last content fetch
    isStale:      boolean          // true if any field exceeds its channel TTL
  }
}
```

**MVP tool.** Answers the #1 support question: "what did the platform send to channel X for SKU Y?"

---

#### `listProductFeedIssues`

Returns paginated open issues for a channel.

```typescript
input: {
  channelId:   string,
  accountName: string,
  issueType?:  IssueType,          // filter
  severity?:   "error" | "warning" | "info",
  skuId?:      string,             // filter to one SKU
  limit:       number,             // max 100
  offset:      number
}

output: {
  issues: OfferIssue[],
  total:  number,
  page:   number
}
```

**MVP tool.** Uses Bridge-sourced data; no new taxonomy required for MVP.

---

#### `explainOfferAvailability`

Returns a structured explanation of why an offer is available or unavailable.

```typescript
input: {
  skuId:      string,
  channelId:  string,
  accountName: string
}

output: {
  isAvailable:       boolean,
  unavailableReason: UnavailableReason | null,
  breakdown: {
    catalogEligibility:   { pass: boolean, detail: string },
    priceEligibility:     { pass: boolean, detail: string },
    inventoryEligibility: { pass: boolean, detail: string },
    mappingStatus:        { pass: boolean, detail: string }
  },
  lastSimulationParams: {
    country:     string,
    postalCode:  string,
    resolvedAt:  string
  }
}
```

**Requires:** OfferIssue taxonomy agreed across all channel teams (Phase 2 prerequisite).

---

#### `getMarketplaceMappingStatus`

Returns the category and attribute mapping status for a SKU on a channel.

```typescript
input: {
  skuId:      string,
  channelId:  string,
  accountName: string
}

output: {
  mappingStatus:   "complete" | "partial" | "missing",
  categoryMapping: { vtexCategoryId: string, channelCategoryId: string | null },
  attributeMapping: MappingEntry[],
  missingMappings:  MissingMapping[]
}
```

---

#### `compareFeedStateAcrossChannels`

Returns the feed state of a SKU across all active channels in one call.

```typescript
input: {
  skuId:       string,
  accountName: string
}

output: {
  rows: Array<{
    channelId:        string,
    sellingPrice:     number,
    currency:         string,
    sellableQuantity: number,
    isAvailable:      boolean,
    unavailableReason: string | null,
    lastSyncAt:       string,
    openIssueCount:   number
  }>
}
```

---

#### `getFeedSyncHistory`

Returns the recent sync history for a SKU on a channel.

```typescript
input: {
  skuId:      string,
  channelId:  string,
  accountName: string,
  limit?:     number,    // default 20
  since?:     string     // ISO-8601
}

output: {
  events: Array<{
    syncAt:      string,
    syncStatus:  string,
    price:       number,
    stock:       number,
    feedVersion: string,
    error:       string | null
  }>
}
```

---

#### `simulateProductFeed`

Runs the full resolution pipeline for a SKU with custom simulation parameters, without affecting the live feed state.

```typescript
input: {
  skuId:      string,
  channelId:  string,
  accountName: string,
  overrides?: {
    country?:            string,
    representativePostalCode?: string,
    minimumStock?:       number
  }
}

output: {
  productFeed:      ProductFeed,
  simulationParams: { country: string, postalCode: string },
  isHypothetical:   true            // always true — result is never persisted
}
```

---

### 8.2 Action Tools (write side effects)

---

#### `retryFeedSync`

Manually enqueues a re-sync for one SKU on one channel.

```typescript
input: {
  skuId:      string,
  channelId:  string,
  accountName: string,
  syncType:   "catalog" | "price" | "stock" | "full"
}

output: {
  enqueued:               boolean,
  estimatedProcessingMs:  number,
  idempotencyKey:         string
}
```

**Guards (enforced by the platform):**
- Maximum 1 manual retry per `(skuId, channelId)` per 60 seconds
- If a sync for this key is already in-flight, returns `enqueued: false` with the existing `idempotencyKey`
- Bulk retry (multiple SKUs) is not exposed through this tool; use `triggerFullChannelSync` for account-level reprocessing (Phase 4 tool)

---

## 9. Connector Interface Contract

### 9.1 What the Platform Provides to Every Connector

When the platform dispatches a sync event, the connector adapter receives:

```json
POST {connectorConfig.dispatchEndpoint}
{
  "dispatchId":     "uuid",
  "channelId":      "my-connector-us",
  "productFeed":    { ... },        // canonical ProductFeed object (Section 7)
  "connectorContext": { ... },      // additional VTEX data declared by connector
  "dispatchedAt":   "ISO-8601"
}
```

The connector receives a fully resolved, validated, normalized feed object. It does not need to call VTEX APIs, manage queues, or compute availability.

### 9.2 What Every Connector Must Implement

A connector is a service that exposes the following endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `{dispatchEndpoint}` | POST | Receive `ProductFeed` dispatch; use the pre-resolved `mapping` section to transform canonical data into the marketplace payload; call the marketplace API; return `DispatchResult` |
| `/health` | GET | Liveness check used by the platform before dispatching |
| `/config/stock-adjustment-hook` | GET | Declare a `StockAdjustmentHook` if the channel requires marketplace-specific stock transformations (e.g., cap at a marketplace limit, add pickup stock). Optional. |

The connector does **not** declare attribute schemas, field constraints, or category structures to the platform. Those are defined in VTEX Mapper by the channel operator and delivered to the platform automatically via webhook. The connector receives a `ProductFeed` with the `mapping` section already resolved and uses it directly.

### 9.3 DispatchResult Contract

```json
{
  "dispatchId":     "uuid",
  "status":         "success" | "error" | "retry",
  "externalOfferId": "marketplace-listing-id",
  "errorCode":      "string | null",
  "errorMessage":   "string | null",
  "retryable":      true | false,
  "processedAt":    "ISO-8601"
}
```

The platform uses `DispatchResult.status` to:
- Write `syncStatus` to the Feed State Store
- Trigger retry if `status = "retry"`
- Create `OfferIssue` if `status = "error"` and `retryable = false`
- Move to DLQ after `maxRetries` exhausted

### 9.4 What Connectors Must Not Do

- Call VTEX Catalog, Pricing, Inventory, or Simulation APIs to resolve feed data (the platform has already done this)
- Recompute `isAvailable` or `sellableQuantity` from raw inputs (consume the platform's computed values)
- Maintain their own deduplication state for platform-sourced events (the platform deduplicates before dispatch)
- Return a `status: "success"` before actually confirming the marketplace API call (false positives corrupt Feed State Store data)

---

## 10. Feed State Store

### 10.1 Data Model

**Primary key:** `(accountName, channelId, skuId)`

**Written fields:**

| Field | Type | Updated on |
|---|---|---|
| `sellingPrice` | decimal | Every successful price resolution |
| `currency` | string | Channel config |
| `sellableQuantity` | integer | Every successful inventory resolution |
| `isAvailable` | boolean | Every availability computation |
| `unavailableReason` | enum | Every availability computation |
| `syncStatus` | enum | Every dispatch attempt |
| `lastSyncAt` | timestamp | Every dispatch attempt |
| `lastSuccessfulSyncAt` | timestamp | Successful dispatch only |
| `lastError` | string | Failed dispatch only |
| `feedVersion` | string | Every assembly |
| `openIssueCount` | integer | On OfferIssue create/resolve |

### 10.2 Partitioning

The store is partitioned at the infrastructure level by `(accountName, channelId)`. There is no application-level filtering for tenant isolation — data isolation is enforced at storage.

### 10.3 Staleness Tracking

Every resolved field includes a `resolvedAt` timestamp. The `getProductFeedState` tool computes `isStale` by comparing each field's `resolvedAt` against the channel's configured TTL. Stale fields are surfaced in the `dataFreshness` section of the response so callers can decide whether to trigger a fresh resolution.

### 10.4 Retention

- Active feed state: indefinite (updated on each sync)
- Sync history events: 90 days (queryable via `getFeedSyncHistory`)
- Resolved `OfferIssue` records: 30 days after resolution

---

## 11. Observability

### 11.1 VTEX Bridge Schema (standardized)

All platform Bridge writes use this 7-field schema:

| Field | Type | Values |
|---|---|---|
| `skuId` | string | VTEX SKU ID |
| `accountName` | string | VTEX account name |
| `channelId` | string | Platform channel ID |
| `status` | enum | `Success` \| `Warning` \| `Error` |
| `type` | enum | `Catalog` \| `Price` \| `Stock` \| `Availability` |
| `message` | string | Human-readable description |
| `timestamp` | ISO-8601 | Time of the event |

### 11.2 OfferIssue Model

```typescript
{
  issueId:       string,          // UUID
  accountName:   string,
  channelId:     string,
  skuId:         string,
  issueType:     IssueType,       // enum — see below
  severity:      "error" | "warning" | "info",
  description:   string,          // human-readable; sanitized, no PII
  source:        "platform" | "connector" | "marketplace",
  createdAt:     string,
  resolvedAt:    string | null,
  resolved:      boolean
}
```

**`IssueType` enum (platform-defined):**

| Value | Meaning |
|---|---|
| `ZERO_PRICE` | Simulation returned price = 0 |
| `CURRENCY_MISMATCH` | Simulation response currency differs from channel config |
| `ZERO_STOCK` | Stock = 0 after minimum stock threshold |
| `BELOW_MINIMUM_STOCK` | Stock above 0 but at or below threshold |
| `SKU_INACTIVE` | `IsActive = false` |
| `PRODUCT_INACTIVE` | `IsProductActive = false` |
| `NOT_IN_SALES_CHANNEL` | SKU not in channel's trade policy |
| `CONTENT_VIOLATION` | Content failed connector's `ValidationRuleSet` |
| `CONTENT_FETCH_ERROR` | VTEX Catalog API error during enrichment |
| `MISSING_MAPPING` | No category or required attribute mapping |
| `DISPATCH_ERROR` | Connector returned `status: "error"` |
| `SYNC_EXHAUSTED` | All retries exhausted; message in DLQ |
| `SIMULATION_ERROR` | Checkout simulation API error |

### 11.3 Metrics

The platform emits the following counters and histograms:

| Metric | Type | Labels |
|---|---|---|
| `feed.sync.total` | counter | `channelId`, `accountName`, `syncType` |
| `feed.sync.success` | counter | `channelId`, `accountName` |
| `feed.sync.error` | counter | `channelId`, `accountName`, `issueType` |
| `feed.sync.skipped` | counter | `channelId`, `accountName` (no change detected) |
| `feed.simulation.latency_ms` | histogram | `channelId`, `country` |
| `feed.dispatch.latency_ms` | histogram | `channelId` |
| `feed.queue.depth` | gauge | `channelId`, `queueType` |

---

## 12. MVP Implementation Plan

### 12.1 Prerequisites (Phase 0 — 2–4 weeks, no new infrastructure)

| Task | Owner | Done when |
|---|---|---|
| Register `country` + `representativePostalCode` for every active channel; enforce at channel registration | Platform + connector teams | No channel can execute simulation without both values |
| Standardize Bridge writes to the 7-field schema across all existing connectors | Each connector team | All Bridge documents match the schema |
| Validate Checkout simulation output parity vs current Fulfillment simulation for single-seller accounts | Platform team | Documented for each connector; differences reviewed |
| Run baseline measurements: simulation call volume, Broadcaster event gap rate, SKU mapping coverage | Platform team | Numbers available to size Phase 1 infrastructure |

### 12.2 MVP Deliverables (Phase 1 — 1–3 months)

| Deliverable | Description | Success criteria |
|---|---|---|
| **Broadcaster Event Ingestion** | Subscribe to VTEX Broadcaster; manage SQS queues per channel; route events to Orchestrator | Events processed for all registered channels; no events lost during 24h test window |
| **Feed Orchestrator (steps 1–7)** | Eligibility → Enrichment → Normalization → Mapping → Price → Inventory → Availability | Full pipeline executes end-to-end for at least 2 registered test channels |
| **Checkout Simulation Resolver** | Shared simulation call with per-channel config; price + stock extracted from single response | Correct price and stock returned for single-seller and multi-seller test accounts |
| **Feed State Store** | Write `FeedStateEvent` after every dispatch attempt; partitioned by `(accountName, channelId)` | P99 write latency < 50ms; data isolated between accounts |
| **`getProductFeedState` MCP tool** | Returns current feed state for `(skuId, channelId, accountName)` | P95 read latency < 100ms; accuracy ≥ 95% vs Bridge; `isStale` always populated |
| **`listProductFeedIssues` MCP tool** | Paginated issues from Feed State Store using platform `IssueType` enum | Works for all registered channels; pagination correct for 100k+ records |

### 12.3 Phase 2 — Shared Resolvers (3–6 months)

- Logistics Resolver (optional, connector-declared)
- `explainOfferAvailability` MCP tool (requires OfferIssue taxonomy agreement)
- `explainOfferPrice` MCP tool
- `StockAdjustmentHook` interface for connector-specific stock transformations

### 12.4 Phase 3 — Mapping and Content (6–12 months)

- Mapping Gateway with Redis cache fronting VTEX Mapper
- `ValidationRuleSet` registry per connector
- `getMarketplaceMappingStatus` MCP tool
- Catalog Content Gateway with `contentVersion` change detection

### 12.5 Phase 4 — Orchestration and Action Tools (12–18 months)

- Full Feed Orchestrator with configurable connector pipelines
- `retryFeedSync` MCP action tool (with blast-radius guards)
- `compareFeedStateAcrossChannels` MCP tool
- Shared retry framework (connector-configurable TTLs)

### 12.6 Phase 5 — Advanced (18–24 months)

- `simulateProductFeed` MCP tool
- `getFeedSyncHistory` MCP tool
- Regional availability modeling
- Full platform multi-tenancy audit and compliance review

---

## 13. Open Questions

These must be answered before the corresponding phase begins. No implementation should proceed on an unresolved blocker.

| # | Question | Blocks | How to answer |
|---|---|---|---|
| 1 | Does Checkout simulation called with non-BRL `country` + `postalCode` return the expected currency for non-Brazilian channels? | Phase 0 completion | Call Checkout simulation for 3 non-BR accounts with correct country codes; validate currency in response |
| 2 | For single-seller VTEX accounts, do Checkout and Fulfillment simulation return identical price and stock? | Phase 1 resolver migration | Compare both API responses for 1 account per connector; document any differences |
| 3 | Is VTEX Broadcaster reliable enough for the platform's consistency model? What is the observed event loss rate and max lag? | Phase 1 queue architecture | Monitor Broadcaster delivery for 1 connector for 2 weeks; run CompareAll-style reconciliation to measure drift |
| 4 | Which team owns the platform (Feed State Store, Resolvers, MCP Interface) and what is their mandate across connector teams? | Phase 1 kickoff | Organizational decision; must be resolved before Phase 1 begins |
| 5 | How many simulation calls per day across all active connectors currently? | Phase 1 cache sizing | Instrument 2 connectors with call counters for 1 week; extrapolate |
| 6 | What fraction of Broadcaster events are catalog changes vs price/stock-only? | Phase 3 content gateway priority | Sample event stream for 2 weeks |
| 7 | What percentage of active SKUs lack a complete category or attribute mapping? | Phase 3 Mapping Gateway priority | Query VTEX Mapper status for a representative account sample |
| 8 | For connectors with marketplace-specific stock requirements (cap, fulfillment warehouse exclusion, pickup addition): is the `StockAdjustmentHook` interface sufficient, or do they need access to additional VTEX inventory APIs? | Phase 2 hook design | Interview each connector team about their stock calculation requirements |
| 9 | What is the MCP authorization model? Which roles (Store Admin, Support Agent, Connector Service Account) can invoke which tools? Is an audit log required for `retryFeedSync`? | Phase 4 action tools | Security and compliance review |
| 10 | What is the versioning contract for `ProductFeed` schema changes across the platform's 24-month build timeline? | Phase 2 onwards | Define semantic versioning policy for the canonical model before Phase 2 ships |

---

*End of VTEX Product Feed MCP — Specification & Implementation Plan*
