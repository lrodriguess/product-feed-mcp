import { Router, Request, Response } from 'express';
import { vtexAuth } from '../middleware/vtex-auth';
import {
  registerChannel,
  getChannel,
  updateChannel,
  listChannels,
  ChannelConflictError,
  ChannelNotFoundError,
  ChannelValidationError,
} from './channel-config.service';

export const channelRouter = Router();

channelRouter.use(vtexAuth);

// POST /channels
channelRouter.post('/', async (req: Request, res: Response) => {
  try {
    const config = await registerChannel(req.body);
    res.status(201).json(config);
  } catch (err) {
    if (err instanceof ChannelValidationError) {
      return res.status(400).json({ error: err.message, fieldErrors: err.fieldErrors });
    }
    if (err instanceof ChannelConflictError) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Channel] Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /channels/:channelId
channelRouter.get('/:channelId', async (req: Request, res: Response) => {
  try {
    const config = await getChannel(req.params.channelId);
    res.json(config);
  } catch (err) {
    if (err instanceof ChannelNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /channels/:channelId
channelRouter.put('/:channelId', async (req: Request, res: Response) => {
  try {
    const config = await updateChannel(req.params.channelId, req.body);
    res.json(config);
  } catch (err) {
    if (err instanceof ChannelNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof ChannelValidationError) {
      return res.status(400).json({ error: err.message, fieldErrors: err.fieldErrors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /channels?accountName=xxx
channelRouter.get('/', async (req: Request, res: Response) => {
  const { accountName } = req.query;
  if (!accountName || typeof accountName !== 'string') {
    return res.status(400).json({ error: 'accountName query parameter is required' });
  }
  const configs = await listChannels(accountName);
  res.json(configs);
});

// GET /channels/:channelId/health — proxy to connector dispatchEndpoint/health (T079)
channelRouter.get('/:channelId/health', async (req: Request, res: Response) => {
  try {
    const config = await getChannel(req.params.channelId);
    const healthUrl = new URL('/health', config.dispatchEndpoint).toString();

    let connectorRes: Response;
    try {
      connectorRes = await fetch(healthUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
    } catch (fetchErr) {
      return res.status(502).json({
        channelId: config.channelId,
        connectorStatus: 'unreachable',
        error: (fetchErr as Error).message,
      });
    }

    const body = await connectorRes.json().catch(() => null);
    res.status(connectorRes.ok ? 200 : 502).json({
      channelId: config.channelId,
      connectorStatus: connectorRes.ok ? 'ok' : 'error',
      httpStatus: connectorRes.status,
      body,
    });
  } catch (err) {
    if (err instanceof ChannelNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
