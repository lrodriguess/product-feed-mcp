/**
 * MCP Tool: getFeedSyncHistory (T066)
 * Returns paginated sync event history for a SKU on a channel.
 */
import { z } from 'zod';
import { querySyncHistory } from '../../store/sync-event';

export const getFeedSyncHistorySchema = z.object({
  accountName: z.string().describe('VTEX account name'),
  channelId: z.string().describe('Target marketplace channel ID'),
  skuId: z.string().describe('VTEX SKU ID'),
  since: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp — return events at or after this time'),
  limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of events to return'),
});

export type GetFeedSyncHistoryInput = z.infer<typeof getFeedSyncHistorySchema>;

export async function handleGetFeedSyncHistory(
  args: GetFeedSyncHistoryInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { accountName, channelId, skuId, since, limit } = args;

  const events = await querySyncHistory(accountName, channelId, skuId, { since, limit });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          accountName,
          channelId,
          skuId,
          count: events.length,
          events: events.map((e) => ({
            syncAt: e.syncAt,
            syncStatus: e.syncStatus,
            sellingPrice: e.sellingPrice ?? null,
            sellableQuantity: e.sellableQuantity ?? null,
            isAvailable: e.isAvailable ?? null,
            feedVersion: e.feedVersion ?? null,
            error: e.error ?? null,
          })),
        }),
      },
    ],
  };
}
