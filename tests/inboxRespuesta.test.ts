import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

/**
 * La respuesta manual desde la bandeja, por HTTP y de punta a punta.
 *
 * Existe por un rechazo concreto de la revision de Meta (16-sep-2026): el
 * revisor pidio ver "a live send action from your app" con el activo a la vista.
 * Lo que se prueba aqui es justo eso: que la pantalla muestra la cuenta que
 * envia, que el boton manda de verdad por el adaptador, que el saliente queda
 * en el mismo hilo, y que las dos puertas (origen y ventana de 24h) cierran.
 *
 * El entorno se fija ANTES de cargar la config: dotenv no pisa lo existente.
 */
process.env.PANEL_ENABLED = 'false';
process.env.DRY_RUN = 'true';
process.env.STORE_BACKEND = 'memory';
process.env.RESOURCES_SHEET_CSV_URL = '';
process.env.META_APP_SECRET = 'no-usado-en-este-test';
process.env.IG_BUSINESS_ACCOUNT_ID = '17841400000000001';
process.env.INBOX_USER = 'reviewer';
process.env.INBOX_PASS = 'clave-de-la-bandeja';

const { createApp } = await import('../src/server/app.js');
const { FlowEngine } = await import('../src/core/flowEngine.js');
const { InMemoryConversationStore } = await import('../src/store/conversationStore.js');
const { tokenDeOrigenDeLaBandeja } = await import('../src/server/inbox.js');
const { DEFAULT_ACCOUNT_ID } = await import('../src/core/account.js');
import type { OutgoingMessage, PlatformAdapter } from '../src/core/types.js';
import type { ConversationState, ConversationStore } from '../src/store/conversationStore.js';

const USUARIO = 'IGSID-777';
const AUTH = 'Basic ' + Buffer.from('reviewer:clave-de-la-bandeja').toString('base64');
const ORIGEN = tokenDeOrigenDeLaBandeja('clave-de-la-bandeja', USUARIO);

/** Adaptador falso: anota lo enviado y responde la salud como la cuenta real. */
function adaptadorFalso(enviados: Array<{ userId: string; message: OutgoingMessage }>) {
  const adapter: PlatformAdapter & { salud: () => Promise<{ estado: 'ok'; username: string }> } = {
    platform: 'instagram',
    verifySignature() {},
    parseWebhook() {
      return [];
    },
    async sendMessage(userId, message) {
      enviados.push({ userId, message });
    },
    async isFollower() {
      return true;
    },
    async salud() {
      return { estado: 'ok', username: 'emprende_al_exito' };
    },
  };
  return adapter;
}


/**
 * Envuelve un store para que copie al leer y al escribir, como hace cualquier
 * base real al serializar. Sin esto, dos escritores comparten el mismo objeto
 * en memoria y una perdida de escritura es invisible.
 */
function comoLaBaseDeVerdad(store: ConversationStore): ConversationStore {
  const copia = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  return {
    async get(platform, userId, accountId) {
      return copia(await store.get(platform, userId, accountId));
    },
    async upsert(state) {
      await store.upsert(copia(state));
    },
    async list(accountId) {
      return copia(await store.list(accountId));
    },
  };
}

/** Conversacion con la ventana de 24h abierta (o cerrada, si se pide). */
function conversacion(abierta = true): ConversationState {
  const hace25h = Date.now() - 25 * 60 * 60 * 1000;
  return {
    accountId: DEFAULT_ACCOUNT_ID,
    platform: 'instagram',
    userId: USUARIO,
    username: 'ejecutivosyemprendedores',
    lastUserInteractionAt: abierta ? Date.now() : hace25h,
    messages: [{ dir: 'in', kind: 'message', text: 'thanks!', at: Date.now() }],
    data: {},
  };
}

async function levantar(abierta = true) {
  const enviados: Array<{ userId: string; message: OutgoingMessage }> = [];
  const adapters = new Map<string, PlatformAdapter>([['instagram', adaptadorFalso(enviados)]]);
  const store = new InMemoryConversationStore();
  await store.upsert(conversacion(abierta));
  const engine = new FlowEngine(store, adapters);
  const server = createApp(engine, adapters, store).listen(0);
  const port = (server.address() as AddressInfo).port;
  return { enviados, store, server, port };
}

const url = (port: number, ruta: string) => `http://127.0.0.1:${port}${ruta}`;

function enviar(port: number, campos: Record<string, string>, auth = AUTH) {
  return fetch(url(port, '/inbox/send'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: auth },
    body: new URLSearchParams(campos).toString(),
  });
}

test('la bandeja muestra el activo: handle e ID de la cuenta que envia', async () => {
  const { server, port } = await levantar();
  try {
    const res = await fetch(url(port, '/inbox'), { headers: { authorization: AUTH } });
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Sending as/, 'debe decir desde que cuenta se envia');
    assert.match(html, /@emprende_al_exito/, 'el handle de la cuenta, a la vista');
    assert.match(html, /17841400000000001/, 'el ID del activo, a la vista');
  } finally {
    server.close();
  }
});

test('la pantalla de respuesta trae el formulario de envio y NO se auto-refresca', async () => {
  const { server, port } = await levantar();
  try {
    const res = await fetch(url(port, `/inbox/reply?user=${USUARIO}`), {
      headers: { authorization: AUTH },
    });
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /action="\/inbox\/send"/, 'formulario que envia de verdad');
    assert.match(html, /name="origen"/, 'campo firmado de origen');
    assert.match(html, /Send message/, 'boton de envio en ingles');
    assert.doesNotMatch(
      html,
      /http-equiv="refresh"/,
      'un refresco automatico borraria lo que el operador escribe',
    );
  } finally {
    server.close();
  }
});

test('enviar desde la bandeja llama al adaptador y deja el saliente en el mismo hilo', async () => {
  const { enviados, store, server, port } = await levantar();
  try {
    const res = await enviar(port, { user: USUARIO, origen: ORIGEN, text: '  Here is your link  ' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/inbox?sent=ok');

    assert.equal(enviados.length, 1, 'debe salir exactamente un mensaje');
    assert.equal(enviados[0]?.userId, USUARIO);
    assert.deepEqual(enviados[0]?.message, { kind: 'text', text: 'Here is your link' });

    const estado = await store.get('instagram', USUARIO, DEFAULT_ACCOUNT_ID);
    const salientes = estado?.messages.filter((m) => m.dir === 'out') ?? [];
    assert.equal(salientes.length, 1, 'el saliente queda en el hilo de ese usuario');
    assert.equal(salientes[0]?.text, 'Here is your link');
  } finally {
    server.close();
  }
});

test('sin el campo de origen no se envia nada (CSRF)', async () => {
  const { enviados, server, port } = await levantar();
  try {
    const res = await enviar(port, { user: USUARIO, origen: 'inventado', text: 'hola' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/inbox?error=origin');
    assert.equal(enviados.length, 0, 'no puede salir un mensaje sin prueba de origen');
  } finally {
    server.close();
  }
});

test('sin credenciales no se envia nada (401, y el mensaje no sale)', async () => {
  const { enviados, server, port } = await levantar();
  try {
    const res = await enviar(port, { user: USUARIO, origen: ORIGEN, text: 'hola' }, 'Basic bWFsbzpt');
    assert.equal(res.status, 401);
    assert.equal(enviados.length, 0);
  } finally {
    server.close();
  }
});

test('fuera de la ventana de 24h no se envia, aunque el formulario venga bien', async () => {
  const { enviados, server, port } = await levantar(false);
  try {
    const res = await enviar(port, { user: USUARIO, origen: ORIGEN, text: 'hola' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/inbox?error=window');
    assert.equal(enviados.length, 0, 'la politica de Meta manda por encima del formulario');
  } finally {
    server.close();
  }
});

test('un texto vacio no llega al adaptador', async () => {
  const { enviados, server, port } = await levantar();
  try {
    const res = await enviar(port, { user: USUARIO, origen: ORIGEN, text: '   ' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/inbox?error=empty');
    assert.equal(enviados.length, 0);
  } finally {
    server.close();
  }
});

test('si Meta rechaza el envio, el hilo NO muestra un mensaje que nunca salio', async () => {
  const enviados: Array<{ userId: string; message: OutgoingMessage }> = [];
  const adapter = adaptadorFalso(enviados);
  adapter.sendMessage = async () => {
    throw new Error('Graph API 400: fuera de politica');
  };
  const adapters = new Map<string, PlatformAdapter>([['instagram', adapter]]);
  const store = new InMemoryConversationStore();
  await store.upsert(conversacion());
  const engine = new FlowEngine(store, adapters);
  const server = createApp(engine, adapters, store).listen(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await enviar(port, { user: USUARIO, origen: ORIGEN, text: 'no deberia quedar' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/inbox?error=api');
    const estado = await store.get('instagram', USUARIO, DEFAULT_ACCOUNT_ID);
    const salientes = estado?.messages.filter((m) => m.dir === 'out') ?? [];
    assert.equal(salientes.length, 0, 'solo se registra lo que Meta acepto');
  } finally {
    server.close();
  }
});

test('la conversacion de otra cuenta no se puede responder desde esta bandeja', async () => {
  const enviados: Array<{ userId: string; message: OutgoingMessage }> = [];
  const adapters = new Map<string, PlatformAdapter>([['instagram', adaptadorFalso(enviados)]]);
  const store = new InMemoryConversationStore();
  await store.upsert({ ...conversacion(), accountId: 'otro-cliente' });
  const engine = new FlowEngine(store, adapters);
  const server = createApp(engine, adapters, store).listen(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await enviar(port, { user: USUARIO, origen: ORIGEN, text: 'hola' });
    assert.equal(res.headers.get('location'), '/inbox?error=unknown');
    assert.equal(enviados.length, 0, 'sin fuga entre cuentas');
  } finally {
    server.close();
  }
});

test('el token de otra conversacion no sirve para enviar a esta', async () => {
  const { enviados, server, port } = await levantar();
  try {
    const ajeno = tokenDeOrigenDeLaBandeja('clave-de-la-bandeja', 'OTRO-USUARIO');
    const res = await enviar(port, { user: USUARIO, origen: ajeno, text: 'hola' });
    assert.equal(res.headers.get('location'), '/inbox?error=origin');
    assert.equal(enviados.length, 0);
  } finally {
    server.close();
  }
});

test('un webhook que entra mientras Meta responde NO se pierde del hilo', async () => {
  // La carrera real del screencast: el operador responde mientras el usuario
  // sigue escribiendo. El store reescribe el estado entero, asi que guardar el
  // objeto leido antes del envio borraria el entrante y retrocederia la ventana.
  //
  // Va contra un store que COPIA en cada lectura y escritura. Con el de memoria
  // pelado esta prueba no probaba nada: devuelve el MISMO objeto a los dos
  // escritores, asi que el bug no podia manifestarse. Los stores de verdad
  // (Postgres y archivo) serializan, que es justo lo que se imita aqui.
  const enviados: Array<{ userId: string; message: OutgoingMessage }> = [];
  const adapter = adaptadorFalso(enviados);
  const store = comoLaBaseDeVerdad(new InMemoryConversationStore());
  await store.upsert(conversacion());

  // Durante el envio llega el webhook: otro entrante para el mismo usuario.
  adapter.sendMessage = async (userId, message) => {
    const vivo = await store.get('instagram', USUARIO, DEFAULT_ACCOUNT_ID);
    assert.ok(vivo);
    vivo.messages.push({ dir: 'in', kind: 'message', text: 'una pregunta mas', at: Date.now() });
    vivo.lastUserInteractionAt = Date.now();
    await store.upsert(vivo);
    enviados.push({ userId, message });
  };

  const adapters = new Map<string, PlatformAdapter>([['instagram', adapter]]);
  const engine = new FlowEngine(store, adapters);
  const server = createApp(engine, adapters, store).listen(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await enviar(port, { user: USUARIO, origen: ORIGEN, text: 'respuesta manual' });
    assert.equal(res.headers.get('location'), '/inbox?sent=ok');

    const estado = await store.get('instagram', USUARIO, DEFAULT_ACCOUNT_ID);
    const textos = (estado?.messages ?? []).map((m) => m.text);
    assert.ok(
      textos.includes('una pregunta mas'),
      `el entrante que llego durante el envio no puede desaparecer: ${JSON.stringify(textos)}`,
    );
    assert.ok(textos.includes('respuesta manual'), 'y el saliente tambien queda');
  } finally {
    server.close();
  }
});
