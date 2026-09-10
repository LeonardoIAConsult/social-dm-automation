/**
 * Smoke REAL contra la Postgres configurada (no es un test unitario: abre una
 * conexion de verdad). Responde una sola pregunta: ¿la base responde y los dos
 * almacenes funcionan contra ella?
 *
 * Parte 1 (conversaciones): init -> upsert -> RECONEXION -> get -> aislamiento.
 * Parte 2 (panel): personas, sesiones, acceso por cuenta, campanas y eventos,
 * tambien con reconexion en medio, porque el riesgo real en Render Free es que
 * el contenedor se reinicie.
 *
 * Limpia todo lo que crea. Nunca imprime la cadena de conexion.
 *
 * Uso:
 *   DATABASE_URL='postgresql://...' npx tsx execution/db_smoke.ts
 */
import pg from 'pg';
import {
  PostgresConversationStore,
  type ConversationState,
} from '../src/store/conversationStore.js';
import { DuplicateKeywordError, PostgresPanelStore } from '../src/store/panelStore.js';

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('NO-GO: falta DATABASE_URL en el entorno.');
  process.exit(1);
}

// Igual que en produccion (src/index.ts): se verifica el certificado del
// servidor. Una base con cert autofirmado fallara aqui, y eso es intencional.
const mkPool = () => new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });

const ACCOUNT = 'smoke-account';
const OTRA = 'smoke-otra-cuenta';
const FB_ID = 'smoke-fb-user';

const probe: ConversationState = {
  accountId: ACCOUNT,
  platform: 'instagram',
  userId: 'smoke-user',
  username: 'smoke',
  lastUserInteractionAt: Date.now(),
  messages: [{ dir: 'in', kind: 'comment', text: 'AUTOMATIZA', at: Date.now() }],
  data: {},
};

function check(condicion: boolean, queFallo: string): void {
  if (!condicion) throw new Error(queFallo);
}

async function conversaciones() {
  const pool1 = mkPool();
  const store1 = new PostgresConversationStore(pool1);
  await store1.init();
  await store1.upsert(probe);
  await pool1.end();

  // Pool nuevo = simula el reinicio del contenedor.
  const pool2 = mkPool();
  const store2 = new PostgresConversationStore(pool2);

  const got = await store2.get('instagram', 'smoke-user', ACCOUNT);
  check(got?.username === 'smoke', 'la conversacion NO sobrevivio al reinicio');
  check((await store2.list(ACCOUNT)).length === 1, 'list(propia) no devolvio la conversacion');
  check((await store2.list(OTRA)).length === 0, 'list(ajena) vio datos de otra cuenta');

  await pool2.query('DELETE FROM conversations WHERE account_id = $1', [ACCOUNT]);
  await pool2.end();
  console.log('OK 1/2  conversaciones: sobreviven al reinicio y no se filtran entre cuentas');
}

async function panel() {
  const pool1 = mkPool();
  const store1 = new PostgresPanelStore(pool1);
  await store1.init();

  const user = await store1.upsertUser({
    provider: 'facebook',
    providerUserId: FB_ID,
    name: 'Smoke',
  });
  const otraVez = await store1.upsertUser({ provider: 'facebook', providerUserId: FB_ID });
  check(otraVez.id === user.id, 'entrar dos veces creo dos personas');
  check(otraVez.name === 'Smoke', 'se perdio el nombre al volver a entrar');

  const session = await store1.createSession(user.id, 60_000);
  await store1.grantAccess({ userId: user.id, accountId: ACCOUNT, role: 'owner' });

  const campana = await store1.saveCampaign({
    accountId: ACCOUNT,
    keyword: 'Guía!',
    url: 'https://ejemplo.com/guia.pdf',
    message: 'Aquí está 🎁',
    requireFollow: true,
  });
  await store1.recordEvent({
    accountId: ACCOUNT,
    campaignId: campana.id,
    platformUserId: 'ig-smoke',
    type: 'comment_detected',
    at: Date.now(),
  });
  await pool1.end();

  // Reconexion: todo lo de arriba tiene que seguir ahi.
  const pool2 = mkPool();
  const store2 = new PostgresPanelStore(pool2);

  check((await store2.getSession(session.id))?.userId === user.id, 'la sesion no sobrevivio');
  check(await store2.hasAccess(user.id, ACCOUNT), 'se perdio el acceso a la cuenta propia');
  check(!(await store2.hasAccess(user.id, OTRA)), 'FUGA: dio acceso a una cuenta ajena');

  const porPalabra = await store2.campaignByKeyword(ACCOUNT, 'GUIA');
  check(porPalabra?.id === campana.id, 'no encontro la campana buscando sin tilde ni mayusculas');
  check(porPalabra?.keyword === 'Guía!', 'no conservo la palabra como la escribio el cliente');
  check(
    (await store2.campaignByKeyword(OTRA, 'GUIA')) === undefined,
    'FUGA: vio la campana de otra cuenta',
  );

  let choco = false;
  try {
    await store2.saveCampaign({
      accountId: ACCOUNT,
      keyword: 'guia',
      url: 'https://ejemplo.com/otro.pdf',
      requireFollow: true,
    });
  } catch (err) {
    choco = err instanceof DuplicateKeywordError;
  }
  check(choco, 'dejo crear dos campanas con la misma palabra en la misma cuenta');

  const eventos = await store2.eventsSince(ACCOUNT, 0);
  check(eventos.length === 1, `esperaba 1 evento, hay ${eventos.length}`);
  check(eventos[0]?.type === 'comment_detected', 'el evento volvio con otro tipo');

  await store2.deleteSession(session.id);
  await store2.deleteCampaign(ACCOUNT, campana.id);
  await pool2.query('DELETE FROM panel_events WHERE account_id = $1', [ACCOUNT]);
  await pool2.query('DELETE FROM panel_account_access WHERE user_id = $1', [user.id]);
  await pool2.query('DELETE FROM panel_users WHERE id = $1', [user.id]);

  check((await store2.campaignsOf(ACCOUNT)).length === 0, 'la limpieza dejo campanas');
  check((await store2.eventsSince(ACCOUNT, 0)).length === 0, 'la limpieza dejo eventos');
  await pool2.end();
  console.log('OK 2/2  panel: personas, sesion, acceso, campanas y eventos sobreviven y no se filtran');
}

async function main() {
  await conversaciones();
  await panel();
  console.log('\nGO: la base responde y los dos almacenes funcionan contra ella.');
}

main().catch((err) => {
  console.error('NO-GO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
