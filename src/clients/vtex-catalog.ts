import { env } from '../config/env';

export interface VtexSkuImage {
  ImageUrl: string;
  ImageLabel: string | null;
  IsMain: boolean;
}

export interface VtexSkuSpecification {
  FieldName: string;
  FieldValues: string[];
}

export interface VtexDimension {
  cubicweight: number;
  height: number;
  length: number;
  weight: number;
  width: number;
}

export interface VtexAlternateIds {
  Ean?: string;
  RefId?: string;
}

export interface VtexSku {
  Id: number;
  ProductId: number;
  ProductName: string;
  NameComplete: string;
  IsActive: boolean;
  IsKit: boolean;
  SalesChannels: number[];
  Images: VtexSkuImage[];
  Dimension: VtexDimension;
  RealDimension: VtexDimension;
  AlternateIds: VtexAlternateIds;
  SkuSpecifications: VtexSkuSpecification[];
  ProductSpecifications: VtexSkuSpecification[];
  IsProductActive?: boolean;
}

export async function fetchSku(accountName: string, skuId: string): Promise<VtexSku> {
  const url = `https://${accountName}.vtexcommercestable.com.br/api/catalog_system/pvt/sku/stockkeepingunitbyid/${skuId}`;

  const response = await fetch(url, {
    headers: {
      'X-VTEX-API-AppKey': env.VTEX_APP_KEY,
      'X-VTEX-API-AppToken': env.VTEX_APP_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`VTEX Catalog API error: ${response.status} ${response.statusText} for SKU ${skuId}`);
  }

  return response.json() as Promise<VtexSku>;
}
