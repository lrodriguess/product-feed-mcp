import { v4 as uuidv4 } from 'uuid';
import { QueueMessage } from '../types';
import { getChannelConfigById } from '../channels/channel-config.repository';
import { getFeedState, updateSyncStatus } from '../store/feed-state';
import { createIssue } from '../store/offer-issue';
import { checkEligibility } from './step1-eligibility';
import { enrichSku } from './step2-enrichment';
import { normalizeSku } from './step3-normalization';
import { resolveMapping } from './step4-mapping';
import { resolvePrice } from './step5-price';
import { resolveInventory } from './step6-inventory';
import { computeAvailability } from './step7-availability';
import { assembleFeed } from './step8-assembly';
import { dispatchToConnector } from './step9-dispatch';
import { writeOutcome } from './step10-state-write';
import { PipelineHaltError, RetryableError, MaxRetriesExhaustedError } from './errors';

export async function runPipeline(message: QueueMessage): Promise<void> {
  const { accountName, channelId, skuId } = message;

  const channel = await getChannelConfigById(channelId);
  if (!channel || !channel.active) {
    console.warn(`[Pipeline] Skipping: channel ${channelId} not found or inactive`);
    return;
  }

  // Step 1: Eligibility gate
  const eligibility = await checkEligibility(skuId, channel);
  if (!eligibility.eligible) {
    // Silent exit — not an error
    return;
  }

  // Set pending → in_flight
  await updateSyncStatus(accountName, channelId, skuId, 'in_flight', {
    lastSyncAt: new Date().toISOString(),
  });

  try {
    // Step 2: Enrichment
    const sku = await enrichSku(skuId, channel);

    // Step 3: Content normalization
    const vtexCategoryId = '0'; // TODO: extract from product data
    const catalogContent = normalizeSku(sku, vtexCategoryId);

    // Step 4: Category & attribute mapping
    const mapping = await resolveMapping(vtexCategoryId, catalogContent.specifications, channel);

    // Step 5 & 6: Price and inventory via shared simulation
    const { price, rawSimulation } = await resolvePrice(skuId, channel);
    const inventory = resolveInventory(rawSimulation, channel);

    // Step 7: Availability calculation
    const availability = computeAvailability(
      true, // catalogEligibility
      price.sellingPrice > 0,
      inventory.sellableQuantity > 0,
      {
        sellableQuantity: inventory.sellableQuantity,
        simulatedStockBalance: inventory.simulatedStockBalance,
        minimumStockThreshold: inventory.minimumStockThreshold,
      },
      sku.IsActive,
      sku.IsProductActive !== false,
      sku.SalesChannels.includes(channel.salesChannel)
    );

    // Step 8: Assembly — check idempotency
    const existingState = await getFeedState(accountName, channelId, skuId);
    const { feed, isUnchanged } = assembleFeed({
      skuId,
      productId: String(sku.ProductId),
      channel,
      catalogContent,
      mapping,
      price,
      inventory,
      availability,
      lastDispatchedVersion: existingState?.feedVersion,
    });

    if (isUnchanged) {
      await updateSyncStatus(accountName, channelId, skuId, 'skipped');
      return;
    }

    // Step 9: Dispatch
    const dispatchId = uuidv4();
    const retryCount = existingState?.retryCount ?? 0;
    const dispatchResult = await dispatchToConnector(feed, channel, dispatchId, retryCount);

    if (dispatchResult.status === 'error' && !dispatchResult.retryable) {
      await createIssue({
        issueId: uuidv4(),
        accountName,
        channelId,
        skuId,
        issueType: 'DISPATCH_ERROR',
        severity: 'error',
        description: dispatchResult.errorMessage ?? 'Connector returned non-retryable error',
        source: 'connector',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        resolved: false,
      });
    }

    const syncStatus = dispatchResult.status === 'success' ? 'synced' : 'error';

    // Step 10: State write
    await writeOutcome({
      feed,
      channel,
      dispatchResult,
      syncStatus,
      retryCount,
    });
  } catch (err) {
    if (err instanceof PipelineHaltError) {
      // Create issue and stop — no retry
      await createIssue({
        issueId: uuidv4(),
        accountName,
        channelId,
        skuId,
        issueType: err.issueType,
        severity: 'error',
        description: err.message,
        source: 'platform',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        resolved: false,
      });
      await updateSyncStatus(accountName, channelId, skuId, 'error', {
        lastError: err.message,
      });
      return;
    }

    if (err instanceof RetryableError) {
      const currentState = await getFeedState(accountName, channelId, skuId);
      const retryCount = (currentState?.retryCount ?? 0) + 1;
      const maxRetries = channel.maxRetries ?? 5;

      if (retryCount >= maxRetries) {
        throw new MaxRetriesExhaustedError(`Max retries exhausted for SKU ${skuId}`);
      }

      await updateSyncStatus(accountName, channelId, skuId, 'error', {
        lastError: err.message,
        retryCount,
      });

      // Re-throw to let SQS consumer handle visibility timeout / re-enqueue
      throw err;
    }

    throw err;
  }
}
