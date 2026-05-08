import { AvailabilityResult, UnavailableReason } from '../types';

export function computeAvailability(
  catalogEligibility: boolean,
  priceEligibility: boolean,
  inventoryEligibility: boolean,
  inventoryResult: { sellableQuantity: number; simulatedStockBalance: number; minimumStockThreshold: number },
  skuActive: boolean,
  productActive: boolean,
  inSalesChannel: boolean
): AvailabilityResult {
  const now = new Date().toISOString();

  let unavailableReason: UnavailableReason | null = null;

  if (!skuActive) {
    unavailableReason = 'SKU_INACTIVE';
  } else if (!productActive) {
    unavailableReason = 'PRODUCT_INACTIVE';
  } else if (!inSalesChannel) {
    unavailableReason = 'NOT_IN_SALES_CHANNEL';
  } else if (!priceEligibility) {
    unavailableReason = 'ZERO_PRICE';
  } else if (inventoryResult.sellableQuantity === 0) {
    unavailableReason =
      inventoryResult.simulatedStockBalance > 0
        ? 'BELOW_MINIMUM_STOCK'
        : 'ZERO_STOCK';
  }

  const isAvailable = catalogEligibility && priceEligibility && inventoryEligibility;

  return {
    isAvailable,
    sellableQuantity: inventoryResult.sellableQuantity,
    unavailableReason,
    catalogEligibility,
    priceEligibility,
    inventoryEligibility,
    computedAt: now,
  };
}
