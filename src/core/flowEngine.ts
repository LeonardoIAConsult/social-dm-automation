import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  isWithinMessagingWindow,
  type ConversationState,
  type ConversationStore,
} from '../store/conversationStore.js';
import { captionCampaigns, getCampaign, matchCampaign, type Campaign } from './campaigns.js';
import { extractKeywordFromCaption } from './keywordExtractor.js';
import { googleDrive, toDateFolderName } from '../integrations/googleDrive.js';
import type { IncomingEvent, PlatformAdapter } from './types.js';

/** Prefijo del payload del boton "Obtener el enlace" (abre la ventana de 24h). */
const GET_PREFIX = 'GET_LINK:';

/** Prefijo del payload que reintenta el gate tras "ya te sigo". */
const CHECK_PREFIX = 'CHECK_FOLLOW:';

/** Cuanto confiar en el cache de follow antes de re-consultar la API. */
const FOLLOW_CACHE_TTL_MS = 60 * 1000;

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

      const campaign = await this.resolveCampaign(adapter, event);
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
    const button = { title: campaign.copy.getLinkButtonTitle, payload: GET_PREFIX + campaign.name };
    const text = campaign.copy.welcome ?? '¡Hola! 👋';

    if (event.type === 'comment' && event.commentId) {
      // Respuesta privada al comentario, con el boton adjunto. Es el unico envio
      // permitido antes de que la persona interactue de vuelta.
      await adapter.sendMessage(state.userId, {
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
    event: IncomingEvent,
  ): Promise<Campaign | undefined> {
    const direct = matchCampaign(event.type, event.text, event.mediaId);
    if (direct) return direct;

    if (event.type !== 'comment' || !event.mediaId || !event.text) return undefined;
    const candidates = captionCampaigns(event.type, event.mediaId);
    if (candidates.length === 0) return undefined;

    const keyword = await this.resolveCaptionKeyword(adapter, event.mediaId);
    if (!keyword) return undefined;
    if (!event.text.toUpperCase().includes(keyword)) return undefined;

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
    for (const msg of campaign.deliver) {
      await this.safeSend(adapter, state, msg);
    }
    await this.deliverFromDrive(adapter, state, campaign);
    state.data[flagKey] = true;
    state.step = 'delivered';
    logger.info({ user: state.userId, campaign: campaign.name }, 'Valor entregado ✅');
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
    await adapter.sendMessage(state.userId, message);
  }

  private async loadState(event: IncomingEvent): Promise<ConversationState> {
    const existing = await this.store.get(event.platform, event.user.id);
    if (existing) return existing;
    return {
      platform: event.platform,
      userId: event.user.id,
      lastUserInteractionAt: event.timestamp || Date.now(),
      data: {},
    };
  }
}
