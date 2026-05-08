import { fetchSku, VtexSku } from '../clients/vtex-catalog';
import { getCachedSku, setCachedSku } from '../cache/sku-enrichment';
import { ChannelConfig } from '../types';
import { RetryableError } from './errors';

export async function enrichSku(skuId: string, channel: ChannelConfig): Promise<VtexSku> {
  const { accountName, dedupTtlSeconds } = channel;

  // Check enrichment cache
  const cached = await getCachedSku(accountName, skuId);
  if (cached) return cached;

  try {
    const sku = await fetchSku(accountName, skuId);
    await setCachedSku(accountName, skuId, sku, dedupTtlSeconds.catalog);
    return sku;
  } catch (err) {
    throw new RetryableError(
      `Failed to enrich SKU ${skuId}: ${(err as Error).message}`,
      'CONTENT_FETCH_ERROR'
    );
  }
}
