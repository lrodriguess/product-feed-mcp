import { createHmac } from 'crypto';
import { ProductFeed, DispatchResult, ChannelConfig } from '../types';
import { env } from '../config/env';
import { RetryableError } from './errors';

const BACKOFF_MS = [1000, 5000, 30000, 300000, 1800000]; // 1s, 5s, 30s, 5m, 30m

function sign(body: string): string {
  return createHmac('sha256', env.MCP_SESSION_SECRET).update(body).digest('hex');
}

export async function dispatchToConnector(
  feed: ProductFeed,
  channel: ChannelConfig,
  dispatchId: string,
  retryCount = 0
): Promise<DispatchResult> {
  const { dispatchEndpoint } = channel;

  // Health check before dispatch
  try {
    const healthUrl = new URL('/health', dispatchEndpoint).toString();
    const healthRes = await fetch(healthUrl, { method: 'GET' });
    if (!healthRes.ok) {
      throw new RetryableError(`Connector health check failed: ${healthRes.status}`);
    }
  } catch (err) {
    if (err instanceof RetryableError) throw err;
    throw new RetryableError(`Connector unreachable: ${(err as Error).message}`);
  }

  const payload = {
    dispatchId,
    channelId: channel.channelId,
    productFeed: feed,
    connectorContext: feed.connectorContext ?? {},
    dispatchedAt: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const signature = sign(body);

  let response: Response;
  try {
    response = await fetch(dispatchEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dispatch-Id': dispatchId,
        'X-Channel-Id': channel.channelId,
        'X-Platform-Signature': signature,
      },
      body,
    });
  } catch (err) {
    throw new RetryableError(`Connector network error: ${(err as Error).message}`);
  }

  if (!response.ok) {
    const delay = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
    throw new RetryableError(`Connector HTTP ${response.status}; retry in ${delay}ms`);
  }

  const result = (await response.json()) as DispatchResult;
  return result;
}
