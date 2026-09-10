import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

/**
 * Camino COMPLETO del webhook, de punta a punta: se POSTea un payload firmado
 * igual que el de Meta, pasa por la verificacion de firma, el parser real, el
 * adaptador real de Instagram (en DRY_RUN) y el motor, y al final se comprueba
 * que el embudo quedo registrado en orden.
 *
 * Es el equivalente automatico de correr `execution/simulate_webhook.mjs`, que
 * sigue existiendo para probar a mano contra un servidor levantado.
 *
 * El entorno se fija ANTES de cargar la config: dotenv no pisa lo que ya existe.
 */
const SECRET = 'secreto-de-prueba';
process.env.META_APP_SECRET = SECRET;
process.env.DRY_RUN = 'true';
process.env.SIM_IS_FOLLOWER = 'true';
process.env.RESOURCES_SHEET_CSV_URL = '';
process.env.FOLLOW_GATE_ENABLED = 'true';
process.env.STORE_BACKEND = 'memory';
process.env.SEND_QUEUE_ENABLED = 'false';
process.env.RATE_LIMIT_PER_HOUR = '0';
process.env.INBOX_USER = '';
process.env.INBOX_PASS = '';

const { createApp } = await import('../src/server/app.js');
const { FlowEngine } = await import('../src/core/flowEngine.js');
const { StoreFunnelRecorder } = await import('../src/core/funnel.js');
const { InMemoryConversationStore } = await import('../src/store/conversationStore.js');
const { InMemoryPanelStore } = await import('../src/store/panelStore.js');
const { InstagramAdapter } = await import('../src/platforms/instagram/instagramAdapter.js');

const CUENTA = 'cuenta-webhook';
const USER = 'ig-user-e2e';
const MEDIA = 'media-e2e';

function levantar() {
  const panel = new InMemoryPanelStore();
  const adapters = new Map([['instagram', new InstagramAdapter()]]);
  const store = new InMemoryConversationStore();
  const engine = new FlowEngine(
    store,
    adapters,
    undefined,
    undefined,
    CUENTA,
    new StoreFunnelRecorder(panel),
  );
  const server = createApp(engine, adapters, store).listen(0);
  const port = (server.address() as AddressInfo).port;
  return { panel, server, port };
}

/** POSTea el payload firmado como lo hace Meta. */
async function enviar(port: number, body: unknown): Promise<number> {
  const raw = JSON.stringify(body);
  const firma = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const res = await fetch(`http://127.0.0.1:${port}/webhooks/instagram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma },
    body: raw,
  });
  return res.status;
}

const comentario = (commentId: string) => ({
  object: 'instagram',
  entry: [
    {
      id: 'IG_BIZ',
      time: Date.now(),
      changes: [
        {
          field: 'comments',
          value: {
            id: commentId,
            text: 'quiero la GUIA',
            from: { id: USER, username: 'usuario_prueba' },
            media: { id: MEDIA },
          },
        },
      ],
    },
  ],
});

const tocarBoton = () => ({
  object: 'instagram',
  entry: [
    {
      id: 'IG_BIZ',
      time: Date.now(),
      messaging: [
        {
          sender: { id: USER },
          recipient: { id: 'IG_BIZ' },
          timestamp: Date.now(),
          message: {
            mid: 'm_' + Date.now(),
            text: 'Obtener el enlace',
            quick_reply: { payload: 'GET_LINK:default' },
          },
        },
      ],
    },
  ],
});

/**
 * El webhook responde 200 ANTES de procesar (Meta reintenta si tardas), asi que
 * hay que esperar a que el procesamiento asincrono termine. Espera activa corta
 * en vez de un sleep fijo: termina apenas llegan los eventos esperados.
 */
async function esperarEventos(
  panel: InstanceType<typeof InMemoryPanelStore>,
  cuantos: number,
  msMax = 4000,
): Promise<string[]> {
  const hasta = Date.now() + msMax;
  for (;;) {
    const eventos = await panel.eventsSince(CUENTA, 0);
    if (eventos.length >= cuantos || Date.now() > hasta) return eventos.map((e) => e.type);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('el recorrido completo por HTTP deja los cinco pasos del embudo en orden', async () => {
  const { panel, server, port } = levantar();
  try {
    assert.equal(await enviar(port, comentario('COMMENT_1')), 200);
    assert.deepEqual(await esperarEventos(panel, 2), ['comment_detected', 'dm_sent']);

    assert.equal(await enviar(port, tocarBoton()), 200);

    assert.deepEqual(await esperarEventos(panel, 5), [
      'comment_detected',
      'dm_sent',
      'button_tapped',
      'follow_verified',
      'resource_delivered',
    ]);

    const eventos = await panel.eventsSince(CUENTA, 0);
    for (const e of eventos) {
      assert.equal(e.accountId, CUENTA, 'todo evento tiene que llevar su cuenta');
      assert.equal(e.platformUserId, USER);
    }
    assert.ok(
      eventos.every((e, i) => i === 0 || e.at >= (eventos[i - 1]?.at ?? 0)),
      'los eventos tienen que quedar en orden cronologico',
    );
  } finally {
    server.close();
  }
});

test('si Meta reenvia el MISMO comentario, no se cuenta dos veces', async () => {
  const { panel, server, port } = levantar();
  try {
    await enviar(port, comentario('COMMENT_REPETIDO'));
    await esperarEventos(panel, 2);
    await enviar(port, comentario('COMMENT_REPETIDO'));
    // Da tiempo a que el reenvio se procese: si duplicara, aqui se veria.
    await new Promise((r) => setTimeout(r, 400));

    const tipos = (await panel.eventsSince(CUENTA, 0)).map((e) => e.type);
    assert.deepEqual(tipos, ['comment_detected', 'dm_sent']);
  } finally {
    server.close();
  }
});

test('un webhook con firma invalida se descarta y no ensucia el embudo', async () => {
  const { panel, server, port } = levantar();
  try {
    const raw = JSON.stringify(comentario('COMMENT_FALSO'));
    const res = await fetch(`http://127.0.0.1:${port}/webhooks/instagram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=falsa' },
      body: raw,
    });

    assert.equal(res.status, 403);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await panel.eventsSince(CUENTA, 0), [], 'nada firmado mal puede contar');
  } finally {
    server.close();
  }
});
