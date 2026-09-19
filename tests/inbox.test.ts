import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { FlowEngine } from '../src/core/flowEngine.js';
import {
  renderInboxHtml,
  renderReplyHtml,
  basicAuthOk,
  tokenDeOrigenDeLaBandeja,
  origenDeLaBandejaValido,
  VENTANA_DEL_TOKEN_MS,
  type OpcionesDeBandeja,
} from '../src/server/inbox.js';
import { campaigns } from '../src/core/campaigns.js';
import type { PlatformAdapter, OutgoingMessage } from '../src/core/types.js';

/** Construye el header Basic para user:pass. */
function basic(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

/** Adaptador falso: registra lo que se "envia" y se declara follower. */
function fakeAdapter(sent: OutgoingMessage[]): PlatformAdapter {
  return {
    platform: 'instagram',
    verifySignature() {},
    parseWebhook() {
      return [];
    },
    async sendMessage(_userId, message) {
      sent.push(message);
    },
    async isFollower() {
      return true;
    },
  };
}


/** Opciones minimas de la vista: la cuenta que envia y el campo de origen. */
function opciones(): OpcionesDeBandeja {
  return {
    cuenta: { id: '17841400000000001', username: 'emprende_al_exito', conectada: true },
    pass: 'clave',
  };
}

test('InMemoryConversationStore.list devuelve las conversaciones guardadas', async () => {
  const store = new InMemoryConversationStore();
  await store.upsert({ platform: 'instagram', userId: 'U1', lastUserInteractionAt: 1, data: {}, messages: [] });
  await store.upsert({ platform: 'instagram', userId: 'U2', lastUserInteractionAt: 2, data: {}, messages: [] });
  const all = await store.list();
  assert.equal(all.length, 2);
});

test('el engine registra el mensaje ENTRANTE en la conversacion (threaded por usuario)', async () => {
  const store = new InMemoryConversationStore();
  const adapters = new Map<string, PlatformAdapter>();
  adapters.set('instagram', fakeAdapter([]));
  const engine = new FlowEngine(store, adapters);

  await engine.handle({
    platform: 'instagram',
    type: 'comment',
    user: { id: 'U1', username: 'juan' },
    text: 'quiero la GUIA',
    commentId: 'C1',
    mediaId: 'M1',
    timestamp: Date.now(),
  });

  const convos = await store.list();
  assert.equal(convos.length, 1);
  assert.equal(convos[0]?.username, 'juan');
  const inbound = convos[0]?.messages.filter((m) => m.dir === 'in') ?? [];
  assert.ok(inbound.length >= 1, 'debe registrar al menos un mensaje entrante');
  assert.equal(inbound[0]?.text, 'quiero la GUIA');
  assert.equal(inbound[0]?.kind, 'comment');
});

test('el historial de la conversacion se poda al tope (no crece sin techo)', async () => {
  const store = new InMemoryConversationStore();
  const adapters = new Map<string, PlatformAdapter>();
  adapters.set('instagram', fakeAdapter([]));
  const engine = new FlowEngine(store, adapters);

  for (let i = 0; i < 60; i++) {
    await engine.handle({
      platform: 'instagram',
      type: 'message',
      user: { id: 'U1', username: 'juan' },
      text: `msg-${i}`,
      timestamp: Date.now(),
    });
  }

  const convo = (await store.list())[0];
  assert.ok(convo);
  assert.ok(convo.messages.length <= 50, `esperado <=50, fue ${convo.messages.length}`);
});

test('doble tap concurrente entrega una sola vez (no DM duplicado)', async () => {
  const NAME = 'test-race';
  campaigns.push({
    name: NAME,
    trigger: { mode: 'keywords', keywords: ['__nomatch__'], eventTypes: ['comment'] },
    requireFollow: false,
    copy: {
      getLinkButtonTitle: 'x',
      askToFollow: 'x',
      followedButtonTitle: 'x',
      stillNotFollowing: 'x',
    },
    deliver: [{ kind: 'text', text: 'AQUI-TU-LINK' }],
  });
  try {
    const store = new InMemoryConversationStore();
    const sent: OutgoingMessage[] = [];
    const adapters = new Map<string, PlatformAdapter>();
    adapters.set('instagram', fakeAdapter(sent));
    const engine = new FlowEngine(store, adapters);

    // El estado YA existe (el usuario interactuo antes) -> los dos postbacks
    // comparten el mismo objeto de estado, que es donde ocurre el race real.
    await store.upsert({
      platform: 'instagram',
      userId: 'U1',
      lastUserInteractionAt: Date.now(),
      data: {},
      messages: [],
    });

    const postback = {
      platform: 'instagram' as const,
      type: 'postback' as const,
      user: { id: 'U1' },
      payload: `GET_LINK:${NAME}`,
      timestamp: Date.now(),
    };
    await Promise.all([engine.handle(postback), engine.handle(postback)]);

    const deliveries = sent.filter((m) => 'text' in m && m.text === 'AQUI-TU-LINK');
    assert.equal(deliveries.length, 1, `debe entregar una sola vez, fueron ${deliveries.length}`);
  } finally {
    const i = campaigns.findIndex((c) => c.name === NAME);
    if (i >= 0) campaigns.splice(i, 1);
  }
});

test('renderInboxHtml muestra usuario, inbound y outbound en ingles, y escapa HTML', () => {
  const now = Date.now();
  const html = renderInboxHtml(
    [
      {
        platform: 'instagram',
        userId: 'U1',
        username: 'juan',
        lastUserInteractionAt: now,
        data: {},
        messages: [
          { dir: 'in', kind: 'comment', text: 'quiero la GUIA <b>hola</b>', at: now },
          { dir: 'out', kind: 'private_reply', text: 'Here is your link', at: now },
        ],
      },
    ],
    opciones(),
  );
  assert.match(html, /juan/);
  assert.match(html, /quiero la GUIA/);
  assert.match(html, /Here is your link/);
  assert.match(html, /received/i, 'etiqueta en ingles para inbound');
  assert.match(html, /sent/i, 'etiqueta en ingles para outbound');
  assert.doesNotMatch(html, /<b>hola<\/b>/, 'el HTML del mensaje debe ir escapado');
});

test('basicAuthOk: acepta credenciales correctas y rechaza el resto', () => {
  const U = 'leo';
  const P = 'demo123';
  assert.equal(basicAuthOk(basic(U, P), U, P), true, 'credenciales correctas');
  assert.equal(basicAuthOk(basic(U, 'mala'), U, P), false, 'password incorrecto');
  assert.equal(basicAuthOk(basic('otro', P), U, P), false, 'usuario incorrecto');
  assert.equal(basicAuthOk(undefined, U, P), false, 'sin header');
  assert.equal(basicAuthOk('Bearer xyz', U, P), false, 'esquema no Basic');
  assert.equal(basicAuthOk(basic(U, P), '', ''), false, 'sin config -> nunca autoriza');
  assert.equal(basicAuthOk('Basic @@notbase64@@', U, P), false, 'header malformado');
});

test('la bandeja ofrece responder con la ventana abierta y la cierra a las 24h', () => {
  const ahora = Date.now();
  const base = {
    platform: 'instagram' as const,
    userId: 'U1',
    username: 'juan',
    data: {},
    messages: [{ dir: 'in' as const, kind: 'message', text: 'hola', at: ahora }],
  };

  const abierta = renderInboxHtml([{ ...base, lastUserInteractionAt: ahora }], opciones());
  assert.match(abierta, /\/inbox\/reply\?user=U1/, 'con la ventana abierta, deja responder');

  const cerrada = renderInboxHtml(
    [{ ...base, lastUserInteractionAt: ahora - 25 * 60 * 60 * 1000 }],
    opciones(),
  );
  assert.doesNotMatch(cerrada, /\/inbox\/reply\?user=U1/, 'pasadas 24h, no ofrece responder');
  assert.match(cerrada, /24-hour/, 'y explica por que, en ingles');
});

test('renderReplyHtml: formulario con la cuenta a la vista; sin ventana, sin formulario', () => {
  const ahora = Date.now();
  const base = {
    platform: 'instagram' as const,
    userId: 'U1',
    username: 'juan',
    data: {},
    messages: [{ dir: 'in' as const, kind: 'message', text: 'thanks!', at: ahora }],
  };

  const html = renderReplyHtml({ ...base, lastUserInteractionAt: ahora }, opciones());
  assert.match(html, /action="\/inbox\/send"/);
  assert.match(html, /name="origen"/);
  assert.match(html, /@emprende_al_exito/, 'el activo que envia, visible en la misma pantalla');
  assert.match(html, /17841400000000001/, 'y su ID');

  const sinVentana = renderReplyHtml(
    { ...base, lastUserInteractionAt: ahora - 25 * 60 * 60 * 1000 },
    opciones(),
  );
  assert.doesNotMatch(sinVentana, /action="\/inbox\/send"/, 'fuera de la ventana no hay boton');
});

test('el token de origen esta atado a la credencial Y a la conversacion', () => {
  const t = tokenDeOrigenDeLaBandeja('clave', 'U1');
  assert.equal(origenDeLaBandejaValido('clave', 'U1', t), true);
  assert.equal(origenDeLaBandejaValido('otra-clave', 'U1', t), false, 'otra credencial no vale');
  assert.equal(
    origenDeLaBandejaValido('clave', 'U2', t),
    false,
    'el token de una conversacion no sirve para otra',
  );
  assert.equal(origenDeLaBandejaValido('clave', 'U1', 'inventado'), false);
  assert.equal(origenDeLaBandejaValido('clave', 'U1', ''), false);
  assert.equal(origenDeLaBandejaValido('clave', 'U1', undefined), false);
  assert.equal(origenDeLaBandejaValido('', 'U1', t), false, 'sin credencial configurada, nunca');
  assert.equal(origenDeLaBandejaValido('clave', '', t), false, 'sin conversacion, nunca');
});

test('el token de origen caduca: vale la franja actual y la anterior, no una vieja', () => {
  const ahora = Date.now();
  const deAhora = tokenDeOrigenDeLaBandeja('clave', 'U1', ahora);
  const media = VENTANA_DEL_TOKEN_MS;

  assert.equal(
    origenDeLaBandejaValido('clave', 'U1', deAhora, ahora + media),
    true,
    'un formulario abierto hace un rato todavia se puede enviar',
  );
  assert.equal(
    origenDeLaBandejaValido('clave', 'U1', deAhora, ahora + 3 * media),
    false,
    'un token guardado de una pagina vieja NO vale para siempre',
  );
});

test('el auto-refresco de la lista apunta a /inbox limpio (el aviso no se repite)', () => {
  const ahora = Date.now();
  const html = renderInboxHtml(
    [
      {
        platform: 'instagram',
        userId: 'U1',
        lastUserInteractionAt: ahora,
        data: {},
        messages: [],
      },
    ],
    { ...opciones(), aviso: { tipo: 'ok', texto: 'Message accepted' } },
  );
  assert.match(
    html,
    /http-equiv="refresh" content="5;url=\/inbox"/,
    'sin destino, el refresco repetiria la URL con ?sent=ok y el aviso quedaria clavado',
  );
});
