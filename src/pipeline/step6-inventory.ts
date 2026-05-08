import { SimulationResponse } from '../clients/vtex-simulation';
import { ChannelConfig, InventoryResult } from '../types';

export function resolveInventory(
  rawSimulation: SimulationResponse,
  channel: ChannelConfig
): InventoryResult {
  const { minimumStock } = channel;
  const now = new Date().toISOString();

  // Sum stockBalance across all delivery-eligible sellers
  const simulatedStockBalance = rawSimulation.logisticsInfo.reduce((total, info) => {
    const deliveryChannel = info.deliveryChannels.find((dc) => dc.id === 'delivery');
    return total + (deliveryChannel?.stockBalance ?? 0);
  }, 0);

  // Apply minimum stock threshold
  const sellableQuantity = simulatedStockBalance <= minimumStock ? 0 : simulatedStockBalance;

  return {
    simulatedStockBalance,
    sellableQuantity,
    minimumStockThreshold: minimumStock,
    resolvedAt: now,
  };
}
