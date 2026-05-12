/**
 * MCP Tool: getMarketplaceMappingStatus (T058)
 * Returns current category and attribute mapping status for a SKU on a channel.
 */
import { z } from 'zod';
import { getCachedMapping } from '../../cache/mapping-cache';
import { getChannelConfigById } from '../../channels/channel-config.repository';

export const getMarketplaceMappingStatusSchema = z.object({
  accountName: z.string().describe('VTEX account name'),
  channelId: z.string().describe('Target marketplace channel ID'),
  vtexCategoryId: z.string().describe('VTEX category ID to check mapping for'),
});

export type GetMarketplaceMappingStatusInput = z.infer<typeof getMarketplaceMappingStatusSchema>;

export async function handleGetMarketplaceMappingStatus(
  args: GetMarketplaceMappingStatusInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { accountName, channelId, vtexCategoryId } = args;

  const channel = await getChannelConfigById(channelId);
  if (!channel || channel.accountName !== accountName) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            isError: true,
            message: `Channel ${channelId} not found for account ${accountName}`,
          }),
        },
      ],
    };
  }

  const cached = await getCachedMapping(accountName, channelId, vtexCategoryId);

  if (!cached) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            accountName,
            channelId,
            vtexCategoryId,
            mappingStatus: 'missing',
            categoryMapping: null,
            attributeMapping: [],
            missingMappings: [{ type: 'category', vtexValue: vtexCategoryId }],
            cachedAt: null,
          }),
        },
      ],
    };
  }

  const mappedAttrs = cached.attrMap.filter((a) => a.mapped);
  const unmappedAttrs = cached.attrMap.filter((a) => !a.mapped);

  const mappingStatus =
    unmappedAttrs.length === 0 ? 'complete' : mappedAttrs.length > 0 ? 'partial' : 'missing';

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          accountName,
          channelId,
          vtexCategoryId,
          mappingStatus,
          categoryMapping: {
            channelCategoryId: cached.channelCategoryId,
            channelCategoryName: cached.channelCategoryName,
          },
          attributeMapping: cached.attrMap,
          missingMappings: unmappedAttrs.map((a) => ({
            type: 'attribute_value',
            vtexValue: `${a.vtexSpecName}:${a.vtexSpecValue}`,
          })),
        }),
      },
    ],
  };
}
