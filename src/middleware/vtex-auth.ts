import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export function vtexAuth(req: Request, res: Response, next: NextFunction): void {
  const appKey = req.headers['x-vtex-api-appkey'];
  const appToken = req.headers['x-vtex-api-apptoken'];

  // Also support cookie-based auth
  const cookie = req.headers['cookie'];
  const hasCookieAuth = cookie?.includes('VtexIdclientAutCookie');

  if (hasCookieAuth) {
    return next();
  }

  if (!appKey || !appToken) {
    res.status(403).json({ error: 'Missing VTEX authentication headers' });
    return;
  }

  // In production this would validate against VTEX identity API.
  // For now we validate against configured credentials.
  if (appKey !== env.VTEX_APP_KEY || appToken !== env.VTEX_APP_TOKEN) {
    res.status(403).json({ error: 'Invalid VTEX credentials' });
    return;
  }

  next();
}
