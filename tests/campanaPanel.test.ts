import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

/**
 * Tareas 7 y 8: el cliente edita su campana desde el panel, y esa campana manda
 * sobre la Google Sheet SIN que nadie tenga que migrar nada.
 *
 * La regla de convivencia es la que importa: si la cuenta no tiene campanas en
 * el panel, todo funciona como hoy con la hoja. En cuanto guarda la primera, el
 * panel manda y la hoja deja de responder por esa cuenta.
 */
process.env.PANEL_ENABLED = 'true';
process.env.SESSION_SECRET = 'secreto-de-pruebas-largo-para-firmar-cookies-1234';
process.env.DRY_RUN = 'true';
process.env.STORE_BACKEND = 'memory';
process.env.RESOURCES_SHEET_CSV_URL = '';
process.env.FOLLOW_GATE_ENABLED = 'true';
process.env.META_APP_SECRET = 'no-usado';
process.env.INBOX_USER = '';
process.env.INBOX_PASS = '';
process.env.RATE_LIMIT_PER_HOUR = '0';

const { createApp } = await import('../src/server/app.js');
const { FlowEngine } = await import('../src/core/flowEngine.js');
const { StoreFunnelRecorder } = await import('../src/core/funnel.js');
const { FuentePanelPrimero, FuenteHoja } = await import('../src/core/recursos.js');
const { InMemoryConversationStore } = await import('../src/store/conversationStore.js');
const { InMemoryPanelStore } = await import('../src/store/panelStore.js');
const { InstagramAdapter } = await import('../src/platforms/instagram/instagramAdapter.js');
const { SESSION_COOKIE } = await import('../src/server/auth.js');
const { revisarEnlace } = await import('../src/core/enlaces.js');

const CUENTA = 'tienda-de-marcela';
const USUARIO = 'ig-persona';

function montar() {
  const panel = new InMemoryPanelStore();
  const store = new InMemoryConversationStore();
  const enviados: Array<{ userId: string; message: unknown }> = [];
  const adapter = {
    platform: 'instagram' as const,
    verifySignature() {},
    parseWebhook: () => [],
    async sendMessage(userId: string, message: unknown) {
      enviados.push({ userId, message });
    },
    async isFollower() {
      return true;
    },
  };
  const adapters = new Map([['instagram', adapter as never]]);
  const engine = new FlowEngine(
    store,
    adapters,
    undefined,
    undefined,
    CUENTA,
    new StoreFunnelRecorder(panel),
    undefined,
    new FuentePanelPrimero(panel),
  );
  const server = createApp(engine, adapters, store, panel).listen(0);
  return { panel, store, engine, enviados, server, port: (server.address() as AddressInfo).port };
}

const url = (port: number, ruta: string) => `http://127.0.0.1:${port}${ruta}`;

async function entrar(port: number, panel: InstanceType<typeof InMemoryPanelStore>) {
  const { token } = await panel.createInvite({ accountId: CUENTA, role: 'owner', ttlMs: 60_000 });
  const res = await fetch(url(port, '/panel/entrar'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ t: token }).toString(),
  });
  const linea = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(SESSION_COOKIE)) as string;
  return `${SESSION_COOKIE}=${linea.slice(SESSION_COOKIE.length + 1).split(';')[0]}`;
}

const guardar = (port: number, cookie: string, campos: Record<string, string>) =>
  fetch(url(port, '/panel/campana'), {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos).toString(),
  });

const comentario = (texto: string, id: string) => ({
  platform: 'instagram' as const,
  type: 'comment' as const,
  user: { id: USUARIO },
  text: texto,
  commentId: id,
  mediaId: 'media-1',
  timestamp: Date.now(),
});

const toque = () => ({
  platform: 'instagram' as const,
  type: 'postback' as const,
  user: { id: USUARIO },
  payload: 'GET_LINK:default',
  timestamp: Date.now(),
});

// ── Convivencia con la hoja (Tarea 8) ──────────────────────────────────────

test('sin campanas en el panel, manda la hoja: todo sigue como hoy', async () => {
  const panel = new InMemoryPanelStore();
  const fuente = new FuentePanelPrimero(panel);

  assert.equal(await fuente.origen(CUENTA), 'hoja');
  // "guia" es la palabra de la tabla de respaldo de resources.ts.
  const hallado = await fuente.buscar(CUENTA, 'quiero la GUIA');
  assert.ok(hallado, 'la hoja tiene que seguir respondiendo');
});

test('con una campana en el panel, la hoja deja de mandar en esa cuenta', async () => {
  const panel = new InMemoryPanelStore();
  await panel.saveCampaign({
    accountId: CUENTA,
    keyword: 'PLANTILLA',
    url: 'https://ejemplo.com/plantilla.pdf',
    requireFollow: true,
  });
  const fuente = new FuentePanelPrimero(panel);

  assert.equal(await fuente.origen(CUENTA), 'panel');
  assert.ok(await fuente.buscar(CUENTA, 'quiero la PLANTILLA'), 'la del panel responde');
  assert.equal(
    await fuente.buscar(CUENTA, 'quiero la GUIA'),
    undefined,
    'una palabra vieja de la hoja no puede seguir entregando: el cliente creeria que la borro',
  );
});

test('la convivencia es por cuenta: la de al lado sigue con su hoja', async () => {
  const panel = new InMemoryPanelStore();
  await panel.saveCampaign({
    accountId: CUENTA,
    keyword: 'PLANTILLA',
    url: 'https://ejemplo.com/p.pdf',
    requireFollow: true,
  });
  const fuente = new FuentePanelPrimero(panel);

  assert.equal(await fuente.origen('otra-cuenta'), 'hoja');
  assert.ok(await fuente.buscar('otra-cuenta', 'quiero la GUIA'));
});

test('la fuente de la hoja sola se comporta igual que siempre', async () => {
  const hoja = new FuenteHoja();
  assert.equal(await hoja.origen(), 'hoja');
  assert.ok(await hoja.buscar(CUENTA, 'dame la guía'), 'tildes y mayusculas dan igual');
});

// ── El motor entrega lo que el cliente guardo (Tareas 7 + 8 juntas) ────────

test('lo que el cliente guarda en el panel es lo que de verdad se entrega', async () => {
  const { panel, engine, enviados, server } = montar();
  try {
    await panel.saveCampaign({
      accountId: CUENTA,
      keyword: 'PLANTILLA',
      url: 'https://ejemplo.com/mi-plantilla.pdf',
      message: 'Aquí tienes 🎁',
      requireFollow: true,
    });

    await engine.handle(comentario('quiero la PLANTILLA', 'c-1'));
    await engine.handle(toque());

    const textos = enviados
      .map((e) => (e.message as { text?: string }).text ?? '')
      .join(' | ');
    assert.match(textos, /mi-plantilla\.pdf/, 'sale el enlace que guardo el cliente');
    assert.match(textos, /Aquí tienes/, 'y su mensaje');
  } finally {
    server.close();
  }
});

test('si el cliente apaga el follow-gate, se entrega sin exigir seguir', async () => {
  const panel = new InMemoryPanelStore();
  const store = new InMemoryConversationStore();
  const enviados: Array<{ text?: string }> = [];
  const adapter = {
    platform: 'instagram' as const,
    verifySignature() {},
    parseWebhook: () => [],
    async sendMessage(_u: string, m: { text?: string }) {
      enviados.push(m);
    },
    async isFollower() {
      return false; // NO sigue
    },
  };
  const engine = new FlowEngine(
    store,
    new Map([['instagram', adapter as never]]),
    undefined,
    undefined,
    CUENTA,
    new StoreFunnelRecorder(panel),
    undefined,
    new FuentePanelPrimero(panel),
  );
  await panel.saveCampaign({
    accountId: CUENTA,
    keyword: 'ABIERTA',
    url: 'https://ejemplo.com/abierta.pdf',
    requireFollow: false,
  });

  await engine.handle(comentario('quiero la ABIERTA', 'c-2'));
  await engine.handle(toque());

  const textos = enviados.map((m) => m.text ?? '').join(' | ');
  assert.match(textos, /abierta\.pdf/, 'se entrega aunque no siga, porque el cliente asi lo eligio');
});

// ── El editor (Tarea 7) ────────────────────────────────────────────────────

test('guardar una campana valida la deja activa y lo dice', async () => {
  const { panel, server, port } = montar();
  try {
    const cookie = await entrar(port, panel);

    const res = await guardar(port, cookie, {
      accion: 'guardar',
      palabra: 'PLANTILLA',
      enlace: 'https://ejemplo.com/p.pdf',
      mensaje: 'Aquí va',
      exigirSeguir: 'si',
    });

    assert.equal(res.status, 303);
    const guardadas = await panel.campaignsOf(CUENTA);
    assert.equal(guardadas.length, 1);
    assert.equal(guardadas[0]?.keyword, 'PLANTILLA');

    const panelHtml = await (await fetch(url(port, '/panel?guardado=1'), { headers: { cookie } })).text();
    assert.match(panelHtml, /Guardamos tus cambios/);
    assert.match(panelHtml, /PLANTILLA/);
  } finally {
    server.close();
  }
});

test('el enlace de EDITAR de Drive se rechaza antes de guardar', async () => {
  const { panel, server, port } = montar();
  try {
    const cookie = await entrar(port, panel);

    const res = await guardar(port, cookie, {
      accion: 'guardar',
      palabra: 'GUIA',
      enlace: 'https://docs.google.com/document/d/abc/edit',
      exigirSeguir: 'si',
    });

    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, /para EDITAR tu archivo/, 'le explica el error en su idioma');
    assert.match(html, /Compartir/, 'y como arreglarlo');
    assert.equal((await panel.campaignsOf(CUENTA)).length, 0, 'no se guardo nada roto');
  } finally {
    server.close();
  }
});

test('sin palabra clave no se guarda', async () => {
  const { panel, server, port } = montar();
  try {
    const cookie = await entrar(port, panel);
    const res = await guardar(port, cookie, {
      accion: 'guardar',
      palabra: '',
      enlace: 'https://ejemplo.com/p.pdf',
    });

    assert.equal(res.status, 400);
    assert.equal((await panel.campaignsOf(CUENTA)).length, 0);
  } finally {
    server.close();
  }
});

test('"Ver como queda" NO guarda: solo muestra el mensaje', async () => {
  const { panel, server, port } = montar();
  try {
    const cookie = await entrar(port, panel);

    const res = await guardar(port, cookie, {
      accion: 'previa',
      palabra: 'GUIA',
      enlace: 'https://ejemplo.com/g.pdf',
      mensaje: 'Aquí tienes tu guía',
    });

    assert.equal(res.status, 200);
    assert.match(await res.text(), /Así lo recibe la persona/);
    assert.equal((await panel.campaignsOf(CUENTA)).length, 0, 'mirar no puede guardar');
  } finally {
    server.close();
  }
});

test('el editor exige sesion', async () => {
  const { server, port } = montar();
  try {
    assert.equal((await fetch(url(port, '/panel/campana'))).status, 401);
    const res = await fetch(url(port, '/panel/campana'), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'palabra=X&enlace=https://a.com',
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

// ── La revision del enlace (Tarea 7) ───────────────────────────────────────

test('un enlace privado de Drive se detecta porque pide iniciar sesion', async () => {
  const fingirRedireccionALogin = (async () =>
    ({ status: 200, url: 'https://accounts.google.com/ServiceLogin?x=1' }) as Response) as typeof fetch;

  const r = await revisarEnlace('https://drive.google.com/file/d/abc/view', fingirRedireccionALogin);

  assert.equal(r.veredicto, 'no-sirve');
  assert.match(r.veredicto === 'no-sirve' ? r.motivo : '', /privado/);
});

test('una pagina que ya no existe se detecta', async () => {
  const fingir404 = (async () => ({ status: 404, url: 'https://x.com/nope' }) as Response) as typeof fetch;
  const r = await revisarEnlace('https://x.com/nope', fingir404);
  assert.equal(r.veredicto, 'no-sirve');
});

test('si NO podemos revisar el enlace, se guarda igual: fallar abierto', async () => {
  const fingirCaida = (async () => {
    throw new Error('sin red');
  }) as typeof fetch;

  const r = await revisarEnlace('https://ejemplo.com/g.pdf', fingirCaida);

  assert.equal(
    r.veredicto,
    'no-pudimos-revisar',
    'un problema NUESTRO no puede impedirle trabajar al cliente',
  );
});

test('un enlace sin https se rechaza sin salir a la red', async () => {
  const nuncaLlamar = (async () => {
    throw new Error('no deberia llamar a la red');
  }) as typeof fetch;

  const r = await revisarEnlace('http://ejemplo.com/g.pdf', nuncaLlamar);

  assert.equal(r.veredicto, 'no-sirve');
});
