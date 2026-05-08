import { fetchSku, VtexSku } from '../clients/vtex-catalog';
import { getCachedSku, setCachedSku } from '../cache/sku-enrichment';
import { ChannelConfig } from '../types';

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  sku?: VtexSku;
}

export async function checkEligibility(
  skuId: string,
  channel: ChannelConfig
): Promise<EligibilityResult> {
  const { accountName, salesChannel, dedupTtlSeconds } = channel;

  // Try cache first
  let sku = await getCachedSku(accountName, skuId);
  if (!sku) {
    sku = await fetchSku(accountName, skuId);
    await setCachedSku(accountName, skuId, sku, dedupTtlSeconds.catalog);
  }

  if (!sku.IsActive) {
    return { eligible: false, reason: 'SKU_INACTIVE' };
  }

  if (sku.IsProductActive === false) {
    return { eligible: false, reason: 'PRODUCT_INACTIVE' };
  }

  if (!sku.SalesChannels.includes(salesChannel)) {
    return { eligible: false, reason: 'NOT_IN_SALES_CHANNEL' };
  }

  return { eligible: true, sku };
}
