import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '../config/aws';
import { env } from '../config/env';
import { FeedState, SyncStatus } from '../types';

const TABLE = env.DYNAMODB_TABLE;

function pk(accountName: string, channelId: string): string {
  return `ACCT#${accountName}#CHAN#${channelId}`;
}

function sk(skuId: string): string {
  return `SKU#${skuId}`;
}

export async function getFeedState(
  accountName: string,
  channelId: string,
  skuId: string
): Promise<FeedState | null> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: pk(accountName, channelId), SK: sk(skuId) },
    })
  );
  return result.Item ? (result.Item as FeedState) : null;
}

export async function upsertFeedState(state: FeedState): Promise<void> {
  const { accountName, channelId, skuId } = state;
  const now = new Date().toISOString();

  await dynamoClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: pk(accountName, channelId),
        SK: sk(skuId),
        // GSI-2 for cross-channel comparison (sparse — only on FeedState records)
        gsi2pk: `ACCT#${accountName}#SKU#${skuId}`,
        gsi2sk: `CHAN#${channelId}`,
        ...state,
        updatedAt: now,
      },
    })
  );
}

export async function updateSyncStatus(
  accountName: string,
  channelId: string,
  skuId: string,
  syncStatus: SyncStatus,
  extra?: Partial<FeedState>
): Promise<void> {
  const now = new Date().toISOString();
  await dynamoClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk(accountName, channelId), SK: sk(skuId) },
      UpdateExpression:
        'SET syncStatus = :s, updatedAt = :t' +
        (extra?.lastError !== undefined ? ', lastError = :e' : '') +
        (extra?.retryCount !== undefined ? ', retryCount = :r' : '') +
        (extra?.lastSyncAt !== undefined ? ', lastSyncAt = :la' : '') +
        (extra?.lastSuccessfulSyncAt !== undefined ? ', lastSuccessfulSyncAt = :lsa' : ''),
      ExpressionAttributeValues: {
        ':s': syncStatus,
        ':t': now,
        ...(extra?.lastError !== undefined ? { ':e': extra.lastError } : {}),
        ...(extra?.retryCount !== undefined ? { ':r': extra.retryCount } : {}),
        ...(extra?.lastSyncAt !== undefined ? { ':la': extra.lastSyncAt } : {}),
        ...(extra?.lastSuccessfulSyncAt !== undefined ? { ':lsa': extra.lastSuccessfulSyncAt } : {}),
      },
    })
  );
}
