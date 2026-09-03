import { createHash, timingSafeEqual } from 'node:crypto';
import type { ConversationState } from '../store/conversationStore.js';

/**
 * Compara dos strings en tiempo constante (evita timing attacks).
 * Hasheamos a SHA-256 primero para trabajar con buffers de igual largo
 * (timingSafeEqual exige misma longitud) sin filtrar el largo real.
 */
function safeStrEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Escapa texto para insertarlo seguro en HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtTime(ms: number): string {
  // ISO corto (UTC) — determinista y legible en la revision.
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Renderiza la bandeja (/inbox) como HTML simple, en INGLES (requisito de la
 * revision de Meta). Muestra cada conversacion con sus mensajes entrantes
 * ("received") y salientes ("sent") en orden, ligados al mismo usuario.
 */
export function renderInboxHtml(states: ConversationState[]): string {
  const convos = [...states].sort((a, b) => b.lastUserInteractionAt - a.lastUserInteractionAt);

  const rows = convos
    .map((c) => {
      const title = esc(c.username ? `@${c.username}` : c.userId);
      const sub = esc(`${c.platform} · id ${c.userId}`);
      const bubbles = c.messages
        .map((m) => {
          const dirLabel = m.dir === 'in' ? 'received' : 'sent';
          const side = m.dir === 'in' ? 'in' : 'out';
          const text = esc(m.text ?? `(${m.kind})`);
          return (
            `<div class="msg ${side}">` +
            `<span class="dir">${dirLabel}</span>` +
            `<span class="kind">${esc(m.kind)}</span>` +
            `<div class="text">${text}</div>` +
            `<span class="time">${fmtTime(m.at)}</span>` +
            `</div>`
          );
        })
        .join('');
      return (
        `<section class="conv">` +
        `<header><strong>${title}</strong><span class="meta">${sub}</span></header>` +
        `<div class="thread">${bubbles || '<em>No messages yet</em>'}</div>` +
        `</section>`
      );
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Inbox — LeoDMsBot</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f5f6f8; color: #1c1e21; }
  header.top { background: #0d1b2a; color: #fff; padding: 16px 24px; }
  header.top h1 { margin: 0; font-size: 18px; }
  header.top p { margin: 4px 0 0; font-size: 13px; opacity: .8; }
  main { max-width: 820px; margin: 0 auto; padding: 20px 16px; }
  .conv { background: #fff; border: 1px solid #e2e5ea; border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
  .conv > header { display: flex; align-items: baseline; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #eef0f3; }
  .conv > header .meta { font-size: 12px; color: #65676b; }
  .thread { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .msg { max-width: 78%; padding: 8px 12px; border-radius: 12px; font-size: 14px; }
  .msg.in  { align-self: flex-start; background: #eceff3; }
  .msg.out { align-self: flex-end; background: #d7f0dd; }
  .msg .dir { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #65676b; margin-right: 6px; }
  .msg .kind { font-size: 10px; color: #8a8d91; }
  .msg .text { margin: 2px 0; white-space: pre-wrap; word-break: break-word; }
  .msg .time { font-size: 10px; color: #8a8d91; }
  .empty { color: #65676b; text-align: center; padding: 40px; }
</style>
</head>
<body>
<header class="top">
  <h1>Inbox — LeoDMsBot</h1>
  <p>Instagram conversations handled by the app (inbound &amp; outbound), grouped by user.</p>
</header>
<main>
  ${rows || '<p class="empty">No conversations yet.</p>'}
</main>
</body>
</html>`;
}

/**
 * Valida credenciales Basic Auth contra las esperadas.
 * Devuelve false si no hay credenciales configuradas (bandeja deshabilitada).
 */
export function basicAuthOk(
  header: string | undefined,
  expectedUser: string,
  expectedPass: string,
): boolean {
  if (!expectedUser || !expectedPass) return false; // sin config -> nunca autoriza
  if (!header?.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx === -1) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  // Constant-time: evaluamos ambos y luego combinamos, sin corto-circuito.
  const userOk = safeStrEqual(user, expectedUser);
  const passOk = safeStrEqual(pass, expectedPass);
  return userOk && passOk;
}
