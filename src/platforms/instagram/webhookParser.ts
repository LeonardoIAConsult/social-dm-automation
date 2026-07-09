import type { IncomingEvent } from '../../core/types.js';

/**
 * Traduce el payload crudo del webhook de Instagram a eventos normalizados.
 * Soporta: DMs (messaging), quick replies, postbacks, story replies y comentarios.
 * Ignora los "echoes" (mensajes que envio la propia cuenta).
 */
export function parseInstagramWebhook(body: unknown): IncomingEvent[] {
  const events: IncomingEvent[] = [];
  const payload = body as InstagramWebhookBody;
  if (payload?.object !== 'instagram' || !Array.isArray(payload.entry)) return events;

  for (const entry of payload.entry) {
    // Rama 1: mensajeria (DMs, quick replies, postbacks, story replies).
    for (const m of entry.messaging ?? []) {
      const senderId = m.sender?.id;
      if (!senderId) continue;
      const timestamp = m.timestamp ?? entry.time ?? Date.now();

      if (m.postback?.payload) {
        events.push({
          platform: 'instagram',
          type: 'postback',
          user: { id: senderId },
          payload: m.postback.payload,
          timestamp,
          raw: m,
        });
        continue;
      }

      if (m.message) {
        if (m.message.is_echo) continue; // lo envio la cuenta, no procesar
        if (m.message.quick_reply?.payload) {
          events.push({
            platform: 'instagram',
            type: 'postback',
            user: { id: senderId },
            payload: m.message.quick_reply.payload,
            text: m.message.text,
            timestamp,
            raw: m,
          });
          continue;
        }
        events.push({
          platform: 'instagram',
          type: m.message.reply_to?.story ? 'story_reply' : 'message',
          user: { id: senderId },
          text: m.message.text,
          timestamp,
          raw: m,
        });
      }
    }

    // Rama 2: cambios (comentarios en posts/reels).
    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments') continue;
      const v = change.value;
      if (!v?.from?.id) continue;
      events.push({
        platform: 'instagram',
        type: 'comment',
        user: { id: v.from.id, username: v.from.username },
        text: v.text,
        commentId: v.id,
        mediaId: v.media?.id,
        timestamp: entry.time ?? Date.now(),
        raw: change,
      });
    }
  }

  return events;
}

// ── Formas parciales del payload de Meta (solo lo que usamos) ──────────────
interface InstagramWebhookBody {
  object?: string;
  entry?: InstagramEntry[];
}
interface InstagramEntry {
  id?: string;
  time?: number;
  messaging?: MessagingItem[];
  changes?: ChangeItem[];
}
interface MessagingItem {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    reply_to?: { story?: unknown };
  };
  postback?: { payload?: string; title?: string };
}
interface ChangeItem {
  field?: string;
  value?: {
    id?: string;
    text?: string;
    from?: { id?: string; username?: string };
    media?: { id?: string };
  };
}
