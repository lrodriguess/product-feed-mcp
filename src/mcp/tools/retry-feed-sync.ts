/**
 * MCP Tool: retryFeedSync (T063)
 * Manually triggers a re-sync for a single SKU with rate limiting and in-flight guard.
 */
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../../config/redis';
import { getFeedState } from '../../store/feed-state';
import { enqueue } from '../../sqs/client';

const RATE_LIMIT_TTL_SECONDS = 60;
const ESTIMATED_PROCESSING_MS = 5000;

export const retryFeedSyncSchema = z.object({
  accountName: z.string().describe('VTEX account name'),
  channelId: z.string().describe('Target marketplace channel ID'),
  skuId: z.string().describe('VTEX SKU ID to re-sync'),
});

export type RetryFeedSyncInput = z.infer<typeof retryFeedSyncSchema>;

export async function handleRetryFeedSync(
  args: RetryFeedSyncInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { accountName, channelId, skuId } = args;

  // Check if already in_flight
  const feedState = await getFeedState(accountName, channelId, skuId);
  if (feedState?.syncStatus === 'in_flight') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            enqueued: false,
            reason: 'already_in_flight',
            idempotencyKey: null,
            estimatedProcessingMs: null,
          }),
        },
      ],
    };
  }

  // Rate limit: one retry per 60s per (accountName, channelId, skuId)
  const rateLimitKey = `retry-rate:${accountName}:${channelId}:${skuId}`;
  const redis = getRedis();
  const acquired = await redis.set(rateLimitKey, '1', 'EX', RATE_LIMIT_TTL_SECONDS, 'NX');

  if (!acquired) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            enqueued: false,
            reason: 'rate_limited',
            idempotencyKey: null,
            estimatedProcessingMs: null,
          }),
        },
      ],
    };
  }

  const idempotencyKey = uuidv4();

  await enqueue(accountName, 'catalog', {
    accountName,
    channelId,
    skuId,
    eventType: 'catalog',
    receivedAt: new Date().toISOString(),
    idempotencyKey,
    source: 'manual_retry',
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          enqueued: true,
          reason: null,
          idempotencyKey,
          estimatedProcessingMs: ESTIMATED_PROCESSING_MS,
        }),
      },
    ],
  };
}
