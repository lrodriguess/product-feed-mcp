/**
 * Pipeline: Stock Adjustment Hook (T072)
 * If the channel config has stockAdjustmentHookEndpoint, calls the connector's
 * /config/stock-adjustment-hook to allow connectors to override raw simulated stock.
 * The adjusted value is capped at rawSimulatedStock to prevent inflation.
 */
import { ChannelConfig } from '../types';
import { logger } from '../observability/logger';

export interface StockAdjustmentRequest {
  accountName: string;
  channelId: string;
  skuId: string;
  rawSimulatedStock: number;
}

export interface StockAdjustmentResponse {
  adjustedStock: number;
}

export async function applyStockAdjustmentHook(
  skuId: string,
  rawSimulatedStock: number,
  channel: ChannelConfig
): Promise<number> {
  const { stockAdjustmentHookEndpoint, accountName, channelId } = channel;

  if (!stockAdjustmentHookEndpoint) {
    return rawSimulatedStock;
  }

  const requestBody: StockAdjustmentRequest = {
    accountName,
    channelId,
    skuId,
    rawSimulatedStock,
  };

  try {
    const response = await fetch(stockAdjustmentHookEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      logger.warn('[StockAdjustmentHook] Hook returned non-2xx, using raw stock', {
        accountName,
        channelId,
        skuId,
        status: response.status,
      });
      return rawSimulatedStock;
    }

    const data = (await response.json()) as StockAdjustmentResponse;

    if (typeof data.adjustedStock !== 'number' || data.adjustedStock < 0) {
      logger.warn('[StockAdjustmentHook] Invalid adjustedStock in response, using raw stock', {
        accountName,
        channelId,
        skuId,
      });
      return rawSimulatedStock;
    }

    // Cap at raw simulated stock to prevent inflation
    const capped = Math.min(data.adjustedStock, rawSimulatedStock);
    logger.info('[StockAdjustmentHook] Applied adjustment', {
      accountName,
      channelId,
      skuId,
      rawSimulatedStock,
      adjustedStock: data.adjustedStock,
      capped,
    });

    return capped;
  } catch (err) {
    logger.warn('[StockAdjustmentHook] Hook call failed, using raw stock', {
      accountName,
      channelId,
      skuId,
      error: (err as Error).message,
    });
    return rawSimulatedStock;
  }
}
