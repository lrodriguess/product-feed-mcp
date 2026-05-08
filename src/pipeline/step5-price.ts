import { createHash } from 'crypto';
import { runSimulation, SimulationResponse } from '../clients/vtex-simulation';
import { getRedis } from '../config/redis';
import { ChannelConfig, PriceResult } from '../types';
import { PipelineHaltError, RetryableError } from './errors';

function simulationCacheKey(
  accountName: string,
  skuId: string,
  salesChannel: number,
  country: string,
  postalCode: string
): string {
  const hash = createHash('md5')
    .update(`${accountName}:${skuId}:${salesChannel}:${country}:${postalCode}`)
    .digest('hex');
  return `sim:${hash}`;
}

export interface SimulationBundle {
  price: PriceResult;
  rawSimulation: SimulationResponse;
}

export async function resolvePrice(
  skuId: string,
  channel: ChannelConfig
): Promise<SimulationBundle> {
  const { accountName, salesChannel, country, representativePostalCode, currency, dedupTtlSeconds, affiliateId } =
    channel;

  const cacheKey = simulationCacheKey(accountName, skuId, salesChannel, country, representativePostalCode);
  const redis = getRedis();

  // Check simulation cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    const rawSimulation = JSON.parse(cached) as SimulationResponse;
    return buildBundle(rawSimulation, channel);
  }

  // Call VTEX Checkout Simulation
  let rawSimulation: SimulationResponse;
  try {
    rawSimulation = await runSimulation({
      skuId,
      salesChannel,
      accountName,
      country,
      postalCode: representativePostalCode,
      affiliateId,
    });
  } catch (err) {
    throw new RetryableError(
      `Checkout simulation failed for SKU ${skuId}: ${(err as Error).message}`,
      'SIMULATION_ERROR'
    );
  }

  // Cache the simulation result
  await redis.set(cacheKey, JSON.stringify(rawSimulation), 'EX', dedupTtlSeconds.price);

  return buildBundle(rawSimulation, channel);
}

function buildBundle(rawSimulation: SimulationResponse, channel: ChannelConfig): SimulationBundle {
  const { country, representativePostalCode, currency } = channel;
  const item = rawSimulation.items[0];
  const now = new Date().toISOString();

  if (!item || item.sellingPrice === 0) {
    throw new PipelineHaltError(
      `Simulation returned sellingPrice=0`,
      'ZERO_PRICE'
    );
  }

  const sellingPrice = item.sellingPrice;
  const basePrice = item.price;
  // Normalize: listPrice must be >= sellingPrice
  const listPrice = Math.max(item.listPrice, sellingPrice);

  const price: PriceResult = {
    sellingPrice,
    listPrice,
    basePrice,
    currency,
    sourceOfCalculation: 'checkout_simulation',
    simulationCountry: country,
    simulationPostalCode: representativePostalCode,
    resolvedAt: now,
  };

  return { price, rawSimulation };
}
