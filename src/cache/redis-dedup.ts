import { getRedis } from '../config/redis';
import { EventType } from '../types';

function dedupKey(accountName: string, skuId: string, eventType: EventType): string {
  return `dedup:${accountName}:${skuId}:${eventType}`;
}

/**
 * Atomically acquire a dedup slot using SET NX EX.
 * Returns true if the slot was acquired (event should be processed).
 * Returns false if the slot already exists (event is a duplicate).
 */
export async function acquireDedup(
  accountName: string,
  skuId: string,
  eventType: EventType,
  ttlSeconds: number
): Promise<boolean> {
  const redis = getRedis();
  const key = dedupKey(accountName, skuId, eventType);
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

export async function releaseDedup(
  accountName: string,
  skuId: string,
  eventType: EventType
): Promise<void> {
  const redis = getRedis();
  await redis.del(dedupKey(accountName, skuId, eventType));
}
