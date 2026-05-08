import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '../config/aws';
import { env } from '../config/env';
import { OfferIssue, IssueType, IssueSeverity } from '../types';

const TABLE = env.DYNAMODB_TABLE;
const TTL_30_DAYS_SECONDS = 30 * 24 * 60 * 60;

function pk(accountName: string, channelId: string): string {
  return `ACCT#${accountName}#CHAN#${channelId}`;
}

function gsi1pk(accountName: string, channelId: string): string {
  return `ACCT#${accountName}#CHAN#${channelId}#ISSUES`;
}

function gsi1sk(severity: IssueSeverity, issueType: IssueType, issueId: string): string {
  return `${severity}#${issueType}#${issueId}`;
}

export async function createIssue(issue: OfferIssue): Promise<void> {
  await dynamoClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: pk(issue.accountName, issue.channelId),
        SK: `ISSUE#${issue.issueId}`,
        gsi1pk: gsi1pk(issue.accountName, issue.channelId),
        gsi1sk: gsi1sk(issue.severity, issue.issueType, issue.issueId),
        ...issue,
      },
      ConditionExpression: 'attribute_not_exists(PK)', // don't overwrite existing
    })
  ).catch((err) => {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
    // Issue already exists — idempotent, ignore
  });
}

export async function resolveIssue(
  accountName: string,
  channelId: string,
  issueId: string
): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + TTL_30_DAYS_SECONDS;

  await dynamoClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: {
        PK: pk(accountName, channelId),
        SK: `ISSUE#${issueId}`,
      },
      UpdateExpression: 'SET resolved = :t, resolvedAt = :at, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':t': true,
        ':at': now,
        ':ttl': ttl,
      },
    })
  );
}

export interface IssueListFilters {
  severity?: IssueSeverity;
  issueType?: IssueType;
  skuId?: string;
  limit?: number;
  cursor?: string;
}

export interface IssueListResult {
  issues: OfferIssue[];
  nextCursor?: string;
}

export async function listIssuesByChannel(
  accountName: string,
  channelId: string,
  filters: IssueListFilters = {}
): Promise<IssueListResult> {
  const { severity, issueType, skuId, limit = 20, cursor } = filters;
  const now = Math.floor(Date.now() / 1000);

  // Build SK prefix for GSI-1 filtering
  let skPrefix = '';
  if (severity && issueType) {
    skPrefix = `${severity}#${issueType}#`;
  } else if (severity) {
    skPrefix = `${severity}#`;
  }

  const params = {
    TableName: TABLE,
    IndexName: 'GSI-1',
    KeyConditionExpression: skPrefix
      ? 'gsi1pk = :pk AND begins_with(gsi1sk, :skPrefix)'
      : 'gsi1pk = :pk',
    FilterExpression: 'resolved = :f AND #ttl > :now' + (skuId ? ' AND skuId = :skuId' : ''),
    ExpressionAttributeNames: { '#ttl': 'ttl' },
    ExpressionAttributeValues: {
      ':pk': gsi1pk(accountName, channelId),
      ':f': false,
      ':now': now,
      ...(skPrefix ? { ':skPrefix': skPrefix } : {}),
      ...(skuId ? { ':skuId': skuId } : {}),
    },
    Limit: limit,
    ...(cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64').toString()) } : {}),
  };

  const result = await dynamoClient.send(new QueryCommand(params));

  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return {
    issues: (result.Items ?? []) as OfferIssue[],
    nextCursor,
  };
}
