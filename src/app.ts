import express from 'express';
import { channelRouter } from './channels/channel-config.router';
import { broadcasterRouter } from './broadcaster/ingestion.router';
import { mapperWebhookRouter } from './mapper/mapper-webhook.router';

export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  // Health check (T069)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Channel management API
  app.use('/channels', channelRouter);

  // VTEX Broadcaster ingestion (internal)
  app.use('/internal/broadcaster', broadcasterRouter);

  // VTEX Mapper webhook (internal) — T060
  app.use('/internal/mapper', mapperWebhookRouter);

  return app;
}
