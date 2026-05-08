import { getRedis } from '../config/redis';
import { MappingEntry } from '../types';

const DEFAULT_TTL = 3600; // 1 hour

export interface CachedMapping {
  channelCategoryId: string;
  channelCategoryName: string;
  attrMap: MappingEntry[];
}

function key(accountName: string, channelId: string, vtexCategoryId: string): string {
  return `mapping:${accountName}:${channelId}:${vtexCategoryId}`;
}

export async function getCachedMapping(
  accountName: string,
  channelId: string,
  vtexCategoryId: string
): Promise<CachedMapping | null> {
  const redis = getRedis();
  const raw = await redis.get(key(accountName, channelId, vtexCategoryId));
  return raw ? (JSON.parse(raw) as CachedMapping) : null;
}

export async function setCachedMapping(
  accountName: string,
  channelId: string,
  vtexCategoryId: string,
  mapping: CachedMapping,
  ttlSeconds = DEFAULT_TTL
): Promise<void> {
  const redis = getRedis();
  await redis.set(
    key(accountName, channelId, vtexCategoryId),
    JSON.stringify(mapping),
    'EX',
    ttlSeconds
  );
}

export async function invalidateMappingCache(
  accountName: string,
  channelId: string
): Promise<void> {
  const redis = getRedis();
  const pattern = `mapping:${accountName}:${channelId}:*`;
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
