import { env } from '../config/env';

export interface SimulationItem {
  id: string;
  quantity: number;
  seller?: string;
  sellingPrice: number;
  listPrice: number;
  price: number;
}

export interface DeliveryChannel {
  id: string;
  stockBalance: number;
}

export interface LogisticsInfo {
  itemIndex: number;
  deliveryChannels: DeliveryChannel[];
}

export interface SimulationResponse {
  items: SimulationItem[];
  logisticsInfo: LogisticsInfo[];
  totals: Array<{ id: string; name: string; value: number }>;
}

export interface SimulationParams {
  skuId: string;
  salesChannel: number;
  accountName: string;
  country: string;
  postalCode: string;
  affiliateId?: string;
}

export async function runSimulation(params: SimulationParams): Promise<SimulationResponse> {
  const { skuId, salesChannel, accountName, country, postalCode, affiliateId } = params;

  let url = `https://${accountName}.vtexcommercestable.com.br/api/checkout/pub/orderForms/simulation?sc=${salesChannel}&an=${accountName}`;
  if (affiliateId) {
    url += `&affiliateId=${affiliateId}`;
  }

  const body = {
    items: [{ id: skuId, quantity: 1 }],
    country,
    postalCode,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-VTEX-API-AppKey': env.VTEX_APP_KEY,
      'X-VTEX-API-AppToken': env.VTEX_APP_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`VTEX Simulation API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<SimulationResponse>;
}
