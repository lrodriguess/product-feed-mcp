import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '../config/aws';
import { env } from '../config/env';
import { ChannelConfig } from '../types';

const TABLE = env.DYNAMODB_CHANNEL_CONFIG_TABLE;

export async function createChannelConfig(config: ChannelConfig): Promise<void> {
  const now = new Date().toISOString();
  await dynamoClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: { ...config, createdAt: now, updatedAt: now },
      ConditionExpression: 'attribute_not_exists(channelId)',
    })
  );
}

export async function getChannelConfigById(channelId: string): Promise<ChannelConfig | null> {
  const result = await dynamoClient.send(
    new GetCommand({ TableName: TABLE, Key: { channelId } })
  );
  return result.Item ? (result.Item as ChannelConfig) : null;
}

export async function updateChannelConfig(
  channelId: string,
  patch: Partial<ChannelConfig>
): Promise<void> {
  const now = new Date().toISOString();
  const fields = { ...patch, updatedAt: now };
  const setClauses = Object.keys(fields).map((k) => `#${k} = :${k}`);
  const names = Object.fromEntries(Object.keys(fields).map((k) => [`#${k}`, k]));
  const values = Object.fromEntries(Object.keys(fields).map((k) => [`:${k}`, (fields as Record<string, unknown>)[k]]));

  await dynamoClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { channelId },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(channelId)',
    })
  );
}

export async function listChannelConfigsByAccount(accountName: string): Promise<ChannelConfig[]> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'AccountName-Index',
      KeyConditionExpression: 'accountName = :an',
      ExpressionAttributeValues: { ':an': accountName },
    })
  );
  return (result.Items ?? []) as ChannelConfig[];
}

export async function listActiveChannelConfigsByAccount(accountName: string): Promise<ChannelConfig[]> {
  const all = await listChannelConfigsByAccount(accountName);
  return all.filter((c) => c.active);
}
