import {
  createChannelConfig,
  getChannelConfigById,
  updateChannelConfig,
  listChannelConfigsByAccount,
} from './channel-config.repository';
import { channelConfigSchema, ChannelConfigInput } from './channel-config.validator';
import { bootstrapQueuesForAccount } from '../sqs/bootstrap-queues';
import { ChannelConfig } from '../types';

export class ChannelConflictError extends Error {
  constructor(channelId: string) {
    super(`Channel already exists: ${channelId}`);
    this.name = 'ChannelConflictError';
  }
}

export class ChannelNotFoundError extends Error {
  constructor(channelId: string) {
    super(`Channel not found: ${channelId}`);
    this.name = 'ChannelNotFoundError';
  }
}

export class ChannelValidationError extends Error {
  public readonly fieldErrors: Record<string, string[]>;
  constructor(fieldErrors: Record<string, string[]>) {
    super('Channel configuration validation failed');
    this.name = 'ChannelValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export async function registerChannel(input: unknown): Promise<ChannelConfig> {
  const parsed = channelConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ChannelValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }

  const config = parsed.data as ChannelConfig;

  try {
    await createChannelConfig(config);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new ChannelConflictError(config.channelId);
    }
    throw err;
  }

  // Bootstrap SQS queues for this account (idempotent)
  await bootstrapQueuesForAccount(config.accountName);

  return config;
}

export async function getChannel(channelId: string): Promise<ChannelConfig> {
  const config = await getChannelConfigById(channelId);
  if (!config) throw new ChannelNotFoundError(channelId);
  return config;
}

export async function updateChannel(
  channelId: string,
  patch: Partial<ChannelConfigInput>
): Promise<ChannelConfig> {
  // Re-validate the merged config
  const existing = await getChannel(channelId);
  const merged = { ...existing, ...patch };

  const parsed = channelConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ChannelValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }

  await updateChannelConfig(channelId, patch);
  return { ...existing, ...patch } as ChannelConfig;
}

export async function listChannels(accountName: string): Promise<ChannelConfig[]> {
  return listChannelConfigsByAccount(accountName);
}
