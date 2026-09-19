import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { FlowEngine } from '../core/flowEngine.js';
import type { PlatformAdapter } from '../core/types.js';
import type { ConversationStore } from '../store/conversationStore.js';
import { dataDeletionHtml, privacyHtml, termsHtml } from './legal.js';
import { registrarRutasDelPanel } from './panel.js';
import { mensajeDelPanel } from './panel/vista.js';
import { AvisadorPorLog, AvisadorUnaVezAlDia } from '../core/avisos.js';
import type { PanelStore } from '../store/panelStore.js';
import { DEFAULT_ACCOUNT_ID } from '../core/account.js';
import {
  basicAuthOk,
  origenDeLaBandejaValido,
  renderInboxHtml,
  renderReplyHtml,
  tokenDeOrigenDeLaBandeja,
  type AvisoDeBandeja,
  type CuentaConectada,
  type OpcionesDeBandeja,
} from './inbox.js';
import { agregarMensaje, isWithinMessagingWindow } from '../store/conversationStore.js';
import { conCache } from './panel/saludCacheada.js';
import type { ConSalud } from './panel/estado.js';

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
  if (env.PANEL_ENABLED && panel) {
    registrarRutasDelPanel(
      app,
      panel,
      adapters.get('instagram') as unknown as Parameters<typeof registrarRutasDelPanel>[2],
      new AvisadorUnaVezAlDia(new AvisadorPorLog()),
      cuentaDeLaBandeja,
    );
  }

  // ── Bandeja de conversaciones (/inbox) ────────────────────────────────
  // Muestra los mensajes entrantes y salientes por usuario, la cuenta de
  // Instagram desde la que se envia, y deja responder a mano. Protegida con
  // Basic Auth. Es la vista que la revision de Meta pide ver: el activo a la
  // vista, un envio en vivo desde la app, y el entrante ligado al mismo hilo.
  const saludDeLaBandeja = conCache(
    adapters.get('instagram') as unknown as ConSalud | undefined,
  );

  /** Datos del activo para la cabecera. Nunca lanza: la pantalla manda. */
  async function cuentaDeLaVista(): Promise<CuentaConectada> {
    const id = env.IG_BUSINESS_ACCOUNT_ID;
    try {
      const salud = await saludDeLaBandeja?.salud?.();
      if (salud?.estado === 'ok') {
        return { id, username: salud.username, conectada: true };
      }
    } catch (err) {
      logger.warn({ err }, 'No se pudo consultar la cuenta para la bandeja');
    }
    return { id, conectada: false };
  }

  /** Texto del aviso que viaja por la URL tras un envio (POST-Redirect-GET). */
  function avisoDeLaUrl(req: Request): AvisoDeBandeja | undefined {
    if (req.query.sent === 'ok') {
      // Lo que sabemos con certeza es que Meta ACEPTO el mensaje. Decir
      // "entregado" seria afirmar algo que la respuesta de la API no dice.
      return { tipo: 'ok', texto: 'Message accepted by the Meta Graph API and sent to this user.' };
    }
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    switch (error) {
      case 'window':
        return {
          tipo: 'error',
          texto:
            'Not sent: the 24-hour messaging window is closed for this conversation (Meta policy).',
        };
      case 'unknown':
        return { tipo: 'error', texto: 'Not sent: that conversation does not exist in this app.' };
      case 'empty':
        return { tipo: 'error', texto: 'Not sent: the message was empty.' };
      case 'origin':
        return { tipo: 'error', texto: 'Not sent: the form did not come from this page.' };
      case 'api':
        return {
          tipo: 'error',
          texto: 'Not sent: the Meta Graph API rejected the message. Check the server logs.',
        };
      default:
        return undefined;
    }
  }

  /**
   * Puerta comun de la bandeja. Devuelve true si la peticion ya fue respondida
   * (deshabilitada o sin credenciales): el handler debe cortar ahi.
   */
  function bandejaCerrada(req: Request, res: Response): boolean {
    if (!env.INBOX_USER || !env.INBOX_PASS) {
      res.status(503).type('text').send('Inbox disabled: set INBOX_USER and INBOX_PASS.');
      return true;
    }
    if (!basicAuthOk(req.header('authorization'), env.INBOX_USER, env.INBOX_PASS)) {
      res.set('WWW-Authenticate', 'Basic realm="LeoDMsBot Inbox", charset="UTF-8"');
      res.status(401).type('text').send('Authentication required.');
      return true;
    }
    return false;
  }

  async function opcionesDeLaBandeja(req: Request): Promise<OpcionesDeBandeja> {
    return {
      cuenta: await cuentaDeLaVista(),
      pass: env.INBOX_PASS,
      aviso: avisoDeLaUrl(req),
    };
  }

  app.get(
    '/inbox',
    asincrono(async (req, res) => {
      if (bandejaCerrada(req, res)) return;
      const states = await store.list(cuentaDeLaBandeja);
      return res.type('html').send(renderInboxHtml(states, await opcionesDeLaBandeja(req)));
    }),
  );

  // Pantalla de respuesta: hilo + campo de texto. Sin auto-refresco (borraria
  // lo que el operador esta escribiendo).
  app.get(
    '/inbox/reply',
    asincrono(async (req, res) => {
      if (bandejaCerrada(req, res)) return;
      const userId = typeof req.query.user === 'string' ? req.query.user : '';
      const state = userId ? await store.get('instagram', userId, cuentaDeLaBandeja) : undefined;
      if (!state) return res.redirect(303, '/inbox?error=unknown');
      return res.type('html').send(renderReplyHtml(state, await opcionesDeLaBandeja(req)));
    }),
  );

  // Envio manual: la accion en vivo que la revision de Meta pide ver. Llama al
  // mismo Graph API que usa el motor y deja el saliente en el mismo hilo.
  app.post(
    '/inbox/send',
    // Mismo tope que los formularios del panel: un cuerpo enorme no tiene por
    // que llegar hasta la Graph API para morir alli con un error generico.
    express.urlencoded({ extended: false, limit: '4kb' }),
    asincrono(async (req, res) => {
      if (bandejaCerrada(req, res)) return;
      const cuerpo = (req.body ?? {}) as Record<string, unknown>;
      const userId = typeof cuerpo.user === 'string' ? cuerpo.user : '';
      if (!origenDeLaBandejaValido(env.INBOX_PASS, userId, cuerpo.origen)) {
        return res.redirect(303, '/inbox?error=origin');
      }
      const texto = typeof cuerpo.text === 'string' ? cuerpo.text.trim() : '';
      if (!texto) return res.redirect(303, '/inbox?error=empty');

      const state = userId ? await store.get('instagram', userId, cuentaDeLaBandeja) : undefined;
      if (!state) return res.redirect(303, '/inbox?error=unknown');

      // La ventana de 24h de Meta manda tambien aqui: el boton ya no se pinta
      // fuera de ella, pero un formulario viejo o reenviado no puede colarse.
      if (!isWithinMessagingWindow(state)) return res.redirect(303, '/inbox?error=window');

      const adapter = adapters.get('instagram');
      if (!adapter) return res.redirect(303, '/inbox?error=api');

      try {
        await adapter.sendMessage(state.userId, { kind: 'text', text: texto });
      } catch (err) {
        logger.error({ err, user: state.userId }, 'Fallo el envio manual desde la bandeja');
        return res.redirect(303, '/inbox?error=api');
      }

      // Solo se registra despues de que Meta lo acepto: un hilo que muestra un
      // mensaje que nunca salio es peor que no mostrar nada.
      //
      // Se relee el estado antes de escribir. Mientras esperabamos a Meta pudo
      // entrar un webhook de ESTE mismo usuario (el caso normal: sigue
      // escribiendo), y guardar el objeto viejo borraria su mensaje y
      // retrocederia `lastUserInteractionAt`, que es lo que sostiene la ventana
      // de 24h. El store reescribe el estado completo, no campos sueltos.
      const fresco = (await store.get('instagram', state.userId, cuentaDeLaBandeja)) ?? state;
      agregarMensaje(fresco, { dir: 'out', kind: 'text', text: texto, at: Date.now() });
      await store.upsert(fresco);

      return res.redirect(303, '/inbox?sent=ok');
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

  // Direccion que no existe. Sin esto, el cliente que toca un enlace viejo o con
  // un typo ve la pagina cruda del servidor, sin estilo y a medio traducir.
  app.use((_req, res) => {
    res
      .status(404)
      .type('html')
      .send(
        mensajeDelPanel(
          'No encontramos esa página',
          'No encontramos esa página',
          'Puede que el enlace esté incompleto o sea viejo. Vuelve a abrir el que te enviaron.',
        ),
      );
  });

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
