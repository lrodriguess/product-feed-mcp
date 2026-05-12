import { v4 as uuidv4 } from 'uuid';
import { getCachedMapping } from '../cache/mapping-cache';
import { listIssuesByChannel } from '../store/offer-issue';
import { createIssue } from '../store/offer-issue';
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
    // Deduplicate: only create a MISSING_MAPPING issue if none is already open for this skuId
    // We use the channel-level query and filter by issueType; if none exists, create one.
    // Note: skuId is not available here — callers should pass it for full dedup.
    // For now, the orchestrator will handle the createIssue path via PipelineHaltError.
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

/**
 * Creates a MISSING_MAPPING issue, deduplicating against existing open issues
 * for the same (accountName, channelId, skuId) combination.
 */
export async function createMissingMappingIssueIfNeeded(
  accountName: string,
  channelId: string,
  skuId: string
): Promise<void> {
  // Check for existing open MISSING_MAPPING issue for this SKU
  const { issues } = await listIssuesByChannel(accountName, channelId, {
    issueType: 'MISSING_MAPPING',
    skuId,
    limit: 1,
  });

  if (issues.length > 0) {
    // Issue already exists — skip creation
    return;
  }

  await createIssue({
    issueId: uuidv4(),
    accountName,
    channelId,
    skuId,
    issueType: 'MISSING_MAPPING',
    severity: 'error',
    description: `No category mapping found for SKU ${skuId} on channel ${channelId}`,
    source: 'platform',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolved: false,
  });
}
