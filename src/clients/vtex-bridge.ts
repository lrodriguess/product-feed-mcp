import { env } from '../config/env';

export type BridgeStatus = 'Success' | 'Warning' | 'Error';
export type BridgeType = 'Catalog' | 'Price' | 'Stock' | 'Availability';

export interface BridgeDocument {
  skuId: string;
  accountName: string;
  channelId: string;
  status: BridgeStatus;
  type: BridgeType;
  message: string;
  timestamp: string;
}

export async function writeBridgeDocument(doc: BridgeDocument): Promise<void> {
  const { accountName } = doc;
  const url = `https://${accountName}.vtexcommercestable.com.br/api/oms/pvt/bridge`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-VTEX-API-AppKey': env.VTEX_APP_KEY,
      'X-VTEX-API-AppToken': env.VTEX_APP_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(doc),
  });

  if (!response.ok) {
    // Bridge writes are best-effort — log but do not throw
    console.warn(`[Bridge] Write failed for SKU ${doc.skuId}: ${response.status}`);
  }
}
