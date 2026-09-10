import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

/**
 * Cada prueba de aquí nació de un hallazgo de la auditoría de tres capas.
 * El nombre dice la REGLA que se rompió, para que si alguien la vuelve a
 * romper sepa exactamente qué se estaba protegiendo.
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
const { InMemoryPanelStore } = await import('../src/store/panelStore.js');
const { SESSION_COOKIE } = await import('../src/server/auth.js');
const { armarEstadoDeConexion } = await import('../src/server/panel/estado.js');
const { resumenDe, estadoDeLaPrueba, DURACION_DE_LA_PRUEBA_MS } = await import(
  '../src/server/panel/resultados.js'
);
const { revisarEnlace } = await import('../src/core/enlaces.js');
const { esDireccionPublica } = await import('../src/core/red.js');
const { FuentePanelPrimero } = await import('../src/core/recursos.js');
const express = (await import('express')).default;

const CUENTA = 'tienda-de-marcela';

// ── SSRF: el validador de enlaces no puede ser un proxy a la red interna ──

test('un enlace a la propia maquina se rechaza sin pedirlo', async () => {
  const nuncaLlamar = (async () => {
    throw new Error('no debio salir a la red');
  }) as typeof fetch;

  for (const donde of [
    'https://localhost/algo',
    'https://127.0.0.1/algo',
    'https://[::1]/algo',
    'https://algo.internal/x',
  ]) {
    const r = await revisarEnlace(donde, nuncaLlamar);
    assert.equal(r.veredicto, 'no-sirve', `${donde} tenia que rechazarse`);
  }
});

test('una redireccion hacia la red interna se corta en el salto', async () => {
  // Host publico que responde 302 hacia el endpoint de metadatos de la nube:
  // es la forma clasica de robar credenciales desde un validador de enlaces.
  const redirigeAdentro = (async (destino: string) => {
    if (destino.includes('publico')) {
      return {
        status: 302,
        url: destino,
        headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }),
      } as Response;
    }
    throw new Error('NUNCA se debio pedir la direccion interna');
  }) as typeof fetch;

  const r = await revisarEnlace('https://publico.example.com/r', redirigeAdentro);

  assert.equal(r.veredicto, 'no-sirve');
});

test('las direcciones privadas se reconocen aunque vengan disfrazadas', async () => {
  const resolverA = (ip: string) => async () => [{ address: ip }];

  for (const ip of ['10.0.0.5', '172.16.3.9', '192.168.1.4', '169.254.169.254', '127.0.0.1']) {
    const v = await esDireccionPublica(new URL('https://parece-publico.com'), resolverA(ip));
    assert.equal(v.permitido, false, `${ip} es interna`);
  }
  const publica = await esDireccionPublica(
    new URL('https://ejemplo.com'),
    resolverA('93.184.216.34'),
  );
  assert.equal(publica.permitido, true);
});

test('un nombre que resuelve a publica Y a interna se rechaza', async () => {
  const dobleCara = async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }];
  const v = await esDireccionPublica(new URL('https://truco.com'), dobleCara);
  assert.equal(v.permitido, false, 'basta una interna para no arriesgarse');
});

// ── Numeros que mienten ──────────────────────────────────────────────────

test('quien no seguia pero DESPUES recibio no cuenta como perdido', async () => {
  const panel = new InMemoryPanelStore();
  const ahora = Date.now();
  // Maria se frena por no seguir, sigue, y recibe.
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-maria',
    type: 'blocked_not_following',
    at: ahora - 5000,
  });
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-maria',
    type: 'resource_delivered',
    at: ahora - 1000,
  });
  // Juan se frena y no vuelve.
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-juan',
    type: 'blocked_not_following',
    at: ahora - 4000,
  });

  const r = await resumenDe(panel, CUENTA, 7, ahora);

  assert.equal(r.recibieron, 1);
  assert.equal(r.noSeguian, 1, 'solo Juan sigue esperando; Maria ya se convirtio');
});

// ── El estado vacio no puede tapar entregas reales ───────────────────────

test('con entregas por DM y cero comentarios, se muestran los numeros igual', async () => {
  const { renderPanel } = await import('../src/server/panel/vista.js');

  const html = renderPanel({
    cuenta: CUENTA,
    conexion: { tipo: 'activo' },
    campana: 'pendiente',
    // Llegaron por DM: el motor solo cuenta comment_detected en comentarios.
    resultados: { comentaron: 0, recibieron: 12, noSeguian: 0 },
  });

  assert.ok(!html.includes('Todavía nadie ha comentado'), 'no puede esconder 12 entregas');
  assert.match(html, /12/);
});

// ── La prueba en vivo no puede declarar un exito ajeno ───────────────────

test('la prueba sigue a UNA persona, no a quien pase por ahi', async () => {
  const panel = new InMemoryPanelStore();
  const desde = Date.now();
  // El cliente prueba con su segundo telefono.
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-el-tester',
    type: 'comment_detected',
    at: desde + 100,
  });
  // Y justo entonces un seguidor real completa el recorrido.
  for (const type of ['dm_sent', 'button_tapped', 'follow_verified', 'resource_delivered'] as const) {
    await panel.recordEvent({
      accountId: CUENTA,
      platformUserId: 'ig-otra-persona',
      type,
      at: desde + 200,
    });
  }

  const estado = await estadoDeLaPrueba(panel, CUENTA, desde, desde + 1000);

  assert.equal(
    estado.completa,
    false,
    'declarar exito con el recorrido de otro le haria creer que su prueba funciono',
  );
});

test('la ventana de la prueba es FIJA: no se desliza ni apaga pasos', async () => {
  const panel = new InMemoryPanelStore();
  const desde = Date.now() - DURACION_DE_LA_PRUEBA_MS - 60_000;
  await panel.recordEvent({
    accountId: CUENTA,
    platformUserId: 'ig-1',
    type: 'comment_detected',
    at: desde + 100,
  });

  const estado = await estadoDeLaPrueba(panel, CUENTA, desde);

  assert.equal(estado.vencida, true, 'pasado el tiempo, la prueba se cierra');
  assert.equal(estado.incompleta, true, 'y dice que quedo a medias, no que no llego nada');
});

// ── Rutas: ventana invalida y valores largos ─────────────────────────────

function montar() {
  const panel = new InMemoryPanelStore();
  const app = express();
  registrarRutasDelPanel(app, panel, { salud: async () => ({ estado: 'ok' as const }) }, undefined, CUENTA);
  const server = app.listen(0);
  return { panel, server, port: (server.address() as AddressInfo).port };
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
  const linea = (res.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith(SESSION_COOKIE),
  ) as string;
  return `${SESSION_COOKIE}=${linea.slice(SESSION_COOKIE.length + 1).split(';')[0]}`;
}

test('una ventana de prueba vieja o del futuro no se acepta: se abre una nueva', async () => {
  const { panel, server, port } = montar();
  try {
    const cookie = await entrar(port, panel);
    await panel.saveCampaign({
      accountId: CUENTA,
      keyword: 'GUIA',
      url: 'https://ejemplo.com/g.pdf',
      requireFollow: true,
    });

    for (const desde of ['1', '99999999999999', 'abc', '-5']) {
      const res = await fetch(url(port, `/panel/prueba?desde=${desde}`), {
        headers: { cookie },
        redirect: 'manual',
      });
      assert.equal(res.status, 303, `desde=${desde} tenia que abrir ventana nueva`);
    }
  } finally {
    server.close();
  }
});

test('sin palabra definida, la prueba no manda a comentar un texto imposible', async () => {
  const { panel, server, port } = montar();
  try {
    const cookie = await entrar(port, panel);
    const res = await fetch(url(port, '/panel/prueba'), { headers: { cookie }, redirect: 'manual' });
    const destino = res.headers.get('location') as string;
    const html = await (await fetch(url(port, destino), { headers: { cookie } })).text();

    assert.match(html, /Primero define tu palabra/);
    assert.ok(!html.includes('Comenta <code>tu palabra clave'), 'eso era imposible de seguir');
  } finally {
    server.close();
  }
});

test('un enlace demasiado largo se RECHAZA, no se recorta en silencio', async () => {
  const { panel, server, port } = montar();
  try {
    const cookie = await entrar(port, panel);
    const largo = `https://ejemplo.com/${'x'.repeat(600)}`;

    const res = await fetch(url(port, '/panel/campana'), {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ accion: 'guardar', palabra: 'GUIA', enlace: largo }).toString(),
    });

    assert.equal(res.status, 400);
    assert.match(await res.text(), /Se paso de largo el enlace/);
    assert.equal(
      (await panel.campaignsOf(CUENTA)).length,
      0,
      'guardar un enlace distinto al que pego y decir que quedo activo es el peor error posible',
    );
  } finally {
    server.close();
  }
});

// ── El semaforo no habla de una cuenta que no puede consultar ────────────

test('el semaforo calla si la cuenta no es la que el adaptador sabe consultar', async () => {
  const panel = new InMemoryPanelStore();
  const salud = { salud: async () => ({ estado: 'ok' as const, username: 'cuenta_principal' }) };

  const propia = await armarEstadoDeConexion(salud, panel, CUENTA, CUENTA);
  const ajena = await armarEstadoDeConexion(salud, panel, 'otra-cuenta', CUENTA);

  assert.equal(propia.tipo, 'activo');
  assert.equal(
    ajena.tipo,
    'sin-datos',
    'mostrarle el verde de otra cuenta seria mentirle al cliente',
  );
});

// ── El cambio de fuente no puede dejar a nadie sin su recurso ────────────

test('quien comento ANTES de la primera campana del panel igual recibe lo suyo', async () => {
  const panel = new InMemoryPanelStore();
  const fuente = new FuentePanelPrimero(panel);

  // Ana comento "GUIA" cuando mandaba la hoja; su palabra quedo guardada.
  // Justo despues el cliente define su primera campana, con otra palabra.
  await panel.saveCampaign({
    accountId: CUENTA,
    keyword: 'LIBRO',
    url: 'https://ejemplo.com/libro.pdf',
    requireFollow: true,
  });

  // Ana toca el boton: su palabra ya no esta en el panel, pero si en la hoja.
  const paraAna = await fuente.porPalabra(CUENTA, 'guia');

  assert.ok(paraAna, 'un embudo ya empezado no se puede quedar sin entrega');
});
