import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { FlowEngine } from '../core/flowEngine.js';
import type { PlatformAdapter } from '../core/types.js';
import type { ConversationStore } from '../store/conversationStore.js';
import { dataDeletionHtml, privacyHtml, termsHtml } from './legal.js';
import { registrarRutasDelPanel } from './panel.js';
import type { PanelStore } from '../store/panelStore.js';
import { DEFAULT_ACCOUNT_ID } from '../core/account.js';
import { basicAuthOk, renderInboxHtml } from './inbox.js';

/** Request con el cuerpo crudo guardado para validar la firma HMAC. */
interface RawRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Envuelve un handler async para que un rechazo llegue al middleware de error en
 * vez de convertirse en una promesa sin dueno (que en Node mata el proceso).
 * Express 5 lo hace solo; con Express 4 hay que envolver a mano.
 */
export function asincrono(
  fn: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function createApp(
  engine: FlowEngine,
  adapters: Map<string, PlatformAdapter>,
  store: ConversationStore,
  /** Almacen del panel. Sin el (o con PANEL_ENABLED=false) el panel no existe. */
  panel?: PanelStore,
  /**
   * Cuenta que muestra la bandeja `/inbox`. Antes listaba TODAS las cuentas,
   * porque llamaba a `list()` sin scope: con un solo cliente daba igual, con dos
   * habria sido una fuga entre clientes. La vista multi-cuenta de Leonardo va por
   * el panel, con autorizacion de verdad (Tarea 12).
   */
  cuentaDeLaBandeja: string = DEFAULT_ACCOUNT_ID,
): Express {
  const app = express();

  // Guardamos el buffer crudo: la firma de Meta se calcula sobre estos bytes.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as RawRequest).rawBody = buf;
      },
    }),
  );

  // Cabeceras de seguridad para las paginas HTML. Sin dependencia nueva: son
  // cinco lineas y cierran robo de sesion via XSS futuro, sniffing de tipo,
  // enmarcado y fuga del token por el Referer.
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Paginas legales requeridas por Meta para publicar la app.
  app.get('/privacy', (_req, res) => res.type('html').send(privacyHtml));
  app.get('/terms', (_req, res) => res.type('html').send(termsHtml));
  // Meta exige una URL propia que explique como pedir el borrado de datos.
  app.get('/data-deletion', (_req, res) => res.type('html').send(dataDeletionHtml));

  // Panel del cliente: detras de bandera. Apagado, la app sirve exactamente lo
  // mismo que antes y estas rutas no existen.
  if (env.PANEL_ENABLED && panel) registrarRutasDelPanel(app, panel);

  // ── Bandeja de conversaciones (/inbox) ────────────────────────────────
  // UI read-only que muestra los mensajes entrantes y salientes por usuario.
  // Protegida con Basic Auth. Es la vista que demuestra a la revision de Meta
  // que el mensaje entrante aparece en la app, ligado a la conversacion.
  app.get(
    '/inbox',
    asincrono(async (req, res) => {
    if (!env.INBOX_USER || !env.INBOX_PASS) {
      return res.status(503).type('text').send('Inbox disabled: set INBOX_USER and INBOX_PASS.');
    }
    if (!basicAuthOk(req.header('authorization'), env.INBOX_USER, env.INBOX_PASS)) {
      res.set('WWW-Authenticate', 'Basic realm="LeoDMsBot Inbox", charset="UTF-8"');
      return res.status(401).type('text').send('Authentication required.');
    }
      const states = await store.list(cuentaDeLaBandeja);
      return res.type('html').send(renderInboxHtml(states));
    }),
  );

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
  app.post(
    '/webhooks/instagram',
    asincrono(async (req, res) => {
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
    }),
  );

  // Red de seguridad: Express 4 no atrapa el rechazo de un handler async, y una
  // promesa rechazada sin dueno mata el proceso de Node. Sin esto, un fallo
  // transitorio de la base en una ruta del panel se lleva por delante el
  // webhook de Meta. Va al final: solo ve lo que ninguna ruta manejo.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Error no manejado en una ruta');
    if (res.headersSent) return;
    res.status(500).type('text').send('Error interno. Intenta de nuevo.');
  });

  return app;
}
