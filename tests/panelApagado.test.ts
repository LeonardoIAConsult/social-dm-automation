import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

/**
 * Con el panel APAGADO (que es el default), sus rutas no existen. Es la promesa
 * de "esto no cambia nada de lo que ya funciona": mientras la bandera este en
 * false, la app sirve exactamente lo mismo que antes.
 *
 * Archivo aparte porque la bandera se lee al cargar la config, una sola vez.
 */
process.env.PANEL_ENABLED = 'false';
process.env.SESSION_SECRET = '';
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

function levantar() {
  const panel = new InMemoryPanelStore();
  const adapters = new Map([['instagram', new InstagramAdapter()]]);
  const store = new InMemoryConversationStore();
  const engine = new FlowEngine(store, adapters);
  // Se le pasa el almacen a proposito: ni asi deben aparecer las rutas.
  const server = createApp(engine, adapters, store, panel).listen(0);
  return { server, port: (server.address() as AddressInfo).port };
}

test('con la bandera apagada, las rutas del panel no existen', async () => {
  const { server, port } = levantar();
  try {
    for (const ruta of ['/panel', '/panel/entrar?t=loquesea', '/panel/salir']) {
      const res = await fetch(`http://127.0.0.1:${port}${ruta}`);
      assert.equal(res.status, 404, `${ruta} no deberia existir con el panel apagado`);
    }
  } finally {
    server.close();
  }
});

test('lo de siempre sigue funcionando con el panel apagado', async () => {
  const { server, port } = levantar();
  try {
    const salud = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(salud.status, 200);
    assert.deepEqual(await salud.json(), { ok: true });

    for (const ruta of ['/privacy', '/terms', '/data-deletion']) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${ruta}`)).status, 200, ruta);
    }
  } finally {
    server.close();
  }
});
