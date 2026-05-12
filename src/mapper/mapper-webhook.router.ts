/**
 * Mapper Webhook Router (T056)
 * Mounts POST /internal/mapper/webhook/:channelId
 */
import { Router } from 'express';
import { vtexAuth } from '../middleware/vtex-auth';
import { handleMapperWebhook } from './mapper-webhook.handler';

export const mapperWebhookRouter: Router = Router();

mapperWebhookRouter.post(
  '/webhook/:channelId',
  vtexAuth,
  (req, res, next) => {
    handleMapperWebhook(req, res).catch(next);
  }
);
