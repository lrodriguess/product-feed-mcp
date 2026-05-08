import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '../config/aws';
import { env } from '../config/env';
import { SyncEvent } from '../types';

const TABLE = env.DYNAMODB_TABLE;
const TTL_90_DAYS_SECONDS = 90 * 24 * 60 * 60;

function pk(accountName: string, channelId: string): string {
  return `ACCT#${accountName}#CHAN#${channelId}`;
}

export async function writeSyncEvent(event: Omit<SyncEvent, 'ttl'>): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + TTL_90_DAYS_SECONDS;
  const sk = `SYNC#${event.syncAt}#${event.skuId}`;

  await dynamoClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: pk(event.accountName, event.channelId),
        SK: sk,
        ...event,
        ttl,
      },
    })
  );
}

export async function querySyncHistory(
  accountName: string,
  channelId: string,
  skuId: string,
  options: { since?: string; limit?: number } = {}
): Promise<SyncEvent[]> {
  const { since, limit = 20 } = options;
  const now = Math.floor(Date.now() / 1000);

  const skPrefix = since
    ? `SYNC#${since}#${skuId}`
    : `SYNC#`;

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: '#ttl > :now',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':pk': pk(accountName, channelId),
        ':skPrefix': skPrefix,
        ':now': now,
      },
      Limit: limit,
      ScanIndexForward: false, // newest first
    })
  );

  return (result.Items ?? []) as SyncEvent[];
}
