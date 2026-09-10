import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

/**
 * Tareas 6, 9, 10, 11 y 12: el panel con datos reales.
 *
 * Semaforo de conexion, prueba en vivo, resultados en lenguaje llano, errores
 * traducidos a una accion, y la lista de cuentas de quien maneja varias.
 */
process.env.PANEL_ENABLED = 'true';
process.env.SESSION_SECRET = 'secreto-de-pruebas-largo-para-firmar-cookies-1234';
process.env.DRY_RUN = 'true';
process.env.STORE_BACKEND = 'memory';
process.env.RESOURCES_SHEET_CSV_URL = '';
process.env.META_APP_SECRET = 'no-usado';
process.env.INBOX_USER = '';
process.env.INBOX_PASS = '';

const { registrarRutasDelPanel } = await import('../src/server/panel.js');
const { FlowEngine } = await import('../src/core/flowEngine.js');
const { InMemoryConversationStore } = await import('../src/store/conversationStore.js');
const { InMemoryPanelStore } = await import('../src/store/panelStore.js');
const { SESSION_COOKIE } = await import('../src/server/auth.js');
const { armarEstadoDeConexion } = await import('../src/server/panel/estado.js');
const { resumenDe, estadoDeLaPrueba, DURACION_DE_LA_PRUEBA_MS } = await import(
  '../src/server/panel/resultados.js'
);
const { AvisadorUnaVezAlDia } = await import('../src/core/avisos.js');
const express = (await import('express')).default;

const CUENTA = 'tienda-de-marcela';

// ── Semaforo (Tarea 6) ─────────────────────────────────────────────────────

const saludDe = (estado: 'ok' | 'sin-permiso' | 'no-se-pudo', username?: string) => ({
  salud: async () => ({ estado, username }),
});

test('cuenta sana: verde, con el usuario y la ultima entrega', async () => {
  const panel = new InMemoryPanelStore();
  const cuando = Date.now() - 60_000;
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-1',
    type: 'resource_delivered',
    at: cuando,
  });

  const estado = await armarEstadoDeConexion(saludDe('ok', 'marcela'), panel, CUENTA);

  assert.equal(estado.tipo, 'activo');
  assert.equal(estado.tipo === 'activo' ? estado.cuentaInstagram : '', '@marcela');
  assert.equal(estado.tipo === 'activo' ? estado.ultimaEntrega?.getTime() : 0, cuando);
});

test('permiso cerrado: rojo, en llano y con UNA salida', async () => {
  const panel = new InMemoryPanelStore();
  const estado = await armarEstadoDeConexion(saludDe('sin-permiso'), panel, CUENTA);

  assert.equal(estado.tipo, 'atencion');
  if (estado.tipo !== 'atencion') return;
  assert.ok(!/token|api|oauth/i.test(estado.quePaso), 'sin jerga');
  assert.match(estado.accion.url, /reconectar/);
});

test('si no se pudo preguntar, NO se pinta rojo: se dice que se esta revisando', async () => {
  const panel = new InMemoryPanelStore();

  const dudoso = await armarEstadoDeConexion(saludDe('no-se-pudo'), panel, CUENTA);
  const explota = await armarEstadoDeConexion(
    {
      salud: async () => {
        throw new Error('red caida');
      },
    },
    panel,
    CUENTA,
  );

  assert.equal(dudoso.tipo, 'sin-datos', 'una duda nuestra no es un problema del cliente');
  assert.equal(explota.tipo, 'sin-datos', 'y una excepcion tampoco tumba la pantalla');
});

// ── Resultados (Tarea 10) ──────────────────────────────────────────────────

test('se cuentan PERSONAS, no eventos', async () => {
  const panel = new InMemoryPanelStore();
  const ahora = Date.now();
  // La misma persona comenta tres veces distintas.
  for (const id of ['c1', 'c2', 'c3']) {
    await panel.recordEvent({
      accountId: CUENTA,
      platformUserId: 'ig-la-misma',
      type: 'comment_detected',
      at: ahora - 1000,
      dedupeKey: id,
    });
  }

  const r = await resumenDe(panel, CUENTA, 7, ahora);

  assert.equal(r.comentaron, 1, 'tres comentarios de una persona son UNA persona interesada');
});

test('los resultados respetan el periodo pedido', async () => {
  const panel = new InMemoryPanelStore();
  const ahora = Date.now();
  const dia = 24 * 60 * 60 * 1000;
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-reciente',
    type: 'comment_detected',
    at: ahora - 2 * dia,
  });
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-viejo',
    type: 'comment_detected',
    at: ahora - 20 * dia,
  });

  assert.equal((await resumenDe(panel, CUENTA, 7, ahora)).comentaron, 1);
  assert.equal((await resumenDe(panel, CUENTA, 30, ahora)).comentaron, 2);
});

test('los resultados no mezclan cuentas', async () => {
  const panel = new InMemoryPanelStore();
  const ahora = Date.now();
  await panel.recordEvent({
    accountId: 'otra',
    platformUserId: 'ig-ajeno',
    type: 'comment_detected',
    at: ahora - 1000,
  });

  assert.equal((await resumenDe(panel, CUENTA, 30, ahora)).comentaron, 0);
});

// ── Prueba en vivo (Tarea 9) ───────────────────────────────────────────────

test('la prueba pinta los pasos a medida que ocurren', async () => {
  const panel = new InMemoryPanelStore();
  const desde = Date.now();

  const alPrincipio = await estadoDeLaPrueba(panel, CUENTA, desde, desde + 1000);
  assert.deepEqual(
    alPrincipio.pasos.map((p) => p.hecho),
    [false, false, false, false, false],
  );

  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-1',
    type: 'comment_detected',
    at: desde + 500,
  });
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-1',
    type: 'dm_sent',
    at: desde + 900,
  });

  const aMitad = await estadoDeLaPrueba(panel, CUENTA, desde, desde + 2000);
  assert.deepEqual(
    aMitad.pasos.map((p) => p.hecho),
    [true, true, false, false, false],
  );
  assert.equal(aMitad.completa, false);
  assert.equal(aMitad.vencida, false);
});

test('la prueba se da por completa cuando el recurso llego', async () => {
  const panel = new InMemoryPanelStore();
  const desde = Date.now();
  for (const type of [
    'comment_detected',
    'dm_sent',
    'button_tapped',
    'follow_verified',
    'resource_delivered',
  ] as const) {
    await panel.recordEvent({ accountId: CUENTA, platformUserId: 'ig-1', type, at: desde + 100 });
  }

  const estado = await estadoDeLaPrueba(panel, CUENTA, desde, desde + 1000);

  assert.equal(estado.completa, true);
  assert.ok(estado.pasos.every((p) => p.hecho));
});

test('sin actividad y sin tiempo, la prueba se declara vencida', async () => {
  const panel = new InMemoryPanelStore();
  const desde = Date.now() - DURACION_DE_LA_PRUEBA_MS - 1000;

  const estado = await estadoDeLaPrueba(panel, CUENTA, desde);

  assert.equal(estado.vencida, true, 'para poder explicarle las dos causas tipicas');
});

test('si la persona no seguia, la prueba lo dice sin llamarlo error', async () => {
  const panel = new InMemoryPanelStore();
  const desde = Date.now();
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-1',
    type: 'blocked_not_following',
    at: desde + 100,
  });

  const estado = await estadoDeLaPrueba(panel, CUENTA, desde, desde + 500);

  assert.equal(estado.frenadaPorSeguir, true);
});

// ── Aviso al operador (Tarea 11) ───────────────────────────────────────────

test('el aviso de una cuenta caida sale UNA vez al dia, no una por visita', async () => {
  const salieron: string[] = [];
  const avisador = new AvisadorUnaVezAlDia({
    async avisar(a) {
      salieron.push(a.asunto);
    },
  });

  for (let i = 0; i < 5; i++) {
    await avisador.avisar({ accountId: CUENTA, asunto: 'cuenta-desconectada', detalle: 'x' });
  }
  await avisador.avisar({ accountId: 'otra', asunto: 'cuenta-desconectada', detalle: 'x' });

  assert.equal(salieron.length, 2, 'uno por cuenta; el resto seria ruido que tapa lo importante');
});

// ── Por HTTP: el panel entero (Tareas 6, 9, 10, 12) ────────────────────────

function montar(salud: 'ok' | 'sin-permiso' | 'no-se-pudo' = 'ok') {
  const panel = new InMemoryPanelStore();
  const store = new InMemoryConversationStore();
  const adapters = new Map([
    ['instagram', { platform: 'instagram', verifySignature() {}, parseWebhook: () => [] } as never],
  ]);
  // Se monta solo el panel: estas pruebas son de sus pantallas, no del webhook.
  void new FlowEngine(store, adapters);
  const app = express();
  registrarRutasDelPanel(app, panel, saludDe(salud, 'marcela'));
  const server = app.listen(0);
  return { panel, server, port: (server.address() as AddressInfo).port };
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
  const linea = (res.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith(SESSION_COOKIE),
  ) as string;
  return `${SESSION_COOKIE}=${linea.slice(SESSION_COOKIE.length + 1).split(';')[0]}`;
}

test('el panel muestra el estado verde y ofrece probar', async () => {
  const { panel, server, port } = montar('ok');
  try {
    const cookie = await entrar(port, panel, CUENTA);
    const html = await (await fetch(url(port, '/panel'), { headers: { cookie } })).text();

    assert.match(html, /Tu automatización está activa/);
    assert.match(html, /@marcela/);
    assert.match(html, /Probar ahora/);
  } finally {
    server.close();
  }
});

test('el panel en rojo lleva a avisar, y avisar confirma en llano', async () => {
  const { panel, server, port } = montar('sin-permiso');
  try {
    const cookie = await entrar(port, panel, CUENTA);
    const html = await (await fetch(url(port, '/panel'), { headers: { cookie } })).text();
    assert.match(html, /Hay algo que arreglar/);

    const aviso = await (await fetch(url(port, '/panel/reconectar'), { headers: { cookie } })).text();
    assert.match(aviso, /Ya avisamos/);
    assert.ok(!/token|api/i.test(aviso.replace(/<[^>]+>/g, ' ')), 'sin jerga');
  } finally {
    server.close();
  }
});

test('la prueba en vivo abre una ventana y se refresca sola', async () => {
  const { panel, server, port } = montar('ok');
  try {
    const cookie = await entrar(port, panel, CUENTA);
    // Sin palabra definida no hay prueba posible: es lo que se comenta.
    await panel.saveCampaign({
      accountId: CUENTA,
      keyword: 'PLANTILLA',
      url: 'https://ejemplo.com/p.pdf',
      requireFollow: true,
    });

    const arranque = await fetch(url(port, '/panel/prueba'), {
      headers: { cookie },
      redirect: 'manual',
    });
    assert.equal(arranque.status, 303, 'arranca la ventana con su hora');
    const destino = arranque.headers.get('location') as string;
    assert.match(destino, /desde=\d+/);

    const html = await (await fetch(url(port, destino), { headers: { cookie } })).text();
    assert.match(html, /http-equiv="refresh"/, 'se actualiza sola, sin JavaScript');
    assert.match(html, /desde otro teléfono/);
  } finally {
    server.close();
  }
});

test('sin comentarios todavia, los resultados dicen que hacer y no un cero pelado', async () => {
  const { panel, server, port } = montar('ok');
  try {
    const cookie = await entrar(port, panel, CUENTA);
    await panel.saveCampaign({
      accountId: CUENTA,
      keyword: 'PLANTILLA',
      url: 'https://ejemplo.com/p.pdf',
      requireFollow: true,
    });

    const html = await (await fetch(url(port, '/panel'), { headers: { cookie } })).text();

    assert.match(html, /Todavía nadie ha comentado/);
    assert.match(html, /Comenta <b>PLANTILLA<\/b>/, 'le da el texto listo para copiar');
  } finally {
    server.close();
  }
});

test('quien maneja una sola cuenta no ve la lista de cuentas', async () => {
  const { panel, server, port } = montar('ok');
  try {
    const cookie = await entrar(port, panel, CUENTA);
    const html = await (await fetch(url(port, '/panel'), { headers: { cookie } })).text();

    assert.ok(!html.includes('ver todas'), 'no se le ofrece algo que no tiene');
  } finally {
    server.close();
  }
});

test('la lista del operador pone arriba la cuenta que necesita atencion', async () => {
  const { panel, server, port } = montar('sin-permiso');
  try {
    const cookie = await entrar(port, panel, CUENTA);
    const html = await (await fetch(url(port, '/panel/cuentas'), { headers: { cookie } })).text();

    assert.match(html, /necesita atención/);
    assert.match(html, new RegExp(CUENTA));
  } finally {
    server.close();
  }
});
