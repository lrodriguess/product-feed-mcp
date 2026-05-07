# VTEX Broadcaster Webhook Contract

The platform registers a webhook with VTEX Broadcaster for each `accountName`. VTEX Broadcaster POSTs events to the platform's ingestion endpoint when catalog, price, or stock data changes.

---

## Platform ingestion endpoint

```
POST /internal/broadcaster/{accountName}
```

---

## Incoming event format (VTEX Broadcaster payload)

```json
{
  "Domain":    "Catalog",
  "ActionName": "StockChange",
  "IdSku":     "1001",
  "An":        "mystore",
  "HasStockKeepingUnitModified": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `Domain` | String | `Catalog` \| `Pricing` \| `Logistics` |
| `ActionName` | String | Event subtype (e.g., `StockChange`, `PriceChange`, `SkuUpdate`) |
| `IdSku` | String | VTEX SKU ID |
| `An` | String | VTEX account name |
| `HasStockKeepingUnitModified` | Boolean | Set when SKU data itself changed (triggers enrichment cache invalidation) |

---

## Event routing

| `Domain` | `ActionName` | SQS queue suffix |
|----------|--------------|-----------------|
| `Catalog` | `SkuUpdate`, `ProductUpdate` | `catalog` |
| `Pricing` | `PriceChange` | `price` |
| `Logistics` | `StockChange` | `stock` |

**Queue naming:** `vtex-feed-{accountName}-{suffix}` (e.g., `vtex-feed-mystore-stock`)

---

## Platform ingestion behavior

1. Validate request (signature if provided by Broadcaster).
2. Extract `accountName` (`An`), `skuId` (`IdSku`), `eventType` (derived from `Domain`).
3. Apply dedup: `SET NX dedup:{accountName}:{skuId}:{eventType}` with TTL from channel config. If key exists, discard event (return HTTP 200 immediately).
4. Enqueue message to the appropriate SQS queue.
5. Return HTTP 200.

All processing happens asynchronously after enqueue. The platform never blocks Broadcaster delivery on downstream processing.
