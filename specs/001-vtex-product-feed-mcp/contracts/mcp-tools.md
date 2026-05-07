# MCP Tool Contracts — VTEX Product Feed MCP

**Transport:** Streamable HTTP (HTTP + SSE)
**SDK:** `@modelcontextprotocol/sdk` (TypeScript)
**Authentication:** VTEX Admin token (`VtexIdclientAutCookie` or `X-VTEX-API-AppKey` + `X-VTEX-API-AppToken`) on all requests.

---

## Read Tools (no side effects)

---

### `getProductFeedState`

Returns the current canonical feed state for a SKU on a channel.

```json
{
  "name": "getProductFeedState",
  "description": "Returns the current canonical feed state for a SKU on a channel, including price, stock, availability, sync status, and data freshness indicators.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "skuId":       { "type": "string", "description": "VTEX SKU ID" },
      "channelId":   { "type": "string", "description": "Platform channel ID" },
      "accountName": { "type": "string", "description": "VTEX account name" }
    },
    "required": ["skuId", "channelId", "accountName"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "productFeed": { "$ref": "#/definitions/ProductFeed" },
      "dataFreshness": {
        "type": "object",
        "properties": {
          "priceAgeSeconds":   { "type": "number" },
          "stockAgeSeconds":   { "type": "number" },
          "contentAgeSeconds": { "type": "number" },
          "isStale":           { "type": "boolean" }
        },
        "required": ["priceAgeSeconds", "stockAgeSeconds", "contentAgeSeconds", "isStale"]
      }
    },
    "required": ["productFeed", "dataFreshness"]
  }
}
```

**Error cases:**
- `404` — no feed state record exists for the given key (SKU never processed on this channel)
- `403` — VTEX token does not have access to the given `accountName`

---

### `listProductFeedIssues`

Returns paginated open issues for a channel.

```json
{
  "name": "listProductFeedIssues",
  "description": "Returns a paginated list of open OfferIssue records for a channel, filterable by issue type, severity, and SKU.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "channelId":   { "type": "string" },
      "accountName": { "type": "string" },
      "issueType":   {
        "type": "string",
        "enum": ["ZERO_PRICE","CURRENCY_MISMATCH","ZERO_STOCK","BELOW_MINIMUM_STOCK",
                 "SKU_INACTIVE","PRODUCT_INACTIVE","NOT_IN_SALES_CHANNEL","CONTENT_VIOLATION",
                 "CONTENT_FETCH_ERROR","MISSING_MAPPING","DISPATCH_ERROR","SYNC_EXHAUSTED","SIMULATION_ERROR"],
        "description": "Optional filter by issue type"
      },
      "severity":    { "type": "string", "enum": ["error","warning","info"] },
      "skuId":       { "type": "string", "description": "Optional filter to a single SKU" },
      "limit":       { "type": "number", "minimum": 1, "maximum": 100, "default": 20 },
      "cursor":      { "type": "string", "description": "Pagination cursor from previous response" }
    },
    "required": ["channelId", "accountName"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "issues":     { "type": "array", "items": { "$ref": "#/definitions/OfferIssue" } },
      "total":      { "type": "number" },
      "nextCursor": { "type": "string", "description": "Pass as 'cursor' for next page; absent when no more results" }
    },
    "required": ["issues", "total"]
  }
}
```

**Note:** Pagination uses cursor-based (DynamoDB `LastEvaluatedKey`), not offset-based. `total` is an approximate count.

---

### `explainOfferAvailability`

Returns a structured explanation of why an offer is available or unavailable.

```json
{
  "name": "explainOfferAvailability",
  "description": "Returns a human-readable structured explanation of why an offer is available or unavailable on a channel, including per-eligibility-check breakdown and last simulation parameters.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "skuId":       { "type": "string" },
      "channelId":   { "type": "string" },
      "accountName": { "type": "string" }
    },
    "required": ["skuId", "channelId", "accountName"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "isAvailable":       { "type": "boolean" },
      "unavailableReason": { "type": "string", "nullable": true },
      "breakdown": {
        "type": "object",
        "properties": {
          "catalogEligibility":   { "$ref": "#/definitions/EligibilityCheck" },
          "priceEligibility":     { "$ref": "#/definitions/EligibilityCheck" },
          "inventoryEligibility": { "$ref": "#/definitions/EligibilityCheck" },
          "mappingStatus":        { "$ref": "#/definitions/EligibilityCheck" }
        }
      },
      "lastSimulationParams": {
        "type": "object",
        "properties": {
          "country":     { "type": "string" },
          "postalCode":  { "type": "string" },
          "resolvedAt":  { "type": "string" }
        }
      }
    },
    "required": ["isAvailable", "breakdown"]
  }
}
```

---

### `getMarketplaceMappingStatus`

Returns the category and attribute mapping status for a SKU on a channel.

```json
{
  "name": "getMarketplaceMappingStatus",
  "description": "Returns the category and attribute mapping status for a SKU on a channel, including which mappings are missing.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "skuId":       { "type": "string" },
      "channelId":   { "type": "string" },
      "accountName": { "type": "string" }
    },
    "required": ["skuId", "channelId", "accountName"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "mappingStatus":    { "type": "string", "enum": ["complete","partial","missing"] },
      "categoryMapping":  {
        "type": "object",
        "properties": {
          "vtexCategoryId":   { "type": "string" },
          "channelCategoryId": { "type": "string", "nullable": true }
        }
      },
      "attributeMapping": { "type": "array", "items": { "$ref": "#/definitions/MappingEntry" } },
      "missingMappings":  { "type": "array", "items": { "$ref": "#/definitions/MissingMapping" } }
    },
    "required": ["mappingStatus"]
  }
}
```

---

### `compareFeedStateAcrossChannels`

Returns feed state for a SKU across all active channels in a single response.

```json
{
  "name": "compareFeedStateAcrossChannels",
  "description": "Returns the feed state of a SKU across all active channels registered for an account, enabling cross-channel price/stock/availability comparison.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "skuId":       { "type": "string" },
      "accountName": { "type": "string" }
    },
    "required": ["skuId", "accountName"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "rows": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "channelId":          { "type": "string" },
            "sellingPrice":       { "type": "number" },
            "currency":           { "type": "string" },
            "sellableQuantity":   { "type": "number" },
            "isAvailable":        { "type": "boolean" },
            "unavailableReason":  { "type": "string", "nullable": true },
            "syncStatus":         { "type": "string" },
            "lastSyncAt":         { "type": "string" },
            "openIssueCount":     { "type": "number" }
          }
        }
      }
    },
    "required": ["rows"]
  }
}
```

---

### `getFeedSyncHistory`

Returns recent sync events for a SKU on a channel.

```json
{
  "name": "getFeedSyncHistory",
  "description": "Returns the recent synchronization history for a SKU on a channel, up to 90 days back.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "skuId":       { "type": "string" },
      "channelId":   { "type": "string" },
      "accountName": { "type": "string" },
      "limit":       { "type": "number", "minimum": 1, "maximum": 100, "default": 20 },
      "since":       { "type": "string", "description": "ISO 8601 — return events after this timestamp" }
    },
    "required": ["skuId", "channelId", "accountName"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "events": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "syncAt":           { "type": "string" },
            "syncStatus":       { "type": "string" },
            "sellingPrice":     { "type": "number" },
            "sellableQuantity": { "type": "number" },
            "isAvailable":      { "type": "boolean" },
            "feedVersion":      { "type": "string" },
            "error":            { "type": "string", "nullable": true }
          }
        }
      }
    },
    "required": ["events"]
  }
}
```

---

### `simulateProductFeed`

Runs the full resolution pipeline with custom parameters without affecting live state.

```json
{
  "name": "simulateProductFeed",
  "description": "Runs the full feed resolution pipeline for a SKU with optional parameter overrides, without persisting the result or dispatching to any connector. Always returns isHypothetical: true.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "skuId":       { "type": "string" },
      "channelId":   { "type": "string" },
      "accountName": { "type": "string" },
      "overrides": {
        "type": "object",
        "properties": {
          "country":                    { "type": "string" },
          "representativePostalCode":   { "type": "string" },
          "minimumStock":               { "type": "number" }
        }
      }
    },
    "required": ["skuId", "channelId", "accountName"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "productFeed":      { "$ref": "#/definitions/ProductFeed" },
      "simulationParams": {
        "type": "object",
        "properties": {
          "country":    { "type": "string" },
          "postalCode": { "type": "string" }
        }
      },
      "isHypothetical": { "type": "boolean", "enum": [true] }
    },
    "required": ["productFeed", "simulationParams", "isHypothetical"]
  }
}
```

---

## Action Tools (write side effects)

---

### `retryFeedSync`

Manually enqueues a re-sync for a single SKU on a single channel.

```json
{
  "name": "retryFeedSync",
  "description": "Manually enqueues a re-sync for a single SKU on a single channel. Rate-limited to 1 call per (skuId, channelId) per 60 seconds.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "skuId":       { "type": "string" },
      "channelId":   { "type": "string" },
      "accountName": { "type": "string" },
      "syncType":    { "type": "string", "enum": ["catalog","price","stock","full"] }
    },
    "required": ["skuId", "channelId", "accountName", "syncType"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "enqueued":              { "type": "boolean" },
      "estimatedProcessingMs": { "type": "number" },
      "idempotencyKey":        { "type": "string" },
      "reason":                { "type": "string", "description": "Populated when enqueued: false (rate limited or already in-flight)" }
    },
    "required": ["enqueued", "idempotencyKey"]
  }
}
```

---

## Shared Type Definitions

```typescript
// EligibilityCheck — used in explainOfferAvailability breakdown
interface EligibilityCheck {
  pass:   boolean;
  detail: string;   // human-readable reason
}

// MappingEntry — used in getMarketplaceMappingStatus
interface MappingEntry {
  vtexSpecName:     string;
  vtexSpecValue:    string;
  channelAttrId:    string | null;
  channelAttrValue: string | null;
  mapped:           boolean;
}

// MissingMapping — used in getMarketplaceMappingStatus
interface MissingMapping {
  type:           "category" | "attribute_value";
  vtexValue:      string;
  channelAttrId?: string;
}

// OfferIssue — used in listProductFeedIssues
interface OfferIssue {
  issueId:     string;
  accountName: string;
  channelId:   string;
  skuId:       string;
  issueType:   IssueType;
  severity:    "error" | "warning" | "info";
  description: string;
  source:      "platform" | "connector" | "marketplace";
  createdAt:   string;
  resolvedAt:  string | null;
  resolved:    boolean;
}
```
