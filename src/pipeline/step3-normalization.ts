import { createHash } from 'crypto';
import { VtexSku } from '../clients/vtex-catalog';
import { CatalogContent, Dimensions, ImageInfo, SkuSpecification } from '../types';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function selectMainImage(images: VtexSku['Images']): ImageInfo[] {
  if (!images || images.length === 0) return [];
  const sorted = [...images].sort((a, b) => (b.IsMain ? 1 : 0) - (a.IsMain ? 1 : 0));
  return sorted.map((img) => ({
    url: img.ImageUrl,
    label: img.ImageLabel ?? '',
    isMain: img.IsMain,
  }));
}

function normalizeDimensions(sku: VtexSku): Dimensions {
  const real = sku.RealDimension ?? sku.Dimension;
  const pkg = sku.Dimension;
  return {
    realHeight: real.height,
    realWidth: real.width,
    realLength: real.length,
    realWeight: real.weight,
    packageHeight: pkg.height,
    packageWidth: pkg.width,
    packageLength: pkg.length,
    packageWeight: pkg.weight,
    unit: 'cm_g',
  };
}

export function normalizeSku(sku: VtexSku, vtexCategoryId: string): CatalogContent {
  const specs: SkuSpecification[] = sku.SkuSpecifications.map((s) => ({
    name: s.FieldName,
    value: s.FieldValues[0] ?? '',
    isVariation: true,
  }));

  const ean = sku.AlternateIds?.Ean ?? null;
  const images = selectMainImage(sku.Images);
  const dimensions = normalizeDimensions(sku);

  const contentFields = JSON.stringify({
    title: sku.NameComplete,
    ean,
    specs: specs.map((s) => `${s.name}:${s.value}`).sort(),
    imageUrls: images.map((i) => i.url).sort(),
  });
  const contentVersion = createHash('sha256').update(contentFields).digest('hex');

  return {
    title: sku.NameComplete,
    description: stripHtml(''), // description fetched from product-level call if needed
    brand: '',
    vtexCategoryId,
    vtexCategoryPath: '',
    specifications: specs,
    images,
    ean,
    dimensions,
    isKit: sku.IsKit,
    contentVersion: `sha256:${contentVersion}`,
    contentUpdatedAt: new Date().toISOString(),
  };
}
