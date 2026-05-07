# Connector API Contract — VTEX Product Feed MCP

Every connector adapter must implement this HTTP contract to integrate with the platform. The platform calls the connector; the connector does not call the platform.

---

## Required Endpoints

### `POST {dispatchEndpoint}` — Receive product feed dispatch

The platform calls this endpoint when a `ProductFeed` is ready to be dispatched.

**Request headers:**
```
Content-Type: application/json
X-Dispatch-Id: {uuid}
X-Channel-Id: {channelId}
X-Platform-Signature: {hmac-sha256 of body, keyed to connector secret}
```

**Request body:**
```json
{
  "dispatchId":   "uuid",
  "channelId":    "my-connector-us",
  "productFeed":  { ...ProductFeed object... },
  "connectorContext": { ...additional VTEX data declared by connector... },
  "dispatchedAt": "ISO-8601"
}
```

**Response — success (HTTP 200):**
```json
{
  "dispatchId":      "uuid",
  "status":          "success",
  "externalOfferId": "marketplace-listing-id",
  "errorCode":       null,
  "errorMessage":    null,
  "retryable":       false,
  "processedAt":     "ISO-8601"
}
```

**Response — retryable error (HTTP 200 with `status: "retry"`):**
```json
{
  "dispatchId":   "uuid",
  "status":       "retry",
  "externalOfferId": null,
  "errorCode":    "MARKETPLACE_RATE_LIMITED",
  "errorMessage": "Marketplace API returned 429",
  "retryable":    true,
  "processedAt":  "ISO-8601"
}
```

**Response — permanent error (HTTP 200 with `status: "error"`):**
```json
{
  "dispatchId":   "uuid",
  "status":       "error",
  "externalOfferId": null,
  "errorCode":    "INVALID_CATEGORY",
  "errorMessage": "Channel category CAT-001 does not exist in marketplace",
  "retryable":    false,
  "processedAt":  "ISO-8601"
}
```

**Rules:**
- Always return HTTP 200 with a `DispatchResult` body. Use `status` field for outcome, not HTTP status codes (except for connectivity failures).
- Never return `status: "success"` before the marketplace API call is confirmed.
- HTTP 4xx/5xx responses are treated as `retry` by the platform.

---

### `GET /health` — Liveness check

```
HTTP 200 OK
Body: { "status": "ok" }
```

The platform calls `/health` before each dispatch. A non-200 response causes the dispatch to be re-queued rather than attempted.

---

### `GET /config/stock-adjustment-hook` — Declare stock adjustment logic (optional)

If the connector needs to apply marketplace-specific stock transformations (cap, warehouse exclusion, pickup addition), it declares a hook here.

**Response (HTTP 200):**
```json
{
  "enabled": true,
  "description": "Cap sellableQuantity at 999 per marketplace rule",
  "endpoint": "{connectorBaseUrl}/hooks/stock-adjustment"
}
```

If the connector does not implement this, return HTTP 404 or `{ "enabled": false }`.

**Hook call from platform (POST to declared endpoint):**
```json
{
  "rawSimulatedStock": 1500,
  "channelConfig":     { ...ChannelConfig... }
}
```

**Hook response:**
```json
{
  "adjustedStock": 999
}
```

**Constraint:** `adjustedStock` must not exceed `rawSimulatedStock`. The platform enforces this and ignores values above the simulated stock.

---

## What the connector must NOT do

- Call VTEX Catalog, Pricing, Inventory, or Checkout Simulation APIs.
- Recompute `isAvailable` or `sellableQuantity` from raw VTEX data.
- Maintain its own deduplication state for platform-dispatched events.
- Call VTEX Mapper to resolve category or attribute mappings (already resolved in `productFeed.mapping`).
- Store feed history — the platform owns the Feed State Store.

---

## Connector registration payload (sent to platform channel config endpoint)

```json
{
  "channelId":                 "my-connector-us",
  "connectorType":             "marketplace",
  "accountName":               "mystore",
  "salesChannel":              2,
  "tradePolicy":               "2",
  "affiliateId":               null,
  "country":                   "USA",
  "representativePostalCode":  "10001",
  "currency":                  "USD",
  "dedupTtlSeconds": {
    "catalog": 1800,
    "price":   3600,
    "stock":   300
  },
  "minimumStock":    5,
  "maxRetries":      5,
  "dispatchEndpoint": "https://my-connector.example.com/dispatch",
  "active":          true
}
```
