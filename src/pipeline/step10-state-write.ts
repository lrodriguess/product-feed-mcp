import { upsertFeedState } from '../store/feed-state';
import { writeSyncEvent } from '../store/sync-event';
import { writeBridgeDocument } from '../clients/vtex-bridge';
import { ProductFeed, ChannelConfig, FeedState, SyncStatus } from '../types';

export async function writeOutcome(params: {
  feed: ProductFeed;
  channel: ChannelConfig;
  dispatchResult: unknown;
  syncStatus: SyncStatus;
  error?: string;
  retryCount?: number;
}): Promise<void> {
  const { feed, channel, dispatchResult, syncStatus, error, retryCount = 0 } = params;
  const now = new Date().toISOString();

  const { skuId } = feed.identity;
  const { accountName, channelId } = channel;

  // Write FeedState
  const feedState: FeedState = {
    accountName,
    channelId,
    skuId,
    syncStatus,
    sellingPrice: feed.price.sellingPrice,
    listPrice: feed.price.listPrice,
    currency: feed.price.currency,
    sellableQuantity: feed.inventory.sellableQuantity,
    isAvailable: feed.availability.isAvailable,
    unavailableReason: feed.availability.unavailableReason ?? undefined,
    feedVersion: feed.identity.feedVersion,
    lastSyncAt: now,
    lastSuccessfulSyncAt: syncStatus === 'synced' ? now : undefined,
    lastError: error,
    openIssueCount: 0,
    retryCount,
    priceResolvedAt: feed.price.resolvedAt,
    stockResolvedAt: feed.inventory.resolvedAt,
    contentResolvedAt: feed.catalogContent.contentUpdatedAt,
    simulationCountry: feed.price.simulationCountry,
    simulationPostalCode: feed.price.simulationPostalCode,
    updatedAt: now,
  };

  await upsertFeedState(feedState);

  // Write SyncEvent history record
  await writeSyncEvent({
    accountName,
    channelId,
    skuId,
    syncAt: now,
    syncStatus,
    sellingPrice: feed.price.sellingPrice,
    sellableQuantity: feed.inventory.sellableQuantity,
    isAvailable: feed.availability.isAvailable,
    feedVersion: feed.identity.feedVersion,
    error,
  });

  // Write Bridge document (best-effort)
  await writeBridgeDocument({
    skuId,
    accountName,
    channelId,
    status: syncStatus === 'synced' ? 'Success' : syncStatus === 'error' ? 'Error' : 'Warning',
    type: 'Availability',
    message: error ?? `syncStatus=${syncStatus}`,
    timestamp: now,
  });
}
