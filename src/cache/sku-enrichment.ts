import { getRedis } from '../config/redis';
import { VtexSku } from '../clients/vtex-catalog';

function key(accountName: string, skuId: string): string {
  return `sku:${accountName}:${skuId}`;
}

export async function getCachedSku(accountName: string, skuId: string): Promise<VtexSku | null> {
  const redis = getRedis();
  const raw = await redis.get(key(accountName, skuId));
  return raw ? (JSON.parse(raw) as VtexSku) : null;
}

export async function setCachedSku(
  accountName: string,
  skuId: string,
  data: VtexSku,
  ttlSeconds: number
): Promise<void> {
  const redis = getRedis();
  await redis.set(key(accountName, skuId), JSON.stringify(data), 'EX', ttlSeconds);
}

export async function invalidateCachedSku(accountName: string, skuId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(key(accountName, skuId));
}
