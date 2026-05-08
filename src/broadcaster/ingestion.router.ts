import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { handleBroadcasterEvent } from './ingestion.handler';

export const broadcasterRouter = Router();

const payloadSchema = z.object({
  Domain: z.string(),
  ActionName: z.string(),
  IdSku: z.string(),
  An: z.string(),
  HasStockKeepingUnitModified: z.boolean().optional(),
});

// POST /internal/broadcaster/:accountName
broadcasterRouter.post('/:accountName', async (req: Request, res: Response) => {
  // Always return 200 immediately — never block Broadcaster delivery
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(200).json({ ok: false, reason: 'invalid_payload' });
    return;
  }

  const accountName = req.params.accountName;

  // Process asynchronously — don't await
  handleBroadcasterEvent(accountName, parsed.data).catch((err) => {
    console.error(`[Broadcaster] Error processing event for ${accountName}:`, err);
  });

  res.status(200).json({ ok: true });
});
