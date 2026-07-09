import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  isWithinMessagingWindow,
  type ConversationState,
  type ConversationStore,
} from '../store/conversationStore.js';
import { getCampaign, matchCampaign, type Campaign } from './campaigns.js';
import type { IncomingEvent, PlatformAdapter } from './types.js';

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
    state.lastUserInteractionAt = event.timestamp || Date.now();

    try {
      if (event.type === 'postback' && event.payload?.startsWith(CHECK_PREFIX)) {
        const campaignName = event.payload.slice(CHECK_PREFIX.length);
        const campaign = getCampaign(campaignName);
        if (campaign) await this.runGate(adapter, state, campaign, event);
        return;
      }

      const campaign = matchCampaign(event.type, event.text, event.mediaId);
      if (!campaign) {
        logger.debug({ type: event.type, text: event.text }, 'Sin campana que haga match');
        return;
      }

      // Respuesta publica al comentario (una sola vez), sin revelar el valor.
      if (event.type === 'comment' && event.commentId && campaign.copy.publicReply) {
        await adapter.sendMessage(state.userId, {
          kind: 'private_reply',
          commentId: event.commentId,
          text: campaign.copy.publicReply,
        });
      }

      state.activeFlow = campaign.name;
      if (campaign.copy.welcome) {
        await this.safeSend(adapter, state, { kind: 'text', text: campaign.copy.welcome });
      }
      await this.runGate(adapter, state, campaign, event);
    } finally {
      await this.store.upsert(state);
    }
  }

  /** Corazon del follow-gate: entrega si pasa, si no pide seguir. */
  private async runGate(
    adapter: PlatformAdapter,
    state: ConversationState,
    campaign: Campaign,
    event: IncomingEvent,
  ): Promise<void> {
    const gateOn = env.FOLLOW_GATE_ENABLED && campaign.requireFollow;

    if (gateOn) {
      const follows = await this.checkFollow(adapter, state);
      if (follows === false) {
        state.step = 'awaiting_follow';
        const retry = event.type === 'postback';
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
    state.data[flagKey] = true;
    state.step = 'delivered';
    logger.info({ user: state.userId, campaign: campaign.name }, 'Valor entregado ✅');
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
