import express, { type Express, type Request } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { FlowEngine } from '../core/flowEngine.js';
import type { PlatformAdapter } from '../core/types.js';

/** Request con el cuerpo crudo guardado para validar la firma HMAC. */
interface RawRequest extends Request {
  rawBody?: Buffer;
}

export function createApp(engine: FlowEngine, adapters: Map<string, PlatformAdapter>): Express {
  const app = express();

  // Guardamos el buffer crudo: la firma de Meta se calcula sobre estos bytes.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as RawRequest).rawBody = buf;
      },
    }),
  );

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // ── Verificacion del webhook (handshake inicial de Meta) ──────────────
  app.get('/webhooks/instagram', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === env.META_WEBHOOK_VERIFY_TOKEN) {
      logger.info('Webhook de Instagram verificado');
      return res.status(200).send(challenge);
    }
    logger.warn('Verificacion de webhook rechazada (token no coincide)');
    return res.sendStatus(403);
  });

  // ── Recepcion de eventos ──────────────────────────────────────────────
  app.post('/webhooks/instagram', async (req, res) => {
    const adapter = adapters.get('instagram');
    if (!adapter) return res.sendStatus(500);

    const raw = (req as RawRequest).rawBody ?? Buffer.from('');
    try {
      adapter.verifySignature(raw, req.header('x-hub-signature-256'));
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Firma invalida, se descarta el webhook');
      return res.sendStatus(403);
    }

    // Respondemos 200 de inmediato (Meta reintenta si tardamos) y procesamos aparte.
    res.sendStatus(200);

    try {
      const events = adapter.parseWebhook(req.body);
      for (const event of events) {
        await engine.handle(event);
      }
    } catch (err) {
      logger.error({ err }, 'Error procesando webhook de Instagram');
    }
  });

  return app;
}
