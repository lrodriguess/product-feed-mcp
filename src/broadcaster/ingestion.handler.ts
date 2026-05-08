import { BroadcasterPayload, domainToEventType } from './event.types';
import { listActiveChannelConfigsByAccount } from '../channels/channel-config.repository';
import { acquireDedup } from '../cache/redis-dedup';
import { invalidateCachedSku } from '../cache/sku-enrichment';
import { enqueue } from '../sqs/client';
import { QueueMessage } from '../types';

export async function handleBroadcasterEvent(
  accountName: string,
  payload: BroadcasterPayload
): Promise<{ processed: number; skipped: number }> {
  const eventType = domainToEventType(payload.Domain);
  const skuId = payload.IdSku;

  // Invalidate enrichment cache if SKU data itself changed
  if (payload.HasStockKeepingUnitModified) {
    await invalidateCachedSku(accountName, skuId);
  }

  const channels = await listActiveChannelConfigsByAccount(accountName);

  let processed = 0;
  let skipped = 0;

  for (const channel of channels) {
    const ttlSeconds = channel.dedupTtlSeconds[eventType];
    const acquired = await acquireDedup(accountName, skuId, eventType, ttlSeconds);

    if (!acquired) {
      skipped++;
      continue;
    }

    const message: QueueMessage = {
      accountName,
      channelId: channel.channelId,
      skuId,
      eventType,
      receivedAt: new Date().toISOString(),
    };

    await enqueue(accountName, eventType, message);
    processed++;
  }

  return { processed, skipped };
}
