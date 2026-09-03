import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FileConversationStore,
  type ConversationState,
} from '../src/store/conversationStore.js';

/** Crea un directorio temporal aislado y devuelve una ruta de archivo dentro. */
function tmpFilePath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'convstore-'));
  return { dir, file: join(dir, `${randomUUID()}.json`) };
}

function state(userId: string, text: string): ConversationState {
  return {
    platform: 'instagram',
    userId,
    lastUserInteractionAt: 1,
    data: {},
    messages: [{ dir: 'in', kind: 'comment', text, at: 1 }],
  };
}

test('persiste y sobrevive un reinicio (nueva instancia recarga del disco)', async () => {
  const { dir, file } = tmpFilePath();
  try {
    const s1 = new FileConversationStore(file);
    await s1.upsert(state('U1', 'hola'));
    assert.ok(existsSync(file), 'debe crear el archivo en disco');

    // Simula reinicio: otra instancia leyendo el mismo archivo.
    const s2 = new FileConversationStore(file);
    const got = await s2.get('instagram', 'U1');
    assert.equal(got?.userId, 'U1');
    assert.equal(got?.messages[0]?.text, 'hola');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert sobre la misma clave reemplaza (no duplica)', async () => {
  const { dir, file } = tmpFilePath();
  try {
    const s = new FileConversationStore(file);
    await s.upsert(state('U1', 'v1'));
    await s.upsert(state('U1', 'v2'));
    const all = await s.list();
    assert.equal(all.length, 1);
    assert.equal(all[0]?.messages[0]?.text, 'v2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list devuelve todas las conversaciones persistidas', async () => {
  const { dir, file } = tmpFilePath();
  try {
    const s = new FileConversationStore(file);
    await s.upsert(state('U1', 'a'));
    await s.upsert(state('U2', 'b'));
    const all = await new FileConversationStore(file).list();
    assert.equal(all.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archivo corrupto no mata el arranque: empieza vacio', async () => {
  const { dir, file } = tmpFilePath();
  try {
    writeFileSync(file, '{no es json valido', 'utf8');
    const s = new FileConversationStore(file); // no debe lanzar
    assert.equal((await s.list()).length, 0);
    // y sigue usable: puede escribir sobre el archivo corrupto
    await s.upsert(state('U1', 'recuperado'));
    assert.equal((await new FileConversationStore(file).list()).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archivo corrupto se respalda a .bak antes de reescribir', async () => {
  const { dir, file } = tmpFilePath();
  try {
    writeFileSync(file, 'basura no json', 'utf8');
    new FileConversationStore(file); // load() debe respaldar el corrupto
    const baks = readdirSync(dir).filter((f) => f.includes('.bak-'));
    assert.ok(baks.length >= 1, 'debe crear un respaldo .bak del archivo corrupto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('get de clave inexistente devuelve undefined', async () => {
  const { dir, file } = tmpFilePath();
  try {
    const s = new FileConversationStore(file);
    assert.equal(await s.get('instagram', 'NOPE'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
