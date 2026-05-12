/**
 * MCP Tool: explainOfferAvailability (T061)
 * Returns a structured breakdown explaining exactly why a SKU is or is not available on a channel.
 */
import { z } from 'zod';
import { getFeedState } from '../../store/feed-state';
import { getChannelConfigById } from '../../channels/channel-config.repository';

export const explainOfferAvailabilitySchema = z.object({
  accountName: z.string().describe('VTEX account name'),
  channelId: z.string().describe('Target marketplace channel ID'),
  skuId: z.string().describe('VTEX SKU ID'),
});

export type ExplainOfferAvailabilityInput = z.infer<typeof explainOfferAvailabilitySchema>;

function describeReason(reason: string | null | undefined): string {
  const reasons: Record<string, string> = {
    SKU_INACTIVE: 'The SKU is marked as inactive in VTEX Catalog.',
    PRODUCT_INACTIVE: 'The parent product is marked as inactive in VTEX Catalog.',
    NOT_IN_SALES_CHANNEL: 'The SKU is not associated with the channel\'s sales channel.',
    ZERO_PRICE: 'The checkout simulation returned a selling price of zero.',
    ZERO_STOCK: 'No sellable stock was found in the checkout simulation.',
    BELOW_MINIMUM_STOCK: 'Sellable stock is below the configured minimum stock threshold.',
    CONTENT_VIOLATION: 'The SKU content failed validation (e.g. missing required fields).',
    MISSING_MAPPING: 'No category mapping exists for this SKU\'s VTEX category.',
  };
  return reason ? (reasons[reason] ?? `Unknown reason: ${reason}`) : 'No reason recorded.';
}

export async function handleExplainOfferAvailability(
  args: ExplainOfferAvailabilityInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { accountName, channelId, skuId } = args;

  const [feedState, channel] = await Promise.all([
    getFeedState(accountName, channelId, skuId),
    getChannelConfigById(channelId),
  ]);

  if (!feedState) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            isError: true,
            message: `No feed state found for SKU ${skuId} on channel ${channelId}`,
          }),
        },
      ],
    };
  }

  const minimumStock = channel?.minimumStock ?? 1;

  // Derive eligibility checks from stored state
  const catalogEligibility = {
    pass:
      feedState.syncStatus !== 'error' ||
      !['SKU_INACTIVE', 'PRODUCT_INACTIVE', 'NOT_IN_SALES_CHANNEL', 'MISSING_MAPPING'].includes(
        feedState.unavailableReason ?? ''
      ),
    checks: {
      skuActive: feedState.unavailableReason !== 'SKU_INACTIVE',
      productActive: feedState.unavailableReason !== 'PRODUCT_INACTIVE',
      inSalesChannel: feedState.unavailableReason !== 'NOT_IN_SALES_CHANNEL',
      hasMapping: feedState.unavailableReason !== 'MISSING_MAPPING',
    },
    detail: ['SKU_INACTIVE', 'PRODUCT_INACTIVE', 'NOT_IN_SALES_CHANNEL', 'MISSING_MAPPING'].includes(
      feedState.unavailableReason ?? ''
    )
      ? describeReason(feedState.unavailableReason)
      : 'All catalog eligibility checks passed.',
  };

  const priceEligibility = {
    pass: (feedState.sellingPrice ?? 0) > 0,
    sellingPrice: feedState.sellingPrice ?? 0,
    currency: feedState.currency ?? channel?.currency ?? 'unknown',
    detail:
      (feedState.sellingPrice ?? 0) > 0
        ? `Selling price is ${feedState.sellingPrice} ${feedState.currency}.`
        : describeReason('ZERO_PRICE'),
  };

  const stockEligibility = {
    pass:
      (feedState.sellableQuantity ?? 0) > 0 &&
      feedState.unavailableReason !== 'BELOW_MINIMUM_STOCK',
    sellableQuantity: feedState.sellableQuantity ?? 0,
    minimumStockThreshold: minimumStock,
    detail:
      feedState.unavailableReason === 'BELOW_MINIMUM_STOCK'
        ? describeReason('BELOW_MINIMUM_STOCK') +
          ` Threshold: ${minimumStock}, current: ${feedState.sellableQuantity ?? 0}.`
        : (feedState.sellableQuantity ?? 0) > 0
        ? `Stock is ${feedState.sellableQuantity} units (above minimum of ${minimumStock}).`
        : describeReason('ZERO_STOCK'),
  };

  const overallAvailable = feedState.isAvailable ?? false;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          accountName,
          channelId,
          skuId,
          isAvailable: overallAvailable,
          unavailableReason: feedState.unavailableReason ?? null,
          summary: overallAvailable
            ? 'This SKU is available on the channel.'
            : `This SKU is unavailable: ${describeReason(feedState.unavailableReason)}`,
          breakdown: {
            catalogEligibility,
            priceEligibility,
            inventoryEligibility: stockEligibility,
          },
          lastSimulationParams: {
            country: feedState.simulationCountry ?? null,
            postalCode: feedState.simulationPostalCode ?? null,
          },
          syncStatus: feedState.syncStatus,
          lastSyncAt: feedState.lastSyncAt ?? null,
          openIssueCount: feedState.openIssueCount,
        }),
      },
    ],
  };
}
