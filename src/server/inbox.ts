import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isWithinMessagingWindow, type ConversationState } from '../store/conversationStore.js';
import { esc } from './html.js';

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

function fmtTime(ms: number): string {
  // ISO corto (UTC) — determinista y legible en la revision.
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * La cuenta de Instagram sobre la que actua la app. La revision de Meta exige
 * que el activo (Page, cuenta o numero) se VEA en pantalla antes del envio:
 * "asset selection (Page, account, or number visible)". Por eso no es un dato
 * de configuracion escondido, sino cabecera de la pantalla.
 */
export interface CuentaConectada {
  /** IG Business Account ID (el activo). */
  id: string;
  /** Handle, si la API lo devolvio. */
  username?: string;
  /** Si la consulta de salud a Meta respondio OK. */
  conectada: boolean;
}

/** Aviso del resultado de la ultima accion (patron POST-Redirect-GET). */
export interface AvisoDeBandeja {
  tipo: 'ok' | 'error';
  texto: string;
}

export interface OpcionesDeBandeja {
  cuenta: CuentaConectada;
  /**
   * Credencial de la bandeja. De aqui sale el campo firmado del formulario:
   * se firma POR CONVERSACION, no uno solo para toda la pantalla.
   */
  pass: string;
  aviso?: AvisoDeBandeja;
  /** Inyectable para que las pruebas fijen la ventana de 24h sin esperar. */
  ahora?: number;
}

// ── Prueba de origen del formulario ───────────────────────────────────────

/** Cada cuanto cambia el token de origen. Se acepta el actual y el anterior. */
export const VENTANA_DEL_TOKEN_MS = 30 * 60 * 1000;

function firma(pass: string, userId: string, franja: number): string {
  return createHmac('sha256', pass).update(`inbox:origen:${userId}:${franja}`).digest('base64url');
}

/**
 * Token atado a la credencial de la bandeja, al usuario de esa conversacion y a
 * una franja de media hora. Un sitio de terceros puede hacer que el navegador
 * envie el formulario (y con el las credenciales Basic), pero no puede LEER
 * esta pagina para copiar el token: sin el campo, el envio se rechaza.
 *
 * La franja existe porque un token fijo, guardado una vez de una pagina vieja,
 * valdria para siempre. Se acepta tambien la franja anterior para que un
 * formulario abierto justo antes del cambio de media hora no muera al enviarlo.
 */
export function tokenDeOrigenDeLaBandeja(
  pass: string,
  userId: string,
  ahora = Date.now(),
): string {
  return firma(pass, userId, Math.floor(ahora / VENTANA_DEL_TOKEN_MS));
}

export function origenDeLaBandejaValido(
  pass: string,
  userId: string,
  enviado: unknown,
  ahora = Date.now(),
): boolean {
  if (!pass || !userId) return false;
  if (typeof enviado !== 'string' || enviado.length === 0) return false;
  const franja = Math.floor(ahora / VENTANA_DEL_TOKEN_MS);
  // Se comparan las dos sin corto-circuito: el tiempo de respuesta no debe
  // decir cual de las dos fallo.
  const actual = igual(firma(pass, userId, franja), enviado);
  const previa = igual(firma(pass, userId, franja - 1), enviado);
  return actual || previa;
}

function igual(esperado: string, recibido: string): boolean {
  const a = Buffer.from(esperado);
  const b = Buffer.from(recibido);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Piezas de HTML ────────────────────────────────────────────────────────

const ESTILOS = `
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f5f6f8; color: #1c1e21; }
  header.top { background: #0d1b2a; color: #fff; padding: 16px 24px; }
  header.top h1 { margin: 0; font-size: 18px; }
  header.top p { margin: 4px 0 0; font-size: 13px; opacity: .85; }
  .asset { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; padding: 10px 12px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.18); border-radius: 8px; font-size: 13px; }
  .asset .label { text-transform: uppercase; letter-spacing: .06em; font-size: 10px; opacity: .8; }
  .asset select { font: inherit; padding: 4px 8px; border-radius: 6px; border: 1px solid #c9ccd1; background: #fff; color: #1c1e21; }
  .asset .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .asset .dot.on { background: #31a24c; }
  .asset .dot.off { background: #e0b400; }
  main { max-width: 820px; margin: 0 auto; padding: 20px 16px; }
  .notice { padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  .notice.ok { background: #d7f0dd; border: 1px solid #9fd8b1; }
  .notice.error { background: #ffe0e0; border: 1px solid #f0b4b4; }
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
  .acciones { padding: 0 16px 14px; }
  .boton { display: inline-block; font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 8px; border: 1px solid #1877f2; background: #1877f2; color: #fff; text-decoration: none; cursor: pointer; }
  .boton.secundario { background: #fff; color: #1877f2; }
  .cerrada { font-size: 13px; color: #65676b; }
  form.responder { padding: 14px 16px; border-top: 1px solid #eef0f3; display: flex; flex-direction: column; gap: 10px; }
  form.responder label { font-size: 13px; color: #65676b; }
  form.responder input[type=text] { font: inherit; padding: 10px 12px; border: 1px solid #c9ccd1; border-radius: 8px; }
  .pie { text-align: center; font-size: 12px; color: #65676b; padding: 8px 0 24px; }
  .empty { color: #65676b; text-align: center; padding: 40px; }
`;

/**
 * Cabecera con el activo. El `select` lista las cuentas de Instagram que esta
 * instalacion maneja: hoy es una, y por eso va deshabilitado en vez de
 * fingir una eleccion que no existe. Lo que importa para la revision es que el
 * ID y el handle de la cuenta que envia esten a la vista en la misma pantalla
 * donde ocurre el envio.
 */
function cabecera(cuenta: CuentaConectada, subtitulo: string): string {
  const handle = cuenta.username ? `@${esc(cuenta.username)}` : '(handle unavailable)';
  const estado = cuenta.conectada
    ? '<span class="dot on"></span> Connected'
    : '<span class="dot off"></span> Status unavailable';
  return `<header class="top">
  <h1>Inbox — LeoDMsBot</h1>
  <p>${esc(subtitulo)}</p>
  <div class="asset">
    <span class="label">Sending as</span>
    <select name="asset" title="Instagram Business account this app sends messages from. This installation manages one account." disabled>
      <option>${handle} — IG Business Account ID ${esc(cuenta.id || 'not configured')}</option>
    </select>
    <span title="Result of a live GET /{ig-id}?fields=id,username call to the Meta Graph API">${estado}</span>
  </div>
</header>`;
}

function pagina(
  titulo: string,
  cabeceraHtml: string,
  cuerpo: string,
  /** Segundos y destino del auto-refresco. Sin destino, se repetiria la URL
   *  actual CON su query: el aviso de "mensaje enviado" quedaria afirmandose
   *  cada cinco segundos, mucho despues del envio. */
  refresco?: { segundos: number; url: string },
): string {
  const refrescoHtml = refresco
    ? `<meta http-equiv="refresh" content="${refresco.segundos};url=${esc(refresco.url)}" />`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${refrescoHtml}
<title>${esc(titulo)}</title>
<style>${ESTILOS}</style>
</head>
<body>
${cabeceraHtml}
<main>
${cuerpo}
</main>
</body>
</html>`;
}

function avisoHtml(aviso: AvisoDeBandeja | undefined): string {
  if (!aviso) return '';
  return `<p class="notice ${aviso.tipo}">${esc(aviso.texto)}</p>`;
}

function burbujas(state: ConversationState): string {
  return state.messages
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
}

function titulo(c: ConversationState): string {
  return esc(c.username ? `@${c.username}` : c.userId);
}

/**
 * Renderiza la bandeja (/inbox) como HTML simple, en INGLES (requisito de la
 * revision de Meta). Muestra cada conversacion con sus mensajes entrantes
 * ("received") y salientes ("sent"), el activo que envia, y el boton que lleva
 * a responder a mano.
 */
export function renderInboxHtml(states: ConversationState[], opciones: OpcionesDeBandeja): string {
  const ahora = opciones.ahora ?? Date.now();
  const convos = [...states].sort((a, b) => b.lastUserInteractionAt - a.lastUserInteractionAt);

  const rows = convos
    .map((c) => {
      const abierta = isWithinMessagingWindow(c, ahora);
      const accion = abierta
        ? `<a class="boton" href="/inbox/reply?user=${encodeURIComponent(c.userId)}" title="Open the composer to send a direct message to this user from this app">Reply from the app</a>`
        : `<span class="cerrada" title="Meta policy: a business can only send a free-form message within 24 hours of the user's last interaction">Reply window closed — the user must interact again (Meta 24-hour rule).</span>`;
      return (
        `<section class="conv">` +
        `<header><strong>${titulo(c)}</strong><span class="meta">${esc(`${c.platform} · id ${c.userId}`)}</span></header>` +
        `<div class="thread">${burbujas(c) || '<em>No messages yet</em>'}</div>` +
        `<div class="acciones">${accion}</div>` +
        `</section>`
      );
    })
    .join('');

  const cuerpo =
    avisoHtml(opciones.aviso) +
    (rows || '<p class="empty">No conversations yet.</p>') +
    '<p class="pie">This list refreshes automatically every 5 seconds.</p>';

  // Auto-refresco solo en la LISTA. La pantalla de respuesta no se refresca: un
  // refresco a media escritura borraria lo que el operador esta tecleando.
  return pagina(
    'Inbox — LeoDMsBot',
    cabecera(
      opciones.cuenta,
      'Instagram conversations handled by this app (inbound & outbound), grouped by user.',
    ),
    cuerpo,
    { segundos: 5, url: '/inbox' },
  );
}

/**
 * Pantalla de respuesta manual (/inbox/reply): el mismo hilo mas el campo de
 * texto y el boton que dispara el envio real a la API de Meta. Es la accion que
 * la revision pide ver en vivo ("a live send action from your app").
 */
export function renderReplyHtml(state: ConversationState, opciones: OpcionesDeBandeja): string {
  const ahora = opciones.ahora ?? Date.now();
  const abierta = isWithinMessagingWindow(state, ahora);

  const formulario = abierta
    ? `<form class="responder" method="post" action="/inbox/send">
  <input type="hidden" name="user" value="${esc(state.userId)}" />
  <input type="hidden" name="origen" value="${esc(tokenDeOrigenDeLaBandeja(opciones.pass, state.userId, ahora))}" />
  <label for="text">Message to send as ${esc(opciones.cuenta.username ? '@' + opciones.cuenta.username : 'the connected account')} — it is delivered to this user's Instagram inbox.</label>
  <input id="text" type="text" name="text" maxlength="900" required
         placeholder="Type the message the user will receive in Instagram"
         title="Text of the direct message. Sending calls the Meta Graph API endpoint POST /{ig-id}/messages." />
  <button class="boton" type="submit" title="Sends this message now to the user's Instagram account through the Meta Graph API">Send message</button>
</form>`
    : `<div class="acciones"><p class="cerrada">Reply window closed. Meta allows a free-form message only within 24 hours of the user's last interaction, so this app does not send one.</p></div>`;

  const cuerpo =
    avisoHtml(opciones.aviso) +
    `<section class="conv">` +
    `<header><strong>${titulo(state)}</strong><span class="meta">${esc(`${state.platform} · id ${state.userId}`)}</span></header>` +
    `<div class="thread">${burbujas(state) || '<em>No messages yet</em>'}</div>` +
    formulario +
    `</section>` +
    `<p class="pie"><a href="/inbox" title="Back to the list of conversations">Back to all conversations</a></p>`;

  return pagina(
    `Reply — ${state.username ? '@' + state.username : state.userId}`,
    cabecera(opciones.cuenta, 'Send a direct message to this user from the app.'),
    cuerpo,
  );
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
