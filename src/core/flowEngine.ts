import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  isWithinMessagingWindow,
  type ConversationMessage,
  type ConversationState,
  type ConversationStore,
} from '../store/conversationStore.js';
import {
  captionCampaigns,
  getCampaign,
  matchCampaign,
  sheetCampaigns,
  type Campaign,
} from './campaigns.js';
import { extractKeywordFromCaption } from './keywordExtractor.js';
import { matchesKeyword } from './textMatch.js';
import { NoopRateLimiter, type RateLimiter } from './rateLimiter.js';
import type { SendQueue } from './sendQueue.js';
import { DEFAULT_ACCOUNT_ID } from './account.js';
import { getResource, findMatchingKeyword, getDmDefault } from './resources.js';
import { googleDrive, toDateFolderName } from '../integrations/googleDrive.js';
import type { IncomingEvent, PlatformAdapter } from './types.js';

/** Prefijo del payload del boton "Obtener el enlace" (abre la ventana de 24h). */
const GET_PREFIX = 'GET_LINK:';

/** Marca interna: entregar el recurso por defecto de DM (ej. Calendar). */
const DM_DEFAULT = '__dm_default__';

/** Prefijo del payload que reintenta el gate tras "ya te sigo". */
const CHECK_PREFIX = 'CHECK_FOLLOW:';

/** Cuanto confiar en el cache de follow antes de re-consultar la API. */
const FOLLOW_CACHE_TTL_MS = 60 * 1000;

/**
 * Tope de mensajes guardados por conversacion (bandeja /inbox). Evita que el
 * historial crezca sin techo: con el store en disco, cada upsert reescribe el
 * archivo completo, asi que un historial ilimitado degrada disco + latencia.
 */
const MAX_MESSAGES = 50;

/**
 * El engine recibe eventos ya normalizados y decide que hacer:
 * hace match de campana, aplica el follow-gate y entrega el valor.
 * No sabe nada de Instagram; usa el PlatformAdapter.
 */
export class FlowEngine {
  /** Cache de keyword derivada por media, para no pedir el caption en cada comentario. */
  private readonly captionKeywordCache = new Map<string, string | null>();

  constructor(
    private readonly store: ConversationStore,
    private readonly adapters: Map<string, PlatformAdapter>,
    /** Backstop anti-ban: tope de envios por ventana. Noop = sin limite (tests/dry-run). */
    private readonly rateLimiter: RateLimiter = new NoopRateLimiter(),
    /** Cola de envios opcional (gap #2). Si se pasa, los envios se encolan con
     *  reintentos y requeue por rate-limit; el rate-limit lo aplica la cola.
     *  Si es undefined (default), el envio es sincrono como siempre. */
    private readonly sendQueue?: SendQueue,
    /** Tenant al que pertenecen las conversaciones de este engine (SaaS
     *  multi-cuenta). Default 'default' = single-account. El ruteo por-evento
     *  (resolver la cuenta segun el IG destinatario) es fase posterior. */
    private readonly accountId: string = DEFAULT_ACCOUNT_ID,
  ) {}

  async handle(event: IncomingEvent): Promise<void> {
    const adapter = this.adapters.get(event.platform);
    if (!adapter) {
      logger.warn({ platform: event.platform }, 'No hay adaptador para la plataforma');
      return;
    }

    const state = await this.loadState(event);
    // La llegada de cualquier evento del usuario renueva la ventana de 24h.
    // Usamos la hora de RECEPCION (ahora): el usuario acaba de interactuar, asi
    // evitamos problemas de unidad (Meta envia el timestamp en segundos, no ms).
    state.lastUserInteractionAt = Date.now();
    // Guarda el username para mostrarlo en la bandeja (/inbox).
    if (event.user.username) state.username = event.user.username;
    // Registra el evento ENTRANTE en el hilo de la conversacion (bandeja /inbox).
    this.recordMessage(state, {
      dir: 'in',
      kind: event.type,
      text: event.text ?? event.payload,
      at: Date.now(),
    });
    // Recuerda el post de origen: la entrega por Drive lo necesita aunque el
    // usuario llegue luego por el boton "ya te sigo" (postback sin mediaId).
    if (event.mediaId) state.data.mediaId = event.mediaId;

    try {
      // El usuario toco "Obtener el enlace": su interaccion abrio la ventana de
      // 24h, ahora SI podemos aplicar el gate y entregar el valor por DM.
      if (event.type === 'postback' && event.payload?.startsWith(GET_PREFIX)) {
        const campaign = getCampaign(event.payload.slice(GET_PREFIX.length));
        if (campaign) await this.runGate(adapter, state, campaign);
        return;
      }

      // El usuario toco "Ya te sigo": re-chequeamos el follow.
      if (event.type === 'postback' && event.payload?.startsWith(CHECK_PREFIX)) {
        const campaign = getCampaign(event.payload.slice(CHECK_PREFIX.length));
        if (campaign) await this.runGate(adapter, state, campaign);
        return;
      }

      const campaign = await this.resolveCampaign(adapter, state, event);
      if (!campaign) {
        logger.debug({ type: event.type, text: event.text }, 'Sin campana que haga match');
        return;
      }

      state.activeFlow = campaign.name;
      // Patron comment-to-DM (estilo ManyChat): NO entregamos aun. Mandamos el
      // welcome con el boton "Obtener el enlace". Al tocarlo, el usuario abre la
      // ventana de 24h y ahi entregamos (regla de Meta: no puedes mandar DMs de
      // seguimiento hasta que la persona interactue de vuelta).
      await this.sendEntry(adapter, state, campaign, event);
    } finally {
      await this.store.upsert(state);
    }
  }

  /** Envia el mensaje de entrada (welcome + boton "Obtener el enlace"). */
  private async sendEntry(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
    event: IncomingEvent,
  ): Promise<void> {
    // Si el recurso es la agenda/Calendar (DM sin keyword), usa el copy de cita.
    const isDm = state.data.matchedKeyword === DM_DEFAULT;
    const button = {
      title: (isDm && campaign.copy.dmButtonTitle) || campaign.copy.getLinkButtonTitle,
      payload: GET_PREFIX + campaign.name,
    };
    const text = (isDm && campaign.copy.dmWelcome) || campaign.copy.welcome || '¡Hola! 👋';

    if (event.type === 'comment' && event.commentId) {
      // Respuesta privada al comentario, con el boton adjunto. Es el unico envio
      // permitido antes de que la persona interactue de vuelta. Va por safeSend
      // (que deja pasar private_reply) para quedar registrado en la bandeja.
      await this.safeSend(adapter, state, {
        kind: 'private_reply',
        commentId: event.commentId,
        text,
        buttons: [button],
      });
    } else {
      // Disparado por DM entrante: la ventana ya esta abierta, mandamos con boton.
      await this.safeSend(adapter, state, { kind: 'buttons', text, buttons: [button] });
    }
  }

  /**
   * Decide que campana aplica al evento.
   * 1) Campanas en modo 'keywords' (match directo por texto).
   * 2) Campanas en modo 'caption': deriva la keyword del copy del post en runtime
   *    y dispara si el comentario la contiene.
   */
  private async resolveCampaign(
    adapter: PlatformAdapter,
    state: ConversationState,
    event: IncomingEvent,
  ): Promise<Campaign | undefined> {
    const direct = matchCampaign(event.type, event.text, event.mediaId);
    if (direct) {
      // Guarda cual keyword hizo match, para entregar el recurso mapeado.
      state.data.matchedKeyword = direct.trigger.keywords.find((k) =>
        matchesKeyword(event.text, k),
      );
      return direct;
    }

    // Modo 'sheet': el comentario/DM matchea cualquier palabra de la hoja.
    const sheets = sheetCampaigns(event.type);
    if (sheets.length > 0) {
      const kw = event.text ? await findMatchingKeyword(event.text) : undefined;
      if (kw) {
        state.data.matchedKeyword = kw;
        logger.info({ keyword: kw }, 'Palabra de la hoja detectada');
        return sheets[0];
      }
      // DM sin palabra clave -> recurso por defecto (ej. link de agenda/Calendar),
      // definido en la fila con CTA "Escríbeme por DM". Opt-in: apagado por
      // defecto para no auto-responder a cada DM normal (conversaciones, dudas).
      if (env.DM_DEFAULT_ENABLED && event.type === 'message' && (await getDmDefault())) {
        state.data.matchedKeyword = DM_DEFAULT;
        logger.info('DM sin keyword -> recurso por defecto');
        return sheets[0];
      }
    }

    // Modo 'caption': deriva la keyword del copy del post (requiere comentario).
    if (event.type !== 'comment' || !event.mediaId || !event.text) return undefined;
    const candidates = captionCampaigns(event.type, event.mediaId);
    if (candidates.length === 0) return undefined;

    const keyword = await this.resolveCaptionKeyword(adapter, event.mediaId);
    if (!keyword) return undefined;
    if (!matchesKeyword(event.text, keyword)) return undefined;

    state.data.matchedKeyword = keyword;
    logger.info({ mediaId: event.mediaId, keyword }, 'Keyword derivada del copy del post');
    return candidates[0];
  }

  /** Obtiene (con cache) la keyword derivada del caption de un media. */
  private async resolveCaptionKeyword(
    adapter: PlatformAdapter,
    mediaId: string,
  ): Promise<string | null> {
    if (this.captionKeywordCache.has(mediaId)) {
      return this.captionKeywordCache.get(mediaId) ?? null;
    }
    const caption = adapter.getMediaCaption ? await adapter.getMediaCaption(mediaId) : null;
    const keyword = extractKeywordFromCaption(caption);
    this.captionKeywordCache.set(mediaId, keyword);
    return keyword;
  }

  /** Corazon del follow-gate: entrega si pasa, si no pide seguir. */
  private async runGate(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
  ): Promise<void> {
    const gateOn = env.FOLLOW_GATE_ENABLED && campaign.requireFollow;

    if (gateOn) {
      const follows = await this.checkFollow(adapter, state);
      if (follows === false) {
        // Reintento = la persona ya venia en 'awaiting_follow' y volvio a tocar.
        const retry = state.step === 'awaiting_follow';
        state.step = 'awaiting_follow';
        await this.safeSend(adapter, state, {
          kind: 'buttons',
          text: retry ? campaign.copy.stillNotFollowing : campaign.copy.askToFollow,
          buttons: [
            { title: campaign.copy.followedButtonTitle, payload: CHECK_PREFIX + campaign.name },
          ],
        });
        return;
      }
      // follows === null (no determinable) → dejamos pasar para no bloquear valor.
    }

    await this.deliver(adapter, state, campaign);
  }

  private async deliver(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
  ): Promise<void> {
    const flagKey = `delivered:${campaign.name}`;
    if (state.data[flagKey]) {
      logger.debug({ user: state.userId, campaign: campaign.name }, 'Ya entregado, se omite');
      return;
    }
    // Reclamamos la entrega ANTES de los envios (check y set sin await en medio =
    // atomico en el loop de eventos de Node). Dos webhooks concurrentes del mismo
    // usuario/campana (ej. doble tap del boton) no pueden entregar dos veces =
    // evita DM duplicado (riesgo de spam/ban). Tradeoff: si un envio falla no hay
    // reintento automatico (es el gap #2, diferido); el usuario re-dispara el flujo.
    state.data[flagKey] = true;
    state.step = 'delivered';
    for (const msg of campaign.deliver) {
      await this.safeSend(adapter, state, msg);
    }
    await this.deliverFromKeyword(adapter, state, campaign);
    await this.deliverFromDrive(adapter, state, campaign);
    logger.info({ user: state.userId, campaign: campaign.name }, 'Valor entregado ✅');
  }

  /** Entrega el recurso (link/doc) mapeado a la palabra clave detectada. */
  private async deliverFromKeyword(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
  ): Promise<void> {
    if (!campaign.deliverFromKeyword) return;
    const kw = typeof state.data.matchedKeyword === 'string' ? state.data.matchedKeyword : undefined;
    const res = kw === DM_DEFAULT ? await getDmDefault() : await getResource(kw);
    if (!res) {
      logger.warn({ keyword: kw }, 'Sin recurso mapeado para la keyword (revisa la hoja)');
      return;
    }
    if (res.text) await this.safeSend(adapter, state, { kind: 'text', text: res.text });
    await this.safeSend(adapter, state, { kind: 'text', text: res.url });
  }

  /** Entrega el documento de Drive resuelto por la fecha del post de origen. */
  private async deliverFromDrive(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
  ): Promise<void> {
    if (!campaign.driveDelivery?.enabled) return;

    const mediaId = typeof state.data.mediaId === 'string' ? state.data.mediaId : undefined;
    if (!mediaId || !adapter.getMediaTimestamp) {
      logger.warn({ user: state.userId }, 'Drive: sin mediaId/timestamp; se omite entrega Drive');
      return;
    }

    const ts = await adapter.getMediaTimestamp(mediaId);
    if (ts === null) {
      logger.warn({ mediaId }, 'Drive: no se pudo obtener la fecha del post');
      return;
    }

    const date = toDateFolderName(ts);
    const link = await googleDrive.resolveLinkByDate(date);
    if (!link) {
      logger.warn({ date }, 'Drive: sin documento para esa fecha; se omite');
      return;
    }

    if (campaign.driveDelivery.prependText) {
      await this.safeSend(adapter, state, { kind: 'text', text: campaign.driveDelivery.prependText });
    }
    await this.safeSend(adapter, state, { kind: 'text', text: link });
  }

  /** Consulta follow status con cache corto. */
  private async checkFollow(
    adapter: PlatformAdapter,
    state: ConversationState,
  ): Promise<boolean | null> {
    const now = Date.now();
    if (state.followCache && now - state.followCache.checkedAt < FOLLOW_CACHE_TTL_MS) {
      return state.followCache.isFollower;
    }
    const result = await adapter.isFollower(state.userId);
    if (result !== null) {
      state.followCache = { isFollower: result, checkedAt: now };
    }
    return result;
  }

  /**
   * Envia respetando la ventana de 24h. Las respuestas a comentarios
   * (private_reply) tienen su propia ventana y se dejan pasar.
   */
  private async safeSend(
    adapter: PlatformAdapter,
    state: ConversationState,
    message: Parameters<PlatformAdapter['sendMessage']>[1],
  ): Promise<void> {
    if (message.kind !== 'private_reply' && !isWithinMessagingWindow(state)) {
      logger.warn(
        { user: state.userId },
        'Fuera de ventana de 24h: no se envia para no violar politica de Meta',
      );
      return;
    }

    // Registro del saliente para la bandeja /inbox (mismo shape en ambas ramas).
    const outbound: ConversationMessage = {
      dir: 'out',
      kind: message.kind,
      text: 'text' in message ? message.text : undefined,
      at: Date.now(),
    };

    // Gap #2 (opt-in): con cola, registramos el saliente (optimista) y encolamos
    // el envio real. La cola aplica el rate-limit (requeue si topa) y reintenta
    // fallos transitorios; el webhook no espera al envio -> respuesta rapida.
    if (this.sendQueue) {
      this.recordMessage(state, outbound);
      this.sendQueue.enqueue({ platform: state.platform, userId: state.userId, message });
      return;
    }

    // Sin cola (default): envio sincrono. Backstop anti-ban: si superamos el tope
    // por hora de la cuenta, omitimos (aqui no hay requeue; para eso esta la cola).
    if (!this.rateLimiter.tryAcquire(state.platform)) {
      logger.warn(
        { user: state.userId, platform: state.platform },
        'Tope de envios por hora alcanzado: se omite el envio (anti-ban Meta)',
      );
      return;
    }
    await adapter.sendMessage(state.userId, message);
    this.recordMessage(state, outbound); // registra en la bandeja /inbox
  }

  /**
   * Agrega un mensaje al hilo y poda al tope (conserva los mas recientes).
   * Punto unico para que entrante y saliente respeten el limite.
   */
  private recordMessage(state: ConversationState, msg: ConversationMessage): void {
    state.messages.push(msg);
    if (state.messages.length > MAX_MESSAGES) {
      state.messages.splice(0, state.messages.length - MAX_MESSAGES);
    }
  }

  private async loadState(event: IncomingEvent): Promise<ConversationState> {
    const existing = await this.store.get(event.platform, event.user.id, this.accountId);
    if (existing) return existing;
    return {
      accountId: this.accountId,
      platform: event.platform,
      userId: event.user.id,
      lastUserInteractionAt: event.timestamp || Date.now(),
      messages: [],
      data: {},
    };
  }
}
