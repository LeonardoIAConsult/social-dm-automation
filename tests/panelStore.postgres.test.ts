import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresPanelStore, type PanelQueryable } from '../src/store/panelStore.js';

/**
 * Forma del SQL del backend Postgres del panel. No abre conexion: usa un doble
 * que registra las consultas. Que la base REAL responda se prueba aparte con
 * `execution/db_smoke.ts`.
 */
function fakeDb(rowsFor: (sql: string, params?: unknown[]) => unknown[] = () => []) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const db: PanelQueryable = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows: rowsFor(sql, params) as never[] };
    },
  };
  return { db, calls };
}

const sqlOf = (calls: Array<{ sql: string }>) => calls.map((c) => c.sql).join('\n');

test('init crea las cinco tablas del panel y el indice de eventos', async () => {
  const { db, calls } = fakeDb();
  await new PostgresPanelStore(db).init();
  const sql = sqlOf(calls);

  for (const tabla of [
    'panel_users',
    'panel_sessions',
    'panel_account_access',
    'panel_campaigns',
    'panel_events',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla}`), `falta la tabla ${tabla}`);
  }
  assert.match(sql, /CREATE INDEX IF NOT EXISTS panel_events_account_at/);
});

test('init es repetible: todo va con IF NOT EXISTS', async () => {
  const { db, calls } = fakeDb();
  const store = new PostgresPanelStore(db);
  await store.init();
  await store.init();

  // Lo que importa es que arrancar dos veces no rompa. `CREATE/ADD ... IF NOT
  // EXISTS` y `DROP ... IF EXISTS` lo son; el backfill (`UPDATE ... WHERE
  // dedupe_key IS NULL`) y el `SET NOT NULL` tambien, porque la segunda vez no
  // encuentran nada que cambiar.
  const idempotente = (sql: string) =>
    /IF (NOT )?EXISTS/.test(sql) ||
    /SET NOT NULL/.test(sql) ||
    /WHERE dedupe_key IS NULL/.test(sql);
  for (const { sql } of calls) {
    assert.ok(idempotente(sql), `arrancar dos veces romperia con: ${sql.slice(0, 70)}`);
  }
});

test('la unicidad de eventos va por CUENTA, no por clave global', async () => {
  const { db, calls } = fakeDb();
  await new PostgresPanelStore(db).init();
  const sql = sqlOf(calls);

  // La tabla puede existir de una version anterior sin la columna: hay que
  // agregarla, rellenar las filas viejas y recien entonces exigirla.
  assert.match(sql, /ALTER TABLE panel_events ADD COLUMN IF NOT EXISTS dedupe_key/);
  assert.match(sql, /UPDATE panel_events SET dedupe_key = id WHERE dedupe_key IS NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS panel_events_cuenta_dedupe/);
  assert.match(sql, /\(account_id, dedupe_key\)/);
  assert.ok(
    !/dedupe_key\s+text\s+NOT NULL UNIQUE/.test(sql),
    'una clave unica global deja que un tenant pise el conteo de otro',
  );
});

test('upsertUser evita duplicar a la misma persona del proveedor', async () => {
  const { db, calls } = fakeDb(() => [
    { id: 'u1', provider: 'facebook', provider_user_id: 'fb-1', name: null, email: null, created_at: new Date() },
  ]);
  await new PostgresPanelStore(db).upsertUser({ provider: 'facebook', providerUserId: 'fb-1' });

  const sql = calls[0]?.sql ?? '';
  assert.match(sql, /INSERT INTO panel_users/);
  assert.match(sql, /ON CONFLICT \(provider, provider_user_id\)/);
  assert.match(sql, /COALESCE\(EXCLUDED\.name/, 'no debe borrar el nombre si el proveedor no lo manda');
});

test('getSession deja la expiracion en manos de la base, no del reloj del contenedor', async () => {
  const { db, calls } = fakeDb(() => []);
  await new PostgresPanelStore(db).getSession('s1');

  assert.match(calls[0]?.sql ?? '', /expires_at > now\(\)/);
});

test('hasAccess consulta por la pareja usuario+cuenta', async () => {
  const { db, calls } = fakeDb(() => []);
  const ok = await new PostgresPanelStore(db).hasAccess('u1', 'c1');

  assert.equal(ok, false, 'sin filas = sin acceso');
  assert.match(calls[0]?.sql ?? '', /WHERE user_id = \$1 AND account_id = \$2/);
  assert.deepEqual(calls[0]?.params, ['u1', 'c1']);
});

test('saveCampaign busca choque de palabra antes de escribir', async () => {
  const fila = {
    id: 'camp-1',
    account_id: 'c1',
    keyword: 'Guía!',
    keyword_normalized: 'guia',
    url: 'https://ejemplo.com/a.pdf',
    message: null,
    require_follow: true,
    updated_at: new Date(),
  };
  // El SELECT de choque no devuelve nada; el INSERT ... RETURNING si.
  const { db, calls } = fakeDb((sql) => (sql.includes('INSERT') ? [fila] : []));
  await new PostgresPanelStore(db).saveCampaign({
    accountId: 'c1',
    keyword: 'Guía!',
    url: 'https://ejemplo.com/a.pdf',
    requireFollow: true,
  });

  assert.match(calls[0]?.sql ?? '', /SELECT \* FROM panel_campaigns/, 'primero pregunta');
  assert.deepEqual(calls[0]?.params, ['c1', 'guia'], 'busca por la palabra normalizada');
  assert.match(calls[1]?.sql ?? '', /INSERT INTO panel_campaigns/);
  assert.match(calls[1]?.sql ?? '', /ON CONFLICT \(id\) DO UPDATE/, 'editar no crea otra fila');
});

test('deleteCampaign exige la cuenta en el WHERE', async () => {
  const { db, calls } = fakeDb();
  await new PostgresPanelStore(db).deleteCampaign('c1', 'camp-1');

  assert.match(calls[0]?.sql ?? '', /DELETE FROM panel_campaigns WHERE account_id = \$1 AND id = \$2/);
});

test('eventsSince filtra por cuenta y ordena del mas viejo al mas nuevo', async () => {
  const { db, calls } = fakeDb(() => []);
  await new PostgresPanelStore(db).eventsSince('c1', 1_000_000);

  const sql = calls[0]?.sql ?? '';
  assert.match(sql, /WHERE account_id = \$1/);
  assert.match(sql, /ORDER BY at ASC/);
  assert.match(sql, /LIMIT \$3/, 'sin cota, la pantalla de resultados se traeria la tabla entera');
  assert.equal(calls[0]?.params?.[0], 'c1');
  assert.equal(calls[0]?.params?.[1], 1_000_000);
  assert.ok(Number(calls[0]?.params?.[2]) > 0, 'la cota tiene que ser un numero positivo');
});

test('recordEvent guarda la hora del evento, no la del INSERT', async () => {
  const at = 1_700_000_000_000;
  const { db, calls } = fakeDb(() => [
    {
      id: 'e1',
      account_id: 'c1',
      campaign_id: null,
      platform_user_id: 'ig-1',
      type: 'dm_sent',
      at: new Date(at),
    },
  ]);
  const guardado = await new PostgresPanelStore(db).recordEvent({
    accountId: 'c1',
    platformUserId: 'ig-1',
    type: 'dm_sent',
    at,
  });

  assert.match(calls[0]?.sql ?? '', /to_timestamp\(\$6::double precision \/ 1000\)/);
  assert.equal(calls[0]?.params?.[5], at);
  assert.equal(guardado.at, at, 'vuelve como epoch ms, no como Date');
});
