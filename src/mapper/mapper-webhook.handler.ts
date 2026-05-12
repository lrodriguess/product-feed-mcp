/**
 * Mapper Webhook Handler (T055)
 * Receives VTEX Mapper category/attribute mapping payloads, updates the mapping cache,
 * and re-queues any SKUs that were blocked by MISSING_MAPPING issues.
 */
import { Request, Response } from 'express';
import { setCachedMapping, CachedMapping } from '../cache/mapping-cache';
import { listIssuesByChannel, resolveIssue } from '../store/offer-issue';
import { getChannelConfigById } from '../channels/channel-config.repository';
import { enqueue } from '../sqs/client';
import { MappingEntry } from '../types';

export interface MapperAttrEntry {
  vtexSpecName: string;
  vtexSpecValue: string;
  channelAttrId: string | null;
  channelAttrValue: string | null;
}

export interface MapperWebhookPayload {
  vtexCategoryId: string;
  channelCategoryId: string;
  channelCategoryName: string;
  attrMap: MapperAttrEntry[];
}

export async function handleMapperWebhook(req: Request, res: Response): Promise<void> {
  const { channelId } = req.params;

  // Support single mapping or batch array
  const rawBody = req.body as MapperWebhookPayload | MapperWebhookPayload[];
  const payloads: MapperWebhookPayload[] = Array.isArray(rawBody) ? rawBody : [rawBody];

  if (!payloads.length) {
    res.status(400).json({ error: 'Empty mapping payload' });
    return;
  }

  const channel = await getChannelConfigById(channelId);
  if (!channel || !channel.active) {
    res.status(404).json({ error: `Channel ${channelId} not found or inactive` });
    return;
  }

  const { accountName } = channel;
  const updatedCategories: string[] = [];

  for (const payload of payloads) {
    const { vtexCategoryId, channelCategoryId, channelCategoryName, attrMap } = payload;

    // Build CachedMapping from payload
    const cachedMapping: CachedMapping = {
      channelCategoryId,
      channelCategoryName,
      attrMap: attrMap.map(
        (e): MappingEntry => ({
          vtexSpecName: e.vtexSpecName,
          vtexSpecValue: e.vtexSpecValue,
          channelAttrId: e.channelAttrId,
          channelAttrValue: e.channelAttrValue,
          mapped: !!(e.channelAttrId && e.channelAttrValue),
        })
      ),
    };

    await setCachedMapping(accountName, channelId, vtexCategoryId, cachedMapping);
    updatedCategories.push(vtexCategoryId);
  }

  // Re-queue SKUs that had open MISSING_MAPPING issues
  const requeuedSkuIds: string[] = [];
  let cursor: string | undefined;

  do {
    const { issues, nextCursor } = await listIssuesByChannel(accountName, channelId, {
      issueType: 'MISSING_MAPPING',
      limit: 50,
      cursor,
    });

    for (const issue of issues) {
      // Resolve the issue
      await resolveIssue(accountName, channelId, issue.issueId);

      // Re-enqueue for catalog re-processing
      await enqueue(accountName, 'catalog', {
        accountName,
        channelId,
        skuId: issue.skuId,
        eventType: 'catalog',
        receivedAt: new Date().toISOString(),
      });

      requeuedSkuIds.push(issue.skuId);
    }

    cursor = nextCursor;
  } while (cursor);

  res.status(200).json({
    updatedCategories,
    requeuedSkuIds: [...new Set(requeuedSkuIds)], // deduplicate
    processedAt: new Date().toISOString(),
  });
}
