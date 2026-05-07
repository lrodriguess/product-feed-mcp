# Data Model — VTEX Product Feed MCP

**Date:** 2026-05-07
**Storage:** DynamoDB (single table) + Redis (ephemeral)

---

## DynamoDB — Main Table: `vtex-product-feed`

All records share the same table. Record type is disambiguated by the SK prefix.

### Partition Key Design

```
PK = ACCT#{accountName}#CHAN#{channelId}
```

Enforces tenant isolation at the partition level. All records for a given account+channel are co-located.

---

### Record Type 1: FeedState (current state per SKU)

**SK:** `SKU#{skuId}`

| Field | Type | Description |
|-------|------|-------------|
| `PK` | String | `ACCT#{accountName}#CHAN#{channelId}` |
| `SK` | String | `SKU#{skuId}` |
| `accountName` | String | VTEX account name |
| `channelId` | String | Platform channel ID |
| `skuId` | String | VTEX SKU ID |
| `syncStatus` | Enum | `pending \| in_flight \| synced \| skipped \| error \| exhausted` |
| `sellingPrice` | Number | Last dispatched selling price (in currency smallest unit) |
| `listPrice` | Number | Last dispatched list price |
| `currency` | String | ISO 4217 currency code |
| `sellableQuantity` | Number | Last dispatched sellable quantity |
| `isAvailable` | Boolean | Last computed availability |
| `unavailableReason` | String? | Enum value when `isAvailable = false` |
| `feedVersion` | String | SHA-256 hash of last dispatched ProductFeed |
| `lastSyncAt` | String | ISO 8601 timestamp of last dispatch attempt |
| `lastSuccessfulSyncAt` | String? | ISO 8601 timestamp of last successful dispatch |
| `lastError` | String? | Error message from last failed dispatch |
| `openIssueCount` | Number | Count of unresolved OfferIssue records |
| `priceResolvedAt` | String | ISO 8601 timestamp of last price resolution |
| `stockResolvedAt` | String | ISO 8601 timestamp of last stock resolution |
| `contentResolvedAt` | String | ISO 8601 timestamp of last content fetch |
| `retryCount` | Number | Current retry count (reset on success) |
| `updatedAt` | String | ISO 8601 timestamp of last write |

**State transition rules:**
```
pending → in_flight             (pipeline starts processing)
in_flight → synced              (dispatch confirmed by connector)
in_flight → skipped             (feedVersion unchanged, dispatch skipped)
in_flight → error               (dispatch failed, retries remaining)
error → in_flight               (retry enqueued and starts)
error → exhausted               (maxRetries exceeded, moved to DLQ)
synced | skipped | exhausted → pending   (new event arrives or retryFeedSync called)
```

---

### Record Type 2: SyncEvent (sync history)

**SK:** `SYNC#{iso8601Timestamp}#{skuId}`

Timestamp in SK is ISO 8601 (lexicographically sortable) — enables range queries without a GSI.

| Field | Type | Description |
|-------|------|-------------|
| `PK` | String | `ACCT#{accountName}#CHAN#{channelId}` |
| `SK` | String | `SYNC#{iso8601}#{skuId}` |
| `skuId` | String | VTEX SKU ID |
| `syncAt` | String | ISO 8601 timestamp |
| `syncStatus` | Enum | Terminal state of this sync event |
| `sellingPrice` | Number | Price at time of sync |
| `sellableQuantity` | Number | Stock at time of sync |
| `isAvailable` | Boolean | Availability at time of sync |
| `feedVersion` | String | SHA-256 hash of ProductFeed at this version |
| `error` | String? | Error message if failed |
| `ttl` | Number | Unix epoch — 90 days from `syncAt` |

---

### Record Type 3: OfferIssue

**SK:** `ISSUE#{issueId}`

| Field | Type | Description |
|-------|------|-------------|
| `PK` | String | `ACCT#{accountName}#CHAN#{channelId}` |
| `SK` | String | `ISSUE#{issueId}` |
| `issueId` | String | UUID |
| `accountName` | String | VTEX account name |
| `channelId` | String | Platform channel ID |
| `skuId` | String | VTEX SKU ID |
| `issueType` | Enum | See IssueType enum below |
| `severity` | Enum | `error \| warning \| info` |
| `description` | String | Human-readable; no PII |
| `source` | Enum | `platform \| connector \| marketplace` |
| `createdAt` | String | ISO 8601 timestamp |
| `resolvedAt` | String? | ISO 8601 timestamp when resolved |
| `resolved` | Boolean | `false` until resolved |
| `ttl` | Number? | Unix epoch — 30 days after `resolvedAt` (set when resolved) |
| `gsi1pk` | String | `ACCT#{accountName}#CHAN#{channelId}#ISSUES` (GSI-1 PK) |
| `gsi1sk` | String | `{severity}#{issueType}#{issueId}` (GSI-1 SK) |

**IssueType enum:**

| Value | Trigger |
|-------|---------|
| `ZERO_PRICE` | Simulation returned `sellingPrice = 0` |
| `CURRENCY_MISMATCH` | Simulation currency ≠ `channelConfig.currency` |
| `ZERO_STOCK` | `sellableQuantity = 0` after minimum stock threshold |
| `BELOW_MINIMUM_STOCK` | Stock > 0 but ≤ `minimumStock` |
| `SKU_INACTIVE` | `IsActive = false` |
| `PRODUCT_INACTIVE` | `IsProductActive = false` |
| `NOT_IN_SALES_CHANNEL` | SKU not in channel's trade policy |
| `CONTENT_VIOLATION` | Connector returned content validation failure |
| `CONTENT_FETCH_ERROR` | VTEX Catalog API error during enrichment |
| `MISSING_MAPPING` | No category or required attribute mapping |
| `DISPATCH_ERROR` | Connector returned `status: "error"` |
| `SYNC_EXHAUSTED` | All retries exhausted; message in DLQ |
| `SIMULATION_ERROR` | Checkout simulation API error or unavailability |

---

### Record Type 4: ChannelConfig

**Table:** `vtex-channel-config` (separate table — config is not event-sourced)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channelId` | String (PK) | ✅ | Unique channel identifier |
| `connectorType` | Enum | ✅ | `marketplace \| erp \| feed` |
| `accountName` | String | ✅ | VTEX account name |
| `salesChannel` | Number | ✅ | VTEX sales channel ID |
| `tradePolicy` | String | ✅ | VTEX trade policy ID |
| `affiliateId` | String? | — | Affiliate ID for scoped pricing |
| `country` | String | ✅ | ISO 3166-1 alpha-3 (`BRA`, `USA`, `DEU`, …) |
| `representativePostalCode` | String | ✅ | Valid postal code in declared country |
| `currency` | String | ✅ | ISO 4217 currency code |
| `dedupTtlSeconds` | Object | ✅ | `{ catalog: N, price: N, stock: N }` |
| `minimumStock` | Number | ✅ | Stock threshold (0 = disabled) |
| `dispatchEndpoint` | String | ✅ | Connector HTTP endpoint for dispatch |
| `maxRetries` | Number | ✅ | Max dispatch retries before DLQ (default 5) |
| `active` | Boolean | ✅ | Must be `true` to receive events |
| `createdAt` | String | — | ISO 8601 |
| `updatedAt` | String | — | ISO 8601 |

---

## DynamoDB — GSI Summary

| GSI | PK | SK | Purpose |
|-----|----|----|---------|
| GSI-1 | `ACCT#{accountName}#CHAN#{channelId}#ISSUES` | `{severity}#{issueType}#{issueId}` | Issue list with severity/type filter |
| GSI-2 | `ACCT#{accountName}#SKU#{skuId}` | `CHAN#{channelId}` | Cross-channel comparison |

GSI-2 is **sparse** — only current-state `FeedState` records are projected (no history, no issues). Achieved by only writing the `gsi2pk`/`gsi2sk` attributes on `FeedState` records.

---

## Redis — Ephemeral Structures

### Deduplication keys

```
Key:   dedup:{accountName}:{skuId}:{eventType}
Type:  String (SET NX)
TTL:   channelConfig.dedupTtlSeconds[eventType]
Value: "1"
```

A `SET NX` with TTL atomically claims the dedup slot. If the key already exists, the event is discarded.

### Mapping Cache

```
Key:   mapping:{accountName}:{channelId}:{vtexCategoryId}
Type:  Hash
TTL:   3600 seconds (refreshed on each Mapper webhook delivery)
Fields:
  channelCategoryId:   string
  channelCategoryName: string
  attrMap:             JSON-encoded array of { vtexSpecName, vtexSpecValue, channelAttrId, channelAttrValue }
```

### SKU Enrichment Cache

```
Key:   sku:{accountName}:{skuId}
Type:  String (JSON)
TTL:   channelConfig.dedupTtlSeconds.catalog
Value: JSON-encoded VTEX SKU API response
```

Cache is invalidated on `HasStockKeepingUnitModified` Broadcaster events.

---

## Canonical ProductFeed (in-memory / dispatch payload)

Not persisted directly — assembled per sync cycle, dispatched to connectors, and summarized in `FeedState`.

```typescript
interface ProductFeed {
  identity:        FeedIdentity;
  catalogContent:  CatalogContent;
  mapping:         MappingResult;
  price:           PriceResult;
  inventory:       InventoryResult;
  availability:    AvailabilityResult;
  feedState:       FeedStateSnapshot;
  connectorContext?: ConnectorContext;
}
```

### FeedIdentity
```typescript
{
  accountName:  string;
  salesChannel: number;
  tradePolicy:  string;
  channelId:    string;
  productId:    string;
  skuId:        string;
  feedVersion:  string;   // SHA-256 of content+price+inventory+availability
  assembledAt:  string;   // ISO 8601
}
```

### PriceResult
```typescript
{
  sellingPrice:          number;
  listPrice:             number;
  basePrice:             number;
  currency:              string;
  sourceOfCalculation:   "checkout_simulation";
  simulationCountry:     string;
  simulationPostalCode:  string;
  resolvedAt:            string;
}
```

### InventoryResult
```typescript
{
  simulatedStockBalance: number;
  sellableQuantity:      number;  // 0 if ≤ minimumStock
  minimumStockThreshold: number;
  resolvedAt:            string;
}
```

### AvailabilityResult
```typescript
{
  isAvailable:           boolean;
  sellableQuantity:      number;
  unavailableReason:     UnavailableReason | null;
  catalogEligibility:    boolean;
  priceEligibility:      boolean;
  inventoryEligibility:  boolean;
  computedAt:            string;
}

type UnavailableReason =
  | "SKU_INACTIVE"
  | "PRODUCT_INACTIVE"
  | "NOT_IN_SALES_CHANNEL"
  | "ZERO_PRICE"
  | "ZERO_STOCK"
  | "BELOW_MINIMUM_STOCK"
  | "CONTENT_VIOLATION"
  | "MISSING_MAPPING";
```

### MappingResult
```typescript
{
  vtexCategoryId:      string;
  channelCategoryId:   string | null;
  channelCategoryName: string | null;
  attributes:          MappingEntry[];
  mappingStatus:       "complete" | "partial" | "missing";
  missingMappings:     MissingMapping[];
  mappingResolvedAt:   string;
}
```

### DispatchResult (from connector)
```typescript
{
  dispatchId:      string;
  status:          "success" | "error" | "retry";
  externalOfferId: string | null;
  errorCode:       string | null;
  errorMessage:    string | null;
  retryable:       boolean;
  processedAt:     string;
}
```
