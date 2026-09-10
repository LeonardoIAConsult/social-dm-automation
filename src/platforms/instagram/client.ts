import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { OutgoingMessage } from '../../core/types.js';

// Instagram API con Instagram Login usa graph.instagram.com (NO graph.facebook.com).
// Los tokens IGAA... solo son validos contra este host.
const BASE = () => `https://graph.instagram.com/${env.GRAPH_API_VERSION}`;

/**
 * Estado de la conexion de la cuenta, en los tres unicos desenlaces que el
 * cliente necesita distinguir para pintar su semaforo. Se separa
 * 'sin-permiso' de 'no-se-pudo' porque el primero exige que el cliente vuelva
 * a conectar su cuenta y el segundo solo pide esperar: mezclarlos manda a
 * reconectar a alguien que no tiene nada roto.
 */
export type SaludDeCuenta =
  | { estado: 'ok'; username?: string }
  | { estado: 'sin-permiso' }
  | { estado: 'no-se-pudo' };

/** Forma del error que devuelve Meta cuando rechaza una llamada. */
interface ErrorDeMeta {
  code?: number;
  type?: string;
  error_subcode?: number;
  message?: string;
}

/**
 * Meta contesta 400 casi para todo, asi que el HTTP solo no alcanza para saber
 * si el token murio. La senal real esta en el codigo: 190 (token invalido o
 * vencido), 102 (sesion caida), 10 y la familia 200-299 (permiso denegado).
 * Cualquier otro fallo se trata como transitorio a proposito: preferimos pedir
 * que reintenten antes que mandar a reconectar por un hipo de la red.
 */
function esFaltaDePermiso(status: number, error: ErrorDeMeta | undefined): boolean {
  // Meta caido nunca es culpa del token, aunque etiquete el error como OAuth
  // (sus 5xx genericos vienen con type OAuthException y code 1 o 2).
  if (status >= 500) return false;
  const code = error?.code;
  if (typeof code === 'number') {
    if (code === 190 || code === 102 || code === 10) return true;
    if (code >= 200 && code <= 299) return true;
    return false; // un codigo conocido que NO es de OAuth (ej. 4, tope de peticiones)
  }
  // Sin codigo con que decidir: el type de OAuth, y si tampoco, el 401 pelado.
  return error?.type === 'OAuthException' || status === 401;
}

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

      case 'private_reply': {
        // Respuesta privada a un comentario: recipient es el comment_id.
        // Puede incluir quick_replies (botones) para el patron comment-to-DM.
        const msg: Record<string, unknown> = { text: message.text };
        if (message.buttons?.length) {
          msg.quick_replies = message.buttons.map((b) => ({
            content_type: 'text',
            title: b.title,
            payload: b.payload,
          }));
        }
        return { recipient: { comment_id: message.commentId }, message: msg };
      }
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

  /**
   * Estado de la conexion de la cuenta del negocio, para el semaforo del panel.
   * Lo llama una pantalla, asi que NUNCA lanza: cualquier tropiezo sale como
   * 'no-se-pudo' antes que dejar el panel en blanco con un error sin traducir.
   */
  async salud(): Promise<SaludDeCuenta> {
    if (env.DRY_RUN) {
      logger.info('🧪 [DRY_RUN] salud de cuenta simulada');
      return { estado: 'ok', username: 'cuenta_de_prueba' };
    }
    try {
      const url = new URL(`${BASE()}/${this.igId}`);
      url.searchParams.set('fields', 'id,username');
      url.searchParams.set('access_token', this.token);
      const res = await fetch(url, { method: 'GET' });
      // Un 5xx suele venir en HTML: parsear aparte para que reviente aqui y no
      // se confunda con una respuesta de Meta que si dice algo.
      const json = (await res.json()) as { username?: string; error?: ErrorDeMeta };
      if (res.ok && !json.error) return { estado: 'ok', username: json.username };
      logger.warn({ status: res.status, error: json.error }, 'salud de cuenta fallo');
      return esFaltaDePermiso(res.status, json.error)
        ? { estado: 'sin-permiso' }
        : { estado: 'no-se-pudo' };
    } catch (err) {
      logger.error({ err }, 'Error consultando salud de la cuenta');
      return { estado: 'no-se-pudo' };
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
