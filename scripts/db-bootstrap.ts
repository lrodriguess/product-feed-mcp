import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
  },
});

async function tableExists(tableName: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch {
    return false;
  }
}

async function createMainTable(): Promise<void> {
  const tableName = process.env.DYNAMODB_TABLE ?? 'vtex-product-feed';
  if (await tableExists(tableName)) {
    console.log(`[DynamoDB] Table already exists: ${tableName}`);
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'gsi1pk', AttributeType: 'S' },
        { AttributeName: 'gsi1sk', AttributeType: 'S' },
        { AttributeName: 'gsi2pk', AttributeType: 'S' },
        { AttributeName: 'gsi2sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI-1',
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI-2',
          KeySchema: [
            { AttributeName: 'gsi2pk', KeyType: 'HASH' },
            { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
          ],
          Projection: {
            ProjectionType: 'INCLUDE',
            NonKeyAttributes: [
              'accountName', 'channelId', 'skuId',
              'sellingPrice', 'currency', 'sellableQuantity',
              'isAvailable', 'unavailableReason', 'syncStatus',
              'lastSyncAt', 'openIssueCount',
            ],
          },
        },
      ],
      // TTL configuration
    })
  );

  console.log(`[DynamoDB] Created table: ${tableName} (with GSI-1 and GSI-2)`);
}

async function createChannelConfigTable(): Promise<void> {
  const tableName = process.env.DYNAMODB_CHANNEL_CONFIG_TABLE ?? 'vtex-channel-config';
  if (await tableExists(tableName)) {
    console.log(`[DynamoDB] Table already exists: ${tableName}`);
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'channelId', AttributeType: 'S' },
        { AttributeName: 'accountName', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'channelId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'AccountName-Index',
          KeySchema: [{ AttributeName: 'accountName', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    })
  );

  console.log(`[DynamoDB] Created table: ${tableName}`);
}

async function main(): Promise<void> {
  console.log('[DynamoDB] Bootstrapping tables...');
  await createMainTable();
  await createChannelConfigTable();
  console.log('[DynamoDB] Bootstrap complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[DynamoDB] Bootstrap failed:', err);
  process.exit(1);
});
