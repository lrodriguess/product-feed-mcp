import { createHash } from 'crypto';
import {
  ProductFeed,
  CatalogContent,
  MappingResult,
  PriceResult,
  InventoryResult,
  AvailabilityResult,
  ChannelConfig,
} from '../types';

export function assembleFeed(params: {
  skuId: string;
  productId: string;
  channel: ChannelConfig;
  catalogContent: CatalogContent;
  mapping: MappingResult;
  price: PriceResult;
  inventory: InventoryResult;
  availability: AvailabilityResult;
  lastDispatchedVersion?: string;
}): { feed: ProductFeed; isUnchanged: boolean } {
  const {
    skuId,
    productId,
    channel,
    catalogContent,
    mapping,
    price,
    inventory,
    availability,
    lastDispatchedVersion,
  } = params;

  const now = new Date().toISOString();

  // Compute feedVersion as SHA-256 of key fields
  const versionInput = JSON.stringify({
    contentVersion: catalogContent.contentVersion,
    sellingPrice: price.sellingPrice,
    sellableQuantity: inventory.sellableQuantity,
    isAvailable: availability.isAvailable,
    unavailableReason: availability.unavailableReason,
  });
  const feedVersion = `sha256:${createHash('sha256').update(versionInput).digest('hex')}`;

  const isUnchanged = feedVersion === lastDispatchedVersion;

  const feed: ProductFeed = {
    identity: {
      accountName: channel.accountName,
      salesChannel: channel.salesChannel,
      tradePolicy: channel.tradePolicy,
      channelId: channel.channelId,
      productId,
      skuId,
      feedVersion,
      assembledAt: now,
    },
    catalogContent,
    mapping,
    price,
    inventory,
    availability,
    feedState: {
      syncStatus: 'in_flight',
      lastSyncAt: now,
      lastSuccessfulSyncAt: null,
      lastError: null,
      openIssues: [],
      retryCount: 0,
      feedVersion,
    },
  };

  return { feed, isUnchanged };
}
