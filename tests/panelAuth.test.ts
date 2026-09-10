import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

/**
 * Entrada al panel de punta a punta, por HTTP: canjear el enlace de invitacion,
 * quedar con sesion, y que NADIE mas pueda entrar. Es la puerta; el almacen ya
 * se prueba aparte.
 *
 * El entorno se fija antes de cargar la config (dotenv no pisa lo existente).
 */
process.env.PANEL_ENABLED = 'true';
process.env.SESSION_SECRET = 'secreto-de-pruebas-largo-para-firmar-cookies-1234';
process.env.DRY_RUN = 'true';
process.env.STORE_BACKEND = 'memory';
process.env.RESOURCES_SHEET_CSV_URL = '';
process.env.META_APP_SECRET = 'no-usado-en-este-test';
process.env.INBOX_USER = '';
process.env.INBOX_PASS = '';

const { createApp } = await import('../src/server/app.js');
const { FlowEngine } = await import('../src/core/flowEngine.js');
const { InMemoryConversationStore } = await import('../src/store/conversationStore.js');
const { InMemoryPanelStore } = await import('../src/store/panelStore.js');
const { InstagramAdapter } = await import('../src/platforms/instagram/instagramAdapter.js');
const { SESSION_COOKIE, armarCookie } = await import('../src/server/auth.js');

const CUENTA = 'cuenta-de-marcela';

function levantar() {
  const panel = new InMemoryPanelStore();
  const adapters = new Map([['instagram', new InstagramAdapter()]]);
  const store = new InMemoryConversationStore();
  const engine = new FlowEngine(store, adapters);
  const server = createApp(engine, adapters, store, panel).listen(0);
  const port = (server.address() as AddressInfo).port;
  return { panel, server, port };
}

const url = (port: number, ruta: string) => `http://127.0.0.1:${port}${ruta}`;

/**
 * Canjea como lo hace el cliente: el enlace solo MUESTRA el boton, y el canje
 * viaja por POST. Asi ningun previsualizador de WhatsApp le quema la invitacion
 * antes de que la toque.
 */
const canjear = (port: number, token: string, cookie?: string) =>
  fetch(url(port, '/panel/entrar'), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams({ t: token }).toString(),
  });

/** Saca el valor de la cookie de sesion de la respuesta, si la puso. */
function cookieDeSesion(res: Response): string | undefined {
  const puestas = res.headers.getSetCookie?.() ?? [];
  const linea = puestas.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!linea) return undefined;
  const valor = linea.slice(SESSION_COOKIE.length + 1).split(';')[0];
  return valor || undefined;
}

test('el enlace de invitacion deja al cliente dentro, con cookie httpOnly', async () => {
  const { panel, server, port } = levantar();
  try {
    const { token } = await panel.createInvite({
      accountId: CUENTA,
      role: 'owner',
      ttlMs: 60_000,
    });

    // Mirar el enlace no lo consume: eso es lo que salva al cliente del
    // previsualizador de WhatsApp.
    const mirar = await fetch(url(port, `/panel/entrar?t=${token}`));
    assert.equal(mirar.status, 200);
    assert.equal(
      (mirar.headers.getSetCookie?.() ?? []).length,
      0,
      'mirar el enlace no puede dejar sesion',
    );

    const res = await canjear(port, token);

    assert.equal(res.status, 303, 'canjear el enlace lleva al panel');
    assert.equal(res.headers.get('location'), '/panel');

    const linea = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(SESSION_COOKIE));
    assert.ok(linea, 'tiene que dejar la sesion puesta');
    assert.match(linea, /HttpOnly/, 'el navegador no puede leerla desde JavaScript');
    // Strict (antes Lax): el canje pasa a ser POST, asi que no hace falta que la
    // cookie viaje en navegaciones cross-site, y Strict corta el CSRF de sesion.
    assert.match(linea, /SameSite=Strict/);

    const cookie = cookieDeSesion(res) as string;
    const panelRes = await fetch(url(port, '/panel'), { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    assert.equal(panelRes.status, 200);
    assert.match(await panelRes.text(), new RegExp(CUENTA), 've su cuenta');
  } finally {
    server.close();
  }
});

test('el mismo enlace no sirve dos veces', async () => {
  const { panel, server, port } = levantar();
  try {
    const { token } = await panel.createInvite({ accountId: CUENTA, role: 'owner', ttlMs: 60_000 });

    const primera = await canjear(port, token);
    const segunda = await canjear(port, token);

    assert.equal(primera.status, 303);
    assert.equal(segunda.status, 401, 'un enlace reenviado a un tercero no puede abrir la puerta');
  } finally {
    server.close();
  }
});

test('un enlace vencido no sirve', async () => {
  const { panel, server, port } = levantar();
  try {
    const { token } = await panel.createInvite({ accountId: CUENTA, role: 'owner', ttlMs: -1 });

    const res = await canjear(port, token);

    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('un token inventado no sirve', async () => {
  const { server, port } = levantar();
  try {
    const res = await canjear(port, 'me-lo-invente');
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('sin cookie no se ve el panel', async () => {
  const { server, port } = levantar();
  try {
    const res = await fetch(url(port, '/panel'));
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('una cookie con la firma manipulada se rechaza', async () => {
  const { panel, server, port } = levantar();
  try {
    const user = await panel.upsertUser({ provider: 'invite', providerUserId: 'x' });
    const session = await panel.createSession(user.id, 60_000);
    const buena = armarCookie(session.id);
    const mala = `${buena.slice(0, -1)}${buena.endsWith('A') ? 'B' : 'A'}`;

    const res = await fetch(url(port, '/panel'), {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(mala)}` },
    });

    assert.equal(res.status, 401, 'la firma se verifica ANTES de tocar la base');
  } finally {
    server.close();
  }
});

test('una cookie con un id de sesion ajeno pero sin firma valida se rechaza', async () => {
  const { panel, server, port } = levantar();
  try {
    const user = await panel.upsertUser({ provider: 'invite', providerUserId: 'x' });
    const session = await panel.createSession(user.id, 60_000);

    // El atacante conoce el id de sesion pero no el secreto de firma, asi que
    // adjunta una firma inventada con el formato correcto.
    const res = await fetch(url(port, '/panel'), {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(`${session.id}.firmainventada`)}` },
    });

    assert.equal(res.status, 401);

    // Y sin firma, tampoco.
    const pelada = await fetch(url(port, '/panel'), {
      headers: { cookie: `${SESSION_COOKIE}=${session.id}` },
    });
    assert.equal(pelada.status, 401);
  } finally {
    server.close();
  }
});

test('cerrar sesion mata la sesion de verdad, no solo la cookie', async () => {
  const { panel, server, port } = levantar();
  try {
    const { token } = await panel.createInvite({ accountId: CUENTA, role: 'owner', ttlMs: 60_000 });
    const entrada = await canjear(port, token);
    const cookie = cookieDeSesion(entrada) as string;
    const cabecera = { cookie: `${SESSION_COOKIE}=${cookie}` };

    await fetch(url(port, '/panel/salir'), { method: 'POST', headers: cabecera });

    const despues = await fetch(url(port, '/panel'), { headers: cabecera });
    assert.equal(despues.status, 401, 'guardar la cookie vieja no puede volver a entrar');
  } finally {
    server.close();
  }
});

test('dos clientes distintos no se ven las cuentas', async () => {
  const { panel, server, port } = levantar();
  try {
    const a = await panel.createInvite({ accountId: 'cuenta-a', role: 'owner', ttlMs: 60_000 });
    const b = await panel.createInvite({ accountId: 'cuenta-b', role: 'owner', ttlMs: 60_000 });

    const entradaA = await canjear(port, a.token);
    const entradaB = await canjear(port, b.token);

    const panelA = await fetch(url(port, '/panel'), {
      headers: { cookie: `${SESSION_COOKIE}=${cookieDeSesion(entradaA)}` },
    });
    const panelB = await fetch(url(port, '/panel'), {
      headers: { cookie: `${SESSION_COOKIE}=${cookieDeSesion(entradaB)}` },
    });

    const textoA = await panelA.text();
    const textoB = await panelB.text();

    assert.match(textoA, /cuenta-a/);
    assert.ok(!textoA.includes('cuenta-b'), 'FUGA: el cliente A vio la cuenta del cliente B');
    assert.match(textoB, /cuenta-b/);
    assert.ok(!textoB.includes('cuenta-a'), 'FUGA: el cliente B vio la cuenta del cliente A');
  } finally {
    server.close();
  }
});

test('cerrar sesion por GET no existe: un enlace ajeno no puede sacarte', async () => {
  const { panel, server, port } = levantar();
  try {
    const { token } = await panel.createInvite({ accountId: CUENTA, role: 'owner', ttlMs: 60_000 });
    const entrada = await canjear(port, token);
    const cabecera = { cookie: `${SESSION_COOKIE}=${cookieDeSesion(entrada)}` };

    const porGet = await fetch(url(port, '/panel/salir'), { headers: cabecera });
    assert.equal(porGet.status, 404, 'destruir la sesion tiene que exigir POST');

    const sigueDentro = await fetch(url(port, '/panel'), { headers: cabecera });
    assert.equal(sigueDentro.status, 200, 'la sesion tiene que seguir viva');
  } finally {
    server.close();
  }
});

test('las paginas llevan cabeceras de seguridad', async () => {
  const { server, port } = levantar();
  try {
    const res = await fetch(url(port, '/panel'));
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    server.close();
  }
});

test('una cookie basura antepuesta no deja fuera al cliente legitimo', async () => {
  const { panel, server, port } = levantar();
  try {
    const { token } = await panel.createInvite({ accountId: CUENTA, role: 'owner', ttlMs: 60_000 });
    const entrada = await canjear(port, token);
    const buena = cookieDeSesion(entrada) as string;

    const res = await fetch(url(port, '/panel'), {
      headers: { cookie: `${SESSION_COOKIE}=basura; ${SESSION_COOKIE}=${buena}` },
    });

    assert.equal(res.status, 200, 'gana la cookie con firma valida, no la primera');
  } finally {
    server.close();
  }
});

test('una cookie mal formada NO tumba el servidor', async () => {
  const { server, port } = levantar();
  try {
    const res = await fetch(url(port, '/panel'), {
      headers: { cookie: `${SESSION_COOKIE}=%` },
    });
    assert.equal(res.status, 401, 'se trata como si no hubiera cookie');

    const salud = await fetch(url(port, '/health'));
    assert.equal(salud.status, 200, 'el proceso sigue vivo');
  } finally {
    server.close();
  }
});

test('la pagina de eliminacion de datos que exige Meta se sirve', async () => {
  const { server, port } = levantar();
  try {
    const res = await fetch(url(port, '/data-deletion'));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Eliminar mis datos/);
  } finally {
    server.close();
  }
});
