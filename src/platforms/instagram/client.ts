import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { OutgoingMessage } from '../../core/types.js';

const BASE = () => `https://graph.facebook.com/${env.GRAPH_API_VERSION}`;

/**
 * Cliente delgado sobre el Graph API de Meta para Instagram.
 * Documentacion: developers.facebook.com/docs/instagram-platform
 */
export class InstagramClient {
  private readonly token = env.IG_ACCESS_TOKEN;
  private readonly igId = env.IG_BUSINESS_ACCOUNT_ID;

  /** Envia un mensaje segun su tipo. Traduce OutgoingMessage al formato de Meta. */
  async send(userId: string, message: OutgoingMessage): Promise<void> {
    if (env.DRY_RUN) {
      logger.info({ to: userId, message }, '🧪 [DRY_RUN] envio simulado (no se llama al Graph API)');
      return;
    }
    const body = this.buildMessageBody(userId, message);
    await this.post(`/${this.igId}/messages`, body);
  }

  private buildMessageBody(userId: string, message: OutgoingMessage): Record<string, unknown> {
    switch (message.kind) {
      case 'text':
        return { recipient: { id: userId }, message: { text: message.text } };

      case 'image':
        return {
          recipient: { id: userId },
          message: { attachment: { type: 'image', payload: { url: message.url } } },
        };

      case 'buttons':
        // Usamos quick_replies: vuelven como un mensaje con quick_reply.payload,
        // que el parser convierte en un evento 'postback'.
        return {
          recipient: { id: userId },
          message: {
            text: message.text,
            quick_replies: message.buttons.map((b) => ({
              content_type: 'text',
              title: b.title,
              payload: b.payload,
            })),
          },
        };

      case 'private_reply':
        // Respuesta privada a un comentario: recipient es el comment_id.
        return { recipient: { comment_id: message.commentId }, message: { text: message.text } };
    }
  }

  /**
   * Consulta si un usuario (por su IGSID de conversacion) sigue a la cuenta.
   * Campo del Graph API: is_user_follow_business.
   * Devuelve null si el campo no viene o la API falla, para no bloquear el flujo.
   */
  async isUserFollowBusiness(userId: string): Promise<boolean | null> {
    if (env.DRY_RUN) {
      logger.info({ userId, result: env.SIM_IS_FOLLOWER }, '🧪 [DRY_RUN] follow status simulado');
      return env.SIM_IS_FOLLOWER;
    }
    try {
      const url = new URL(`${BASE()}/${userId}`);
      url.searchParams.set('fields', 'is_user_follow_business');
      url.searchParams.set('access_token', this.token);
      const res = await fetch(url, { method: 'GET' });
      const json = (await res.json()) as {
        is_user_follow_business?: boolean;
        error?: unknown;
      };
      if (!res.ok || json.error) {
        logger.warn({ status: res.status, error: json.error }, 'isUserFollowBusiness fallo');
        return null;
      }
      if (typeof json.is_user_follow_business !== 'boolean') return null;
      return json.is_user_follow_business;
    } catch (err) {
      logger.error({ err }, 'Error consultando follow status');
      return null;
    }
  }

  /**
   * Obtiene el caption (copy) de un post/reel por su media id.
   * Campo del Graph API: caption. null si falla o no tiene texto.
   */
  async getMediaCaption(mediaId: string): Promise<string | null> {
    if (env.DRY_RUN) {
      logger.info({ mediaId, caption: env.SIM_CAPTION }, '🧪 [DRY_RUN] caption simulado');
      return env.SIM_CAPTION;
    }
    try {
      const url = new URL(`${BASE()}/${mediaId}`);
      url.searchParams.set('fields', 'caption');
      url.searchParams.set('access_token', this.token);
      const res = await fetch(url, { method: 'GET' });
      const json = (await res.json()) as { caption?: string; error?: unknown };
      if (!res.ok || json.error) {
        logger.warn({ status: res.status, error: json.error }, 'getMediaCaption fallo');
        return null;
      }
      return json.caption ?? null;
    } catch (err) {
      logger.error({ err }, 'Error obteniendo caption');
      return null;
    }
  }

  /** Epoch ms de publicacion del media (campo timestamp del Graph API). */
  async getMediaTimestamp(mediaId: string): Promise<number | null> {
    if (env.DRY_RUN) {
      const iso = env.SIM_MEDIA_TIMESTAMP || new Date().toISOString();
      const ms = Date.parse(iso);
      logger.info({ mediaId, iso }, '🧪 [DRY_RUN] timestamp de media simulado');
      return Number.isNaN(ms) ? Date.now() : ms;
    }
    try {
      const url = new URL(`${BASE()}/${mediaId}`);
      url.searchParams.set('fields', 'timestamp');
      url.searchParams.set('access_token', this.token);
      const res = await fetch(url, { method: 'GET' });
      const json = (await res.json()) as { timestamp?: string; error?: unknown };
      if (!res.ok || json.error || !json.timestamp) {
        logger.warn({ status: res.status, error: json.error }, 'getMediaTimestamp fallo');
        return null;
      }
      const ms = Date.parse(json.timestamp);
      return Number.isNaN(ms) ? null : ms;
    } catch (err) {
      logger.error({ err }, 'Error obteniendo timestamp de media');
      return null;
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<void> {
    const url = `${BASE()}${path}?access_token=${encodeURIComponent(this.token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      logger.error({ status: res.status, detail, body }, 'Fallo envio a Graph API');
      throw new Error(`Graph API ${res.status}: ${detail}`);
    }
  }
}
