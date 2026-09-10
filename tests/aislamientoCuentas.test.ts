import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

/**
 * Tarea 4: a quien pertenece cada cuenta, y que nadie vea la de otro.
 *
 * Tres frentes, porque la fuga puede entrar por cualquiera de los tres:
 *  1. El panel: pedir a mano la cuenta ajena por la URL.
 *  2. La bandeja `/inbox`: antes listaba las conversaciones de TODAS las cuentas.
 *  3. El motor: a que cuenta se escribe lo que llega por el webhook.
 */
process.env.PANEL_ENABLED = 'true';
process.env.SESSION_SECRET = 'secreto-de-pruebas-largo-para-firmar-cookies-1234';
process.env.DRY_RUN = 'true';
process.env.STORE_BACKEND = 'memory';
process.env.RESOURCES_SHEET_CSV_URL = '';
process.env.META_APP_SECRET = 'no-usado-en-este-test';
process.env.INBOX_USER = 'operador';
process.env.INBOX_PASS = 'clave-de-prueba';

const { createApp } = await import('../src/server/app.js');
const { FlowEngine } = await import('../src/core/flowEngine.js');
const { StoreFunnelRecorder } = await import('../src/core/funnel.js');
const { InMemoryConversationStore } = await import('../src/store/conversationStore.js');
const { InMemoryPanelStore } = await import('../src/store/panelStore.js');
const { InMemoryAccountRegistry } = await import('../src/core/account.js');
const { InstagramAdapter } = await import('../src/platforms/instagram/instagramAdapter.js');
const { SESSION_COOKIE } = await import('../src/server/auth.js');

const CUENTA_A = 'tienda-de-marcela';
const CUENTA_B = 'panaderia-de-jose';
const IG_A = 'ig-biz-marcela';
const IG_B = 'ig-biz-jose';

const registry = () =>
  new InMemoryAccountRegistry([
    {
      id: CUENTA_A,
      platform: 'instagram',
      igBusinessAccountId: IG_A,
      accessToken: 'token-a',
    },
    {
      id: CUENTA_B,
      platform: 'instagram',
      igBusinessAccountId: IG_B,
      accessToken: 'token-b',
    },
  ]);

function levantar(cuentaDeLaBandeja = CUENTA_A) {
  const panel = new InMemoryPanelStore();
  const store = new InMemoryConversationStore();
  const adapters = new Map([['instagram', new InstagramAdapter()]]);
  const engine = new FlowEngine(
    store,
    adapters,
    undefined,
    undefined,
    CUENTA_A,
    new StoreFunnelRecorder(panel),
    registry(),
  );
  const server = createApp(engine, adapters, store, panel, cuentaDeLaBandeja).listen(0);
  return { panel, store, engine, server, port: (server.address() as AddressInfo).port };
}

const url = (port: number, ruta: string) => `http://127.0.0.1:${port}${ruta}`;

async function entrar(port: number, panel: InstanceType<typeof InMemoryPanelStore>, cuenta: string) {
  const { token } = await panel.createInvite({ accountId: cuenta, role: 'owner', ttlMs: 60_000 });
  const res = await fetch(url(port, '/panel/entrar'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ t: token }).toString(),
  });
  const linea = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(SESSION_COOKIE));
  const valor = (linea as string).slice(SESSION_COOKIE.length + 1).split(';')[0];
  return { cookie: `${SESSION_COOKIE}=${valor}` };
}

test('pedir a mano la cuenta ajena por la URL devuelve negado, no datos', async () => {
  const { panel, server, port } = levantar();
  try {
    const marcela = await entrar(port, panel, CUENTA_A);
    // Jose entra tambien, asi la cuenta B existe de verdad en el almacen.
    await entrar(port, panel, CUENTA_B);

    const suya = await fetch(url(port, `/panel?cuenta=${CUENTA_A}`), {
      headers: { cookie: marcela.cookie },
    });
    const ajena = await fetch(url(port, `/panel?cuenta=${CUENTA_B}`), {
      headers: { cookie: marcela.cookie },
    });

    assert.equal(suya.status, 200, 'la suya si la ve');
    assert.equal(ajena.status, 404, 'la ajena responde como si no existiera');
    assert.ok(
      !(await ajena.text()).includes(CUENTA_B),
      'ni siquiera puede confirmar que esa cuenta existe',
    );
  } finally {
    server.close();
  }
});

test('la bandeja solo muestra las conversaciones de SU cuenta', async () => {
  const { store, server, port } = levantar(CUENTA_A);
  try {
    await store.upsert({
      accountId: CUENTA_A,
      platform: 'instagram',
      userId: 'ig-cliente-de-marcela',
      username: 'clienta_marcela',
      lastUserInteractionAt: Date.now(),
      messages: [{ dir: 'in', kind: 'comment', text: 'quiero la GUIA', at: Date.now() }],
      data: {},
    });
    await store.upsert({
      accountId: CUENTA_B,
      platform: 'instagram',
      userId: 'ig-cliente-de-jose',
      username: 'cliente_jose',
      lastUserInteractionAt: Date.now(),
      messages: [{ dir: 'in', kind: 'comment', text: 'quiero el PAN', at: Date.now() }],
      data: {},
    });

    const auth = 'Basic ' + Buffer.from('operador:clave-de-prueba').toString('base64');
    const res = await fetch(url(port, '/inbox'), { headers: { authorization: auth } });
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.match(html, /clienta_marcela/, 'la conversacion propia si aparece');
    assert.ok(
      !html.includes('cliente_jose'),
      'FUGA: la bandeja mostraba conversaciones de otro cliente',
    );
    assert.ok(!html.includes('PAN'), 'FUGA: se veia el texto de otro cliente');
  } finally {
    server.close();
  }
});

test('lo que llega por el webhook se escribe en la cuenta que lo recibio', async () => {
  const { store, engine, server } = levantar();
  try {
    await engine.handle({
      platform: 'instagram',
      type: 'comment',
      user: { id: 'ig-persona-1', username: 'persona1' },
      text: 'quiero la GUIA',
      commentId: 'c-b-1',
      mediaId: 'media-1',
      recipientId: IG_B,
      timestamp: Date.now(),
    });

    const enB = await store.get('instagram', 'ig-persona-1', CUENTA_B);
    const enA = await store.get('instagram', 'ig-persona-1', CUENTA_A);

    assert.ok(enB, 'la conversacion tiene que quedar en la cuenta destinataria');
    assert.equal(enA, undefined, 'y NO en la cuenta primaria');
  } finally {
    server.close();
  }
});

test('un evento sin cuenta reconocible se descarta en vez de caer en la primaria', async () => {
  const { store, engine, server } = levantar();
  try {
    await engine.handle({
      platform: 'instagram',
      type: 'comment',
      user: { id: 'ig-persona-2' },
      text: 'quiero la GUIA',
      commentId: 'c-x-1',
      mediaId: 'media-1',
      recipientId: 'ig-biz-desconocida',
      timestamp: Date.now(),
    });

    assert.equal(
      (await store.list()).length,
      0,
      'escribir el evento de un cliente en la cuenta de otro es peor que perderlo',
    );
  } finally {
    server.close();
  }
});

test('con una sola cuenta configurada, todo sigue igual que antes', async () => {
  // Es el caso de hoy en produccion: no se puede romper por hacer multi-cuenta.
  const panel = new InMemoryPanelStore();
  const store = new InMemoryConversationStore();
  const adapters = new Map([['instagram', new InstagramAdapter()]]);
  const unaSola = new InMemoryAccountRegistry([
    { id: 'default', platform: 'instagram', igBusinessAccountId: IG_A, accessToken: 't' },
  ]);
  const engine = new FlowEngine(
    store,
    adapters,
    undefined,
    undefined,
    'default',
    new StoreFunnelRecorder(panel),
    unaSola,
  );

  await engine.handle({
    platform: 'instagram',
    type: 'comment',
    user: { id: 'ig-persona-3' },
    text: 'quiero la GUIA',
    commentId: 'c-1',
    mediaId: 'media-1',
    // Sin destinatario reconocible: con una sola cuenta NO se descarta.
    recipientId: 'lo-que-sea',
    timestamp: Date.now(),
  });

  assert.equal((await store.list('default')).length, 1, 'la cuenta unica sigue recibiendo todo');
});

test('el parser rescata la cuenta destinataria del webhook', async () => {
  const { parseInstagramWebhook } = await import(
    '../src/platforms/instagram/webhookParser.js'
  );

  const porComentario = parseInstagramWebhook({
    object: 'instagram',
    entry: [
      {
        id: IG_B,
        time: Date.now(),
        changes: [
          {
            field: 'comments',
            value: { id: 'c1', text: 'GUIA', from: { id: 'u1' }, media: { id: 'm1' } },
          },
        ],
      },
    ],
  });
  const porMensaje = parseInstagramWebhook({
    object: 'instagram',
    entry: [
      {
        id: 'no-mires-aqui',
        time: Date.now(),
        messaging: [
          {
            sender: { id: 'u2' },
            recipient: { id: IG_A },
            timestamp: Date.now(),
            message: { mid: 'm1', text: 'hola' },
          },
        ],
      },
    ],
  });

  assert.equal(porComentario[0]?.recipientId, IG_B, 'en comentarios manda entry.id');
  assert.equal(porMensaje[0]?.recipientId, IG_A, 'en mensajes manda recipient.id');
});
