import { z } from 'zod';
import { getFeedState } from '../../store/feed-state';
import { getChannelConfigById } from '../../channels/channel-config.repository';
import { FeedState } from '../../types';

export const getProductFeedStateSchema = z.object({
  skuId: z.string(),
  channelId: z.string(),
  accountName: z.string(),
});

export type GetProductFeedStateInput = z.infer<typeof getProductFeedStateSchema>;

interface DataFreshness {
  priceAgeSeconds: number;
  stockAgeSeconds: number;
  contentAgeSeconds: number;
  isStale: boolean;
}

function computeAge(resolvedAt: string | undefined): number {
  if (!resolvedAt) return Infinity;
  return Math.floor((Date.now() - new Date(resolvedAt).getTime()) / 1000);
}

function computeFreshness(state: FeedState, channel: { dedupTtlSeconds: { price: number; stock: number; catalog: number } }): DataFreshness {
  const priceAgeSeconds = computeAge(state.priceResolvedAt);
  const stockAgeSeconds = computeAge(state.stockResolvedAt);
  const contentAgeSeconds = computeAge(state.contentResolvedAt);

  const isStale =
    priceAgeSeconds > channel.dedupTtlSeconds.price ||
    stockAgeSeconds > channel.dedupTtlSeconds.stock ||
    contentAgeSeconds > channel.dedupTtlSeconds.catalog;

  return { priceAgeSeconds, stockAgeSeconds, contentAgeSeconds, isStale };
}

export async function handleGetProductFeedState(input: GetProductFeedStateInput): Promise<unknown> {
  const { skuId, channelId, accountName } = input;

  const [state, channel] = await Promise.all([
    getFeedState(accountName, channelId, skuId),
    getChannelConfigById(channelId),
  ]);

  if (!state || !channel) {
    return {
      isError: true,
      content: [{ type: 'text', text: `No feed state found for SKU ${skuId} on channel ${channelId}` }],
    };
  }

  const dataFreshness = computeFreshness(state, channel);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ feedState: state, dataFreshness }, null, 2),
      },
    ],
  };
}
