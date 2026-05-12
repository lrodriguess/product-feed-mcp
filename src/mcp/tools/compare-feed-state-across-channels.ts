/**
 * MCP Tool: compareFeedStateAcrossChannels (T065)
 * Queries GSI-2 to return feed state for a SKU across all channels.
 */
import { z } from 'zod';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '../../config/aws';
import { env } from '../../config/env';
import { FeedState } from '../../types';

export const compareFeedStateAcrossChannelsSchema = z.object({
  accountName: z.string().describe('VTEX account name'),
  skuId: z.string().describe('VTEX SKU ID to compare across channels'),
});

export type CompareFeedStateAcrossChannelsInput = z.infer<
  typeof compareFeedStateAcrossChannelsSchema
>;

export async function handleCompareFeedStateAcrossChannels(
  args: CompareFeedStateAcrossChannelsInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { accountName, skuId } = args;

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: env.DYNAMODB_TABLE,
      IndexName: 'GSI-2',
      KeyConditionExpression: 'gsi2pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `ACCT#${accountName}#SKU#${skuId}`,
      },
    })
  );

  const states = (result.Items ?? []) as FeedState[];

  const rows = states.map((s) => ({
    channelId: s.channelId,
    syncStatus: s.syncStatus,
    isAvailable: s.isAvailable ?? null,
    sellingPrice: s.sellingPrice ?? null,
    currency: s.currency ?? null,
    sellableQuantity: s.sellableQuantity ?? null,
    openIssueCount: s.openIssueCount,
    lastSyncAt: s.lastSyncAt ?? null,
    lastSuccessfulSyncAt: s.lastSuccessfulSyncAt ?? null,
    unavailableReason: s.unavailableReason ?? null,
    feedVersion: s.feedVersion ?? null,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          accountName,
          skuId,
          channelCount: rows.length,
          rows,
        }),
      },
    ],
  };
}
