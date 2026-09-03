import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PostgresConversationStore,
  type ConversationState,
  type Queryable,
} from '../src/store/conversationStore.js';

/** Queryable falso: registra las consultas y devuelve filas programables. */
function fakeDb(rowsFor: (sql: string, params?: unknown[]) => Array<{ state: ConversationState }>) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const db: Queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: rowsFor(sql, params) };
    },
  };
  return { db, calls };
}

function state(userId: string): ConversationState {
  return { platform: 'instagram', userId, lastUserInteractionAt: 1, data: {}, messages: [] };
}

const DEFAULT = 'default';

test('init crea la tabla si no existe', async () => {
  const { db, calls } = fakeDb(() => []);
  await new PostgresConversationStore(db).init();
  assert.match(calls[0]?.sql ?? '', /CREATE TABLE IF NOT EXISTS conversations/);
});

test('get consulta por PK y devuelve el state de la fila', async () => {
  const { db, calls } = fakeDb((sql) =>
    sql.startsWith('SELECT state FROM conversations WHERE') ? [{ state: state('U1') }] : [],
  );
  const got = await new PostgresConversationStore(db).get('instagram', 'U1');
  assert.equal(got?.userId, 'U1');
  assert.deepEqual(calls[0]?.params, [DEFAULT, 'instagram', 'U1']);
});

test('get de clave inexistente devuelve undefined', async () => {
  const { db } = fakeDb(() => []);
  assert.equal(await new PostgresConversationStore(db).get('instagram', 'NOPE'), undefined);
});

test('upsert usa INSERT ... ON CONFLICT y serializa el state a jsonb', async () => {
  const { db, calls } = fakeDb(() => []);
  await new PostgresConversationStore(db).upsert(state('U1'));
  const c = calls[0];
  assert.match(c?.sql ?? '', /INSERT INTO conversations/);
  assert.match(c?.sql ?? '', /ON CONFLICT \(account_id, platform, user_id\)/);
  assert.equal(c?.params?.[0], DEFAULT);
  assert.equal(c?.params?.[1], 'instagram');
  assert.equal(c?.params?.[2], 'U1');
  // El 4to parametro es el state serializado (string JSON), no el objeto.
  assert.equal(typeof c?.params?.[3], 'string');
  assert.equal(JSON.parse(c?.params?.[3] as string).userId, 'U1');
});

test('upsert respeta el accountId del state (aislamiento por tenant)', async () => {
  const { db, calls } = fakeDb(() => []);
  await new PostgresConversationStore(db).upsert({ ...state('U1'), accountId: 'clienteA' });
  assert.equal(calls[0]?.params?.[0], 'clienteA');
});

test('list filtra por tenant cuando se pasa accountId', async () => {
  const { db, calls } = fakeDb(() => []);
  await new PostgresConversationStore(db).list('clienteA');
  assert.deepEqual(calls[0]?.params, ['clienteA']);
});

test('list mapea las filas a states y acota con LIMIT', async () => {
  const { db, calls } = fakeDb(() => [{ state: state('U1') }, { state: state('U2') }]);
  const all = await new PostgresConversationStore(db).list();
  assert.equal(all.length, 2);
  assert.match(calls[0]?.sql ?? '', /LIMIT 500/);
});
