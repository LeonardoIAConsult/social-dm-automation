import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * El motor deja constancia de cada paso del embudo. Es lo que despues alimenta
 * la prueba en vivo y los resultados del panel (Tareas 9 y 10).
 *
 * Ojo con el orden de los imports: fijamos el entorno ANTES de cargar el modulo
 * de config, porque `dotenv` no pisa lo que ya existe en process.env. Asi el
 * test no depende del `.env` de la maquina ni sale a la red a leer la hoja de
 * Google: usa la tabla de respaldo, que mapea la palabra "guia".
 */
process.env.RESOURCES_SHEET_CSV_URL = '';
process.env.DRY_RUN = 'true';
process.env.FOLLOW_GATE_ENABLED = 'true';
process.env.STORE_BACKEND = 'memory';
process.env.SEND_QUEUE_ENABLED = 'false';
process.env.RATE_LIMIT_PER_HOUR = '0';

const { FlowEngine } = await import('../src/core/flowEngine.js');
const { StoreFunnelRecorder } = await import('../src/core/funnel.js');
const { InMemoryConversationStore } = await import('../src/store/conversationStore.js');
const { InMemoryPanelStore } = await import('../src/store/panelStore.js');
type PanelStoreT = InstanceType<typeof InMemoryPanelStore>;

type Incoming = Parameters<InstanceType<typeof FlowEngine>['handle']>[0];

const CUENTA = 'cuenta-test';
const USUARIO = 'ig-user-1';
const CAMPANA = 'default';
/** El payload del boton "Obtener el enlace" que arma el propio motor. */
const GET = `GET_LINK:${CAMPANA}`;

/** Adaptador de mentira: registra lo que se envia y responde el follow que le digas. */
function fakeAdapter(sigue: boolean | null) {
  const enviados: Array<{ userId: string; message: unknown }> = [];
  const adapter = {
    platform: 'instagram' as const,
    verifySignature() {
      // No aplica en este test.
    },
    parseWebhook: () => [],
    async sendMessage(userId: string, message: unknown) {
      enviados.push({ userId, message });
    },
    async isFollower() {
      return sigue;
    },
  };
  return { adapter, enviados };
}

function armar(sigue: boolean | null = true) {
  const { adapter, enviados } = fakeAdapter(sigue);
  const panel: PanelStoreT = new InMemoryPanelStore();
  const engine = new FlowEngine(
    new InMemoryConversationStore(),
    new Map([['instagram', adapter as never]]),
    undefined,
    undefined,
    CUENTA,
    new StoreFunnelRecorder(panel),
  );
  return { engine, panel, enviados };
}

const comentario = (commentId: string, text = 'quiero la GUIA'): Incoming => ({
  platform: 'instagram',
  type: 'comment',
  user: { id: USUARIO, username: 'marcela' },
  text,
  commentId,
  mediaId: 'media-1',
  timestamp: Date.now(),
});

const toqueDelBoton = (): Incoming => ({
  platform: 'instagram',
  type: 'postback',
  user: { id: USUARIO },
  payload: GET,
  timestamp: Date.now(),
});

const tipos = async (panel: PanelStoreT) => (await panel.eventsSince(CUENTA, 0)).map((e) => e.type);

test('un comentario que matchea deja "comentario detectado" y "DM enviado"', async () => {
  const { engine, panel } = armar();

  await engine.handle(comentario('c-1'));

  assert.deepEqual(await tipos(panel), ['comment_detected', 'dm_sent']);
  const eventos = await panel.eventsSince(CUENTA, 0);
  assert.equal(eventos[0]?.accountId, CUENTA, 'el evento se guarda con su cuenta');
  assert.equal(eventos[0]?.campaignId, CAMPANA, 'y con la campana que lo disparo');
  assert.equal(eventos[0]?.platformUserId, USUARIO);
});

test('reenviar el MISMO webhook no cuenta el comentario dos veces', async () => {
  const { engine, panel } = armar();

  await engine.handle(comentario('c-1'));
  await engine.handle(comentario('c-1'));

  assert.deepEqual(
    await tipos(panel),
    ['comment_detected', 'dm_sent'],
    'Meta reenvia webhooks: el mismo commentId no puede inflar los numeros',
  );
});

test('dos comentarios distintos si cuentan dos veces', async () => {
  const { engine, panel } = armar();

  await engine.handle(comentario('c-1'));
  await engine.handle(comentario('c-2'));

  const t = await tipos(panel);
  assert.equal(t.filter((x) => x === 'comment_detected').length, 2);
});

test('el recorrido completo con follow verificado deja los cinco pasos en orden', async () => {
  const { engine, panel } = armar(true);

  await engine.handle(comentario('c-1'));
  await engine.handle(toqueDelBoton());

  assert.deepEqual(await tipos(panel), [
    'comment_detected',
    'dm_sent',
    'button_tapped',
    'follow_verified',
    'resource_delivered',
  ]);
});

test('si no te sigue, queda registrado el bloqueo y NO la entrega', async () => {
  const { engine, panel } = armar(false);

  await engine.handle(comentario('c-1'));
  await engine.handle(toqueDelBoton());

  const t = await tipos(panel);
  assert.deepEqual(t, ['comment_detected', 'dm_sent', 'button_tapped', 'blocked_not_following']);
  assert.ok(!t.includes('resource_delivered'), 'no se puede contar una entrega que no ocurrio');
});

test('cuando no se puede saber si te sigue, se entrega pero no se afirma que sigue', async () => {
  const { engine, panel } = armar(null);

  await engine.handle(comentario('c-1'));
  await engine.handle(toqueDelBoton());

  const t = await tipos(panel);
  assert.ok(t.includes('resource_delivered'), 'no bloqueamos valor por una duda tecnica');
  assert.ok(!t.includes('follow_verified'), 'no se afirma un follow que nunca se verifico');
});

test('tocar el boton dos veces entrega una sola vez', async () => {
  const { engine, panel } = armar(true);

  await engine.handle(comentario('c-1'));
  await engine.handle(toqueDelBoton());
  await engine.handle(toqueDelBoton());

  const t = await tipos(panel);
  assert.equal(
    t.filter((x) => x === 'resource_delivered').length,
    1,
    'el motor entrega una vez; el panel tiene que contar una vez',
  );
  // REGLA CAMBIADA (auditoria 10-sep): antes se contaban los dos toques. Sin
  // tope, cualquiera infla el embudo del cliente tocando el boton en bucle, sin
  // gastar un solo envio. Ahora la clave del toque es por usuario, campana y
  // dia: la intencion del dia se cuenta una vez.
  assert.equal(
    t.filter((x) => x === 'button_tapped').length,
    1,
    'dos toques del mismo dia son la misma intencion',
  );
});

test('si no habia nada que enviar, NO se cuenta como entrega', async () => {
  // Toque del boton sin comentario previo: no hay palabra detectada, asi que no
  // hay recurso que mandar. El cliente no recibio nada y el numero no puede decir
  // lo contrario.
  const { engine, panel, enviados } = armar(true);

  await engine.handle(toqueDelBoton());

  assert.equal(enviados.length, 0, 'de verdad no salio ningun mensaje');
  const t = await tipos(panel);
  assert.deepEqual(t, ['button_tapped', 'follow_verified']);
  assert.ok(!t.includes('resource_delivered'), 'contar esto seria mentirle al cliente');
});

test('si el registro del panel falla, el DM sale igual', async () => {
  const { adapter, enviados } = fakeAdapter(true);
  const roto = {
    async recordEvent() {
      throw new Error('base caida');
    },
  };
  const engine = new FlowEngine(
    new InMemoryConversationStore(),
    new Map([['instagram', adapter as never]]),
    undefined,
    undefined,
    CUENTA,
    new StoreFunnelRecorder(roto as never),
  );

  await engine.handle(comentario('c-1'));

  assert.ok(enviados.length > 0, 'una metrica caida NUNCA puede tumbar la entrega al cliente');
});
