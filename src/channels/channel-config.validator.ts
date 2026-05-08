import { z } from 'zod';

const dedupTtlSchema = z.object({
  catalog: z.number().int().positive(),
  price: z.number().int().positive(),
  stock: z.number().int().positive(),
});

export const channelConfigSchema = z.object({
  channelId: z.string().min(1),
  connectorType: z.enum(['marketplace', 'erp', 'feed']),
  accountName: z.string().min(1),
  salesChannel: z.number().int().positive(),
  tradePolicy: z.string().min(1),
  affiliateId: z.string().optional(),
  country: z.string().length(3, 'country must be ISO 3166-1 alpha-3 (3 characters)'),
  representativePostalCode: z.string().min(1),
  currency: z.string().length(3, 'currency must be ISO 4217 (3 characters)'),
  dedupTtlSeconds: dedupTtlSchema,
  minimumStock: z.number().int().min(0),
  maxRetries: z.number().int().positive().default(5),
  dispatchEndpoint: z.string().url(),
  stockAdjustmentHookEndpoint: z.string().url().optional(),
  active: z.boolean(),
}).refine(
  (data) => !data.active || (data.country && data.representativePostalCode),
  {
    message: 'country and representativePostalCode are required when active is true',
    path: ['representativePostalCode'],
  }
);

export type ChannelConfigInput = z.infer<typeof channelConfigSchema>;
