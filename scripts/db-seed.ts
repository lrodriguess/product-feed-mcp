/**
 * Seeds local DynamoDB with test data for development and integration testing.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

dotenv.config();

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
    },
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

const MAIN_TABLE = process.env.DYNAMODB_TABLE ?? 'vtex-product-feed';
const CONFIG_TABLE = process.env.DYNAMODB_CHANNEL_CONFIG_TABLE ?? 'vtex-channel-config';

async function main(): Promise<void> {
  console.log('[Seed] Seeding test data...');

  // Seed channel config
  await client.send(new PutCommand({
    TableName: CONFIG_TABLE,
    Item: {
      channelId: 'test-channel',
      connectorType: 'marketplace',
      accountName: 'mystore',
      salesChannel: 1,
      tradePolicy: '1',
      country: 'BRA',
      representativePostalCode: '01310-100',
      currency: 'BRL',
      dedupTtlSeconds: { catalog: 1800, price: 3600, stock: 300 },
      minimumStock: 1,
      maxRetries: 5,
      dispatchEndpoint: 'http://localhost:4000/dispatch',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }));
  console.log('[Seed] ✓ ChannelConfig: test-channel');

  // Seed feed state
  await client.send(new PutCommand({
    TableName: MAIN_TABLE,
    Item: {
      PK: 'ACCT#mystore#CHAN#test-channel',
      SK: 'SKU#1001',
      gsi2pk: 'ACCT#mystore#SKU#1001',
      gsi2sk: 'CHAN#test-channel',
      accountName: 'mystore',
      channelId: 'test-channel',
      skuId: '1001',
      syncStatus: 'synced',
      sellingPrice: 9990,
      listPrice: 12990,
      currency: 'BRL',
      sellableQuantity: 45,
      isAvailable: true,
      unavailableReason: null,
      feedVersion: 'sha256:abc123',
      lastSyncAt: new Date().toISOString(),
      lastSuccessfulSyncAt: new Date().toISOString(),
      openIssueCount: 0,
      retryCount: 0,
      priceResolvedAt: new Date().toISOString(),
      stockResolvedAt: new Date().toISOString(),
      contentResolvedAt: new Date().toISOString(),
      simulationCountry: 'BRA',
      simulationPostalCode: '01310-100',
      updatedAt: new Date().toISOString(),
    },
  }));
  console.log('[Seed] ✓ FeedState: SKU 1001 on test-channel (synced)');

  // Seed 5 open OfferIssue records
  const issueTypes = ['DISPATCH_ERROR', 'MISSING_MAPPING', 'ZERO_STOCK', 'SIMULATION_ERROR', 'CONTENT_FETCH_ERROR'];
  for (const issueType of issueTypes) {
    const issueId = uuidv4();
    await client.send(new PutCommand({
      TableName: MAIN_TABLE,
      Item: {
        PK: 'ACCT#mystore#CHAN#test-channel',
        SK: `ISSUE#${issueId}`,
        gsi1pk: 'ACCT#mystore#CHAN#test-channel#ISSUES',
        gsi1sk: `error#${issueType}#${issueId}`,
        issueId,
        accountName: 'mystore',
        channelId: 'test-channel',
        skuId: `100${issueTypes.indexOf(issueType) + 1}`,
        issueType,
        severity: 'error',
        description: `Test issue: ${issueType}`,
        source: 'platform',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        resolved: false,
      },
    }));
  }
  console.log('[Seed] ✓ 5 OfferIssue records');

  console.log('[Seed] Complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
