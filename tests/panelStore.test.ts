import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DuplicateKeywordError,
  InMemoryPanelStore,
  type PanelStore,
} from '../src/store/panelStore.js';

/**
 * Contrato del almacen del panel, probado contra la implementacion en memoria.
 * Son las reglas que CUALQUIER backend debe cumplir; la de Postgres se prueba
 * aparte (forma del SQL) y contra la base real con `execution/db_smoke.ts`.
 */

function nuevo(): PanelStore {
  return new InMemoryPanelStore();
}

const FB = 'facebook' as const;

test('upsertUser crea una vez y despues actualiza la misma persona', async () => {
  const store = nuevo();
  const primera = await store.upsertUser({ provider: FB, providerUserId: 'fb-1', name: 'Marcela' });
  const segunda = await store.upsertUser({
    provider: FB,
    providerUserId: 'fb-1',
    email: 'marcela@ejemplo.com',
  });

  assert.equal(segunda.id, primera.id, 'entrar dos veces no puede crear dos personas');
  assert.equal(segunda.name, 'Marcela', 'no se pierde el nombre si el proveedor no lo manda');
  assert.equal(segunda.email, 'marcela@ejemplo.com');
});

test('getUserByProvider distingue personas distintas', async () => {
  const store = nuevo();
  await store.upsertUser({ provider: FB, providerUserId: 'fb-1' });
  const otra = await store.getUserByProvider(FB, 'fb-2');
  assert.equal(otra, undefined);
});

test('la sesion vale hasta que vence, y luego no', async () => {
  const store = nuevo();
  const user = await store.upsertUser({ provider: FB, providerUserId: 'fb-1' });

  const viva = await store.createSession(user.id, 60_000);
  assert.equal((await store.getSession(viva.id))?.userId, user.id);

  const vencida = await store.createSession(user.id, -1);
  assert.equal(await store.getSession(vencida.id), undefined, 'una sesion vencida no sirve');
});

test('cerrar sesion la invalida de inmediato', async () => {
  const store = nuevo();
  const user = await store.upsertUser({ provider: FB, providerUserId: 'fb-1' });
  const s = await store.createSession(user.id, 60_000);

  await store.deleteSession(s.id);

  assert.equal(await store.getSession(s.id), undefined);
});

test('el acceso NO se filtra entre clientes', async () => {
  const store = nuevo();
  const marcela = await store.upsertUser({ provider: FB, providerUserId: 'fb-marcela' });
  const otro = await store.upsertUser({ provider: FB, providerUserId: 'fb-otro' });
  await store.grantAccess({ userId: marcela.id, accountId: 'cuenta-marcela', role: 'owner' });
  await store.grantAccess({ userId: otro.id, accountId: 'cuenta-otro', role: 'owner' });

  assert.equal(await store.hasAccess(marcela.id, 'cuenta-marcela'), true);
  assert.equal(
    await store.hasAccess(marcela.id, 'cuenta-otro'),
    false,
    'pedir la cuenta ajena a mano tiene que dar negado',
  );
  assert.deepEqual(
    (await store.accountsOf(marcela.id)).map((a) => a.accountId),
    ['cuenta-marcela'],
  );
});

test('grantAccess dos veces cambia el rol en vez de duplicar la fila', async () => {
  const store = nuevo();
  const user = await store.upsertUser({ provider: FB, providerUserId: 'fb-1' });
  await store.grantAccess({ userId: user.id, accountId: 'c1', role: 'owner' });
  await store.grantAccess({ userId: user.id, accountId: 'c1', role: 'staff' });

  const accesos = await store.accountsOf(user.id);
  assert.equal(accesos.length, 1);
  assert.equal(accesos[0]?.role, 'staff');
});

test('la campana guarda la palabra como la escribio el cliente y la busca normalizada', async () => {
  const store = nuevo();
  const guardada = await store.saveCampaign({
    accountId: 'c1',
    keyword: 'Guía!',
    url: 'https://ejemplo.com/guia.pdf',
    requireFollow: true,
  });

  assert.equal(guardada.keyword, 'Guía!', 'se muestra tal como la escribio');
  assert.equal((await store.campaignByKeyword('c1', 'GUIA'))?.id, guardada.id);
  assert.equal((await store.campaignByKeyword('c1', 'guia'))?.id, guardada.id);
});

test('dos campanas de la misma cuenta no pueden compartir palabra', async () => {
  const store = nuevo();
  const primera = await store.saveCampaign({
    accountId: 'c1',
    keyword: 'GUIA',
    url: 'https://ejemplo.com/a.pdf',
    requireFollow: true,
  });

  await assert.rejects(
    () =>
      store.saveCampaign({
        accountId: 'c1',
        keyword: 'guía',
        url: 'https://ejemplo.com/b.pdf',
        requireFollow: true,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DuplicateKeywordError);
      assert.equal(err.existingCampaignId, primera.id, 'debe decir con cual choca');
      return true;
    },
  );
});

test('la misma palabra si puede repetirse en cuentas distintas', async () => {
  const store = nuevo();
  await store.saveCampaign({
    accountId: 'c1',
    keyword: 'GUIA',
    url: 'https://ejemplo.com/a.pdf',
    requireFollow: true,
  });
  await store.saveCampaign({
    accountId: 'c2',
    keyword: 'GUIA',
    url: 'https://ejemplo.com/b.pdf',
    requireFollow: true,
  });

  assert.equal((await store.campaignsOf('c1')).length, 1);
  assert.equal((await store.campaignsOf('c2')).length, 1);
});

test('editar una campana conservando su palabra no choca consigo misma', async () => {
  const store = nuevo();
  const c = await store.saveCampaign({
    accountId: 'c1',
    keyword: 'GUIA',
    url: 'https://ejemplo.com/a.pdf',
    requireFollow: true,
  });

  const editada = await store.saveCampaign({
    id: c.id,
    accountId: 'c1',
    keyword: 'GUIA',
    url: 'https://ejemplo.com/nuevo.pdf',
    message: 'Aquí está 🎁',
    requireFollow: false,
  });

  assert.equal(editada.id, c.id);
  assert.equal(editada.url, 'https://ejemplo.com/nuevo.pdf');
  assert.equal(editada.requireFollow, false);
  assert.equal((await store.campaignsOf('c1')).length, 1, 'editar no crea una segunda');
});

test('deleteCampaign no borra la campana de otra cuenta', async () => {
  const store = nuevo();
  const ajena = await store.saveCampaign({
    accountId: 'c2',
    keyword: 'GUIA',
    url: 'https://ejemplo.com/a.pdf',
    requireFollow: true,
  });

  await store.deleteCampaign('c1', ajena.id);

  assert.equal((await store.campaignsOf('c2')).length, 1, 'borrar con otra cuenta no debe tocarla');
});

test('los eventos vuelven por cuenta, desde la hora pedida y en orden', async () => {
  const store = nuevo();
  const base = 1_000_000;
  await store.recordEvent({
    accountId: 'c1',
    platformUserId: 'ig-1',
    type: 'dm_sent',
    at: base + 20,
  });
  await store.recordEvent({
    accountId: 'c1',
    platformUserId: 'ig-1',
    type: 'comment_detected',
    at: base + 10,
  });
  await store.recordEvent({
    accountId: 'c1',
    platformUserId: 'ig-1',
    type: 'blocked_not_following',
    at: base - 100,
  });
  await store.recordEvent({
    accountId: 'c2',
    platformUserId: 'ig-9',
    type: 'dm_sent',
    at: base + 15,
  });

  const eventos = await store.eventsSince('c1', base);

  assert.deepEqual(
    eventos.map((e) => e.type),
    ['comment_detected', 'dm_sent'],
    'solo los de la cuenta, solo desde la hora pedida, del mas viejo al mas nuevo',
  );
});

test('recordEvent devuelve el evento con id propio', async () => {
  const store = nuevo();
  const e = await store.recordEvent({
    accountId: 'c1',
    platformUserId: 'ig-1',
    type: 'resource_delivered',
    at: Date.now(),
  });
  assert.ok(e.id && e.id.length > 0);
});
