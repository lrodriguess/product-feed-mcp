/**
 * MCP Tool: simulateProductFeed (T067)
 * Runs pipeline steps 1–8 with optional overrides on a cloned channel config.
 * Never writes to the Feed State Store. Always returns isHypothetical: true.
 */
import { z } from 'zod';
import { getChannelConfigById } from '../../channels/channel-config.repository';
import { ChannelConfig } from '../../types';
import { checkEligibility } from '../../pipeline/step1-eligibility';
import { enrichSku } from '../../pipeline/step2-enrichment';
import { normalizeSku } from '../../pipeline/step3-normalization';
import { resolveMapping } from '../../pipeline/step4-mapping';
import { resolvePrice } from '../../pipeline/step5-price';
import { resolveInventory } from '../../pipeline/step6-inventory';
import { computeAvailability } from '../../pipeline/step7-availability';
import { assembleFeed } from '../../pipeline/step8-assembly';

export const simulateProductFeedSchema = z.object({
  accountName: z.string().describe('VTEX account name'),
  channelId: z.string().describe('Target marketplace channel ID'),
  skuId: z.string().describe('VTEX SKU ID to simulate'),
  overrides: z
    .object({
      country: z.string().optional().describe('Override simulation country (ISO 3166-1 alpha-3)'),
      postalCode: z.string().optional().describe('Override simulation postal code'),
      minimumStock: z.number().int().min(0).optional().describe('Override minimum stock threshold'),
    })
    .optional()
    .describe('Optional channel config overrides for hypothetical simulation'),
});

export type SimulateProductFeedInput = z.infer<typeof simulateProductFeedSchema>;

export async function handleSimulateProductFeed(
  args: SimulateProductFeedInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { accountName, channelId, skuId, overrides } = args;

  const baseChannel = await getChannelConfigById(channelId);
  if (!baseChannel || baseChannel.accountName !== accountName) {
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

  // Clone channel config with overrides applied
  const channel: ChannelConfig = {
    ...baseChannel,
    ...(overrides?.country ? { country: overrides.country } : {}),
    ...(overrides?.postalCode ? { representativePostalCode: overrides.postalCode } : {}),
    ...(overrides?.minimumStock !== undefined ? { minimumStock: overrides.minimumStock } : {}),
  };

  try {
    // Step 1: Eligibility
    const eligibility = await checkEligibility(skuId, channel);
    if (!eligibility.eligible) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              isHypothetical: true,
              eligible: false,
              reason: eligibility.reason,
              pipeline: null,
            }),
          },
        ],
      };
    }

    // Step 2: Enrichment
    const sku = await enrichSku(skuId, channel);

    // Step 3: Normalization
    const vtexCategoryId = '0';
    const catalogContent = normalizeSku(sku, vtexCategoryId);

    // Step 4: Mapping
    const mapping = await resolveMapping(vtexCategoryId, catalogContent.specifications, channel);

    // Steps 5 & 6: Price and inventory
    const { price, rawSimulation } = await resolvePrice(skuId, channel);
    const inventory = resolveInventory(rawSimulation, channel);

    // Step 7: Availability
    const availability = computeAvailability(
      true,
      price.sellingPrice > 0,
      inventory.sellableQuantity > 0,
      {
        sellableQuantity: inventory.sellableQuantity,
        simulatedStockBalance: inventory.simulatedStockBalance,
        minimumStockThreshold: inventory.minimumStockThreshold,
      },
      sku.IsActive,
      sku.IsProductActive !== false,
      sku.SalesChannels.includes(channel.salesChannel)
    );

    // Step 8: Assembly (no idempotency check — always compute)
    const { feed } = assembleFeed({
      skuId,
      productId: String(sku.ProductId),
      channel,
      catalogContent,
      mapping,
      price,
      inventory,
      availability,
      lastDispatchedVersion: undefined,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            isHypothetical: true,
            eligible: true,
            appliedOverrides: overrides ?? {},
            pipeline: {
              availability: feed.availability,
              price: {
                sellingPrice: feed.price.sellingPrice,
                listPrice: feed.price.listPrice,
                currency: feed.price.currency,
                simulationCountry: feed.price.simulationCountry,
                simulationPostalCode: feed.price.simulationPostalCode,
              },
              inventory: {
                sellableQuantity: feed.inventory.sellableQuantity,
                minimumStockThreshold: feed.inventory.minimumStockThreshold,
              },
              mapping: {
                mappingStatus: feed.mapping.mappingStatus,
                missingMappings: feed.mapping.missingMappings,
              },
              feedVersion: feed.identity.feedVersion,
            },
          }),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            isHypothetical: true,
            isError: true,
            message: (err as Error).message,
            errorType: (err as Error).constructor.name,
          }),
        },
      ],
    };
  }
}
