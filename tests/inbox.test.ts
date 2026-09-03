import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryConversationStore } from '../src/store/conversationStore.js';
import { FlowEngine } from '../src/core/flowEngine.js';
import { renderInboxHtml, basicAuthOk } from '../src/server/inbox.js';
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
  const html = renderInboxHtml([
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
  ]);
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
