import { getCachedMapping } from '../cache/mapping-cache';
import { ChannelConfig, MappingResult, MappingStatus, SkuSpecification } from '../types';
import { PipelineHaltError } from './errors';

export async function resolveMapping(
  vtexCategoryId: string,
  specifications: SkuSpecification[],
  channel: ChannelConfig
): Promise<MappingResult> {
  const { accountName, channelId } = channel;
  const now = new Date().toISOString();

  const cached = await getCachedMapping(accountName, channelId, vtexCategoryId);

  if (!cached) {
    throw new PipelineHaltError(
      `No category mapping found for vtexCategoryId=${vtexCategoryId} on channel ${channelId}`,
      'MISSING_MAPPING'
    );
  }

  // Resolve attribute mappings
  const attributes = specifications.map((spec) => {
    const match = cached.attrMap.find(
      (m) => m.vtexSpecName === spec.name && m.vtexSpecValue === spec.value
    );
    return {
      vtexSpecName: spec.name,
      vtexSpecValue: spec.value,
      channelAttrId: match?.channelAttrId ?? null,
      channelAttrValue: match?.channelAttrValue ?? null,
      mapped: !!match,
    };
  });

  const missingMappings = attributes
    .filter((a) => !a.mapped)
    .map((a) => ({
      type: 'attribute_value' as const,
      vtexValue: `${a.vtexSpecName}:${a.vtexSpecValue}`,
    }));

  const mappingStatus: MappingStatus =
    missingMappings.length === 0
      ? 'complete'
      : attributes.some((a) => a.mapped)
      ? 'partial'
      : 'missing';

  return {
    vtexCategoryId,
    channelCategoryId: cached.channelCategoryId,
    channelCategoryName: cached.channelCategoryName,
    attributes,
    mappingStatus,
    missingMappings,
    mappingResolvedAt: now,
  };
}
