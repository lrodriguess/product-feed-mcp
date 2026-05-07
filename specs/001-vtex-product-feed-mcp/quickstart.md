# Quickstart — VTEX Product Feed MCP

## Prerequisites

| Dependency | Version | Purpose |
|------------|---------|---------|
| Node.js | ≥ 20 | Runtime |
| npm / yarn | any | Package manager |
| AWS CLI | ≥ 2 | SQS queue management |
| Redis | ≥ 7 | Dedup + Mapping Cache |
| DynamoDB Local | latest | Local Feed State Store |

---

## 1. Install dependencies

```bash
yarn install
# or
npm install
```

---

## 2. Start local infrastructure

```bash
# DynamoDB Local
docker run -p 8000:8000 amazon/dynamodb-local

# Redis
docker run -p 6379:6379 redis:7

# LocalStack (SQS)
docker run -p 4566:4566 localstack/localstack
```

---

## 3. Configure environment

Copy `.env.example` to `.env` and fill in:

```env
# VTEX
VTEX_ACCOUNT=mystore
VTEX_APP_KEY=your-app-key
VTEX_APP_TOKEN=your-app-token

# AWS / SQS
AWS_REGION=us-east-1
AWS_ENDPOINT=http://localhost:4566    # LocalStack; remove for production
SQS_QUEUE_PREFIX=vtex-feed

# DynamoDB
DYNAMODB_ENDPOINT=http://localhost:8000   # remove for production
DYNAMODB_TABLE=vtex-product-feed
DYNAMODB_CHANNEL_CONFIG_TABLE=vtex-channel-config

# Redis
REDIS_URL=redis://localhost:6379

# MCP Server
MCP_PORT=3000
MCP_SESSION_SECRET=change-me-in-production
```

---

## 4. Bootstrap DynamoDB tables

```bash
yarn db:bootstrap
# Creates vtex-product-feed (main table + GSI-1 + GSI-2) and vtex-channel-config
```

---

## 5. Register a test channel

```bash
curl -X POST http://localhost:3000/channels \
  -H "Content-Type: application/json" \
  -H "X-VTEX-API-AppKey: $VTEX_APP_KEY" \
  -H "X-VTEX-API-AppToken: $VTEX_APP_TOKEN" \
  -d '{
    "channelId": "test-channel",
    "connectorType": "marketplace",
    "accountName": "mystore",
    "salesChannel": 1,
    "tradePolicy": "1",
    "country": "BRA",
    "representativePostalCode": "01310-100",
    "currency": "BRL",
    "dedupTtlSeconds": { "catalog": 1800, "price": 3600, "stock": 300 },
    "minimumStock": 1,
    "maxRetries": 5,
    "dispatchEndpoint": "http://localhost:4000/dispatch",
    "active": true
  }'
```

---

## 6. Start the platform

```bash
yarn dev
# Starts: MCP HTTP server on :3000, SQS consumers, Broadcaster ingestion endpoint
```

---

## 7. Test an MCP tool call

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-VTEX-API-AppKey: $VTEX_APP_KEY" \
  -H "X-VTEX-API-AppToken: $VTEX_APP_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "getProductFeedState",
      "arguments": {
        "skuId": "1001",
        "channelId": "test-channel",
        "accountName": "mystore"
      }
    }
  }'
```

---

## 8. Simulate a Broadcaster event

```bash
curl -X POST http://localhost:3000/internal/broadcaster/mystore \
  -H "Content-Type: application/json" \
  -d '{
    "Domain": "Logistics",
    "ActionName": "StockChange",
    "IdSku": "1001",
    "An": "mystore",
    "HasStockKeepingUnitModified": false
  }'
```

This enqueues the event → triggers the 10-step pipeline → writes result to DynamoDB.

---

## Key scripts

| Script | Description |
|--------|-------------|
| `yarn dev` | Start platform in watch mode |
| `yarn build` | Compile TypeScript |
| `yarn test` | Run unit + integration tests |
| `yarn db:bootstrap` | Create DynamoDB tables locally |
| `yarn db:seed` | Seed test channel config and sample feed state |
| `yarn simulate:event` | Send a test Broadcaster event to local server |
