import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // VTEX
  VTEX_APP_KEY: z.string().min(1),
  VTEX_APP_TOKEN: z.string().min(1),

  // AWS
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default('local'),
  AWS_SECRET_ACCESS_KEY: z.string().default('local'),
  AWS_ENDPOINT: z.string().optional(),

  // DynamoDB
  DYNAMODB_ENDPOINT: z.string().optional(),
  DYNAMODB_TABLE: z.string().default('vtex-product-feed'),
  DYNAMODB_CHANNEL_CONFIG_TABLE: z.string().default('vtex-channel-config'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Servers
  MCP_PORT: z.coerce.number().default(3000),
  API_PORT: z.coerce.number().default(3001),
  MCP_SESSION_SECRET: z.string().min(16),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
