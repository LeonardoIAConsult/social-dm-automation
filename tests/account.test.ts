import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAccountRegistry, DEFAULT_ACCOUNT_ID, type Account } from '../src/core/account.js';

function acc(id: string, igId: string): Account {
  return { id, platform: 'instagram', igBusinessAccountId: igId, accessToken: `tok-${id}` };
}

test('resuelve por id y por IG id', () => {
  const reg = new InMemoryAccountRegistry([acc('a', 'IG1'), acc('b', 'IG2')]);
  assert.equal(reg.byId('a')?.igBusinessAccountId, 'IG1');
  assert.equal(reg.byIgId('IG2')?.id, 'b');
  assert.equal(reg.byId('nope'), undefined);
  assert.equal(reg.byIgId('nope'), undefined);
});

test('primary es la primera cuenta; all las devuelve todas', () => {
  const reg = new InMemoryAccountRegistry([acc('a', 'IG1'), acc('b', 'IG2')]);
  assert.equal(reg.primary()?.id, 'a');
  assert.equal(reg.all().length, 2);
});

test('registry vacio: primary undefined', () => {
  const reg = new InMemoryAccountRegistry([]);
  assert.equal(reg.primary(), undefined);
  assert.equal(reg.all().length, 0);
});

test('el tenant default tiene id estable', () => {
  assert.equal(DEFAULT_ACCOUNT_ID, 'default');
});
