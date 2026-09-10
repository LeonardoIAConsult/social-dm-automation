import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * El semaforo del panel: la unica pregunta que responde `salud()` es si la
 * cuenta del cliente sigue conectada. Lo que se prueba aqui son las REGLAS de
 * esa respuesta, sobre todo la que duele: mandar a reconectar a alguien cuya
 * cuenta esta bien (o callarse cuando de verdad se vencio el token) es el error
 * caro, asi que 'sin-permiso' y 'no-se-pudo' se prueban por separado.
 *
 * Ojo con el orden de los imports: fijamos el entorno ANTES de cargar la config
 * (dotenv no pisa lo que ya existe en process.env). Asi la prueba no depende
 * del `.env` de la maquina, y con DRY_RUN=false podemos ejercitar el camino de
 * red de verdad — pero contra un doble de `fetch`, nunca contra Meta.
 */
process.env.DRY_RUN = 'false';
process.env.STORE_BACKEND = 'memory';
process.env.RESOURCES_SHEET_CSV_URL = '';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token-de-pruebas';
process.env.META_APP_SECRET = 'secreto-de-app-de-pruebas';
process.env.IG_ACCESS_TOKEN = 'IGAA-token-de-pruebas';
process.env.IG_BUSINESS_ACCOUNT_ID = '17841400000000000';

const { InstagramClient } = await import('../src/platforms/instagram/client.js');
const { env } = await import('../src/config/env.js');

const fetchReal = globalThis.fetch;

/** Deja `fetch` respondiendo lo que diga `responder` y lo restaura al final. */
async function conFetch(
  responder: (url: string) => Response | Promise<Response>,
  cuerpo: (llamadas: string[]) => Promise<void>,
): Promise<void> {
  const llamadas: string[] = [];
  globalThis.fetch = (async (entrada: unknown) => {
    llamadas.push(String(entrada));
    return responder(String(entrada));
  }) as typeof fetch;
  try {
    await cuerpo(llamadas);
  } finally {
    globalThis.fetch = fetchReal;
  }
}

const json = (cuerpo: unknown, status: number) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test('si Meta contesta bien, la cuenta esta ok y trae su username', async () => {
  await conFetch(
    () => json({ id: '17841400000000000', username: 'marcela.reposteria' }, 200),
    async () => {
      const salud = await new InstagramClient().salud();
      assert.deepEqual(salud, { estado: 'ok', username: 'marcela.reposteria' });
    },
  );
});

test('pregunta por id y username de la propia cuenta, con el token de la cuenta', async () => {
  await conFetch(
    () => json({ id: '17841400000000000', username: 'marcela.reposteria' }, 200),
    async (llamadas) => {
      await new InstagramClient().salud();

      assert.equal(llamadas.length, 1, 'una sola llamada, no un barrido');
      const url = new URL(llamadas[0] as string);
      assert.ok(
        url.pathname.endsWith(`/${env.IG_BUSINESS_ACCOUNT_ID}`),
        `pregunta por la cuenta del negocio, no por otra cosa: ${url.pathname}`,
      );
      assert.equal(url.searchParams.get('fields'), 'id,username');
      assert.equal(url.searchParams.get('access_token'), env.IG_ACCESS_TOKEN);
    },
  );
});

test('un token vencido o revocado se reporta como sin-permiso, no como fallo pasajero', async () => {
  await conFetch(
    () =>
      json(
        {
          error: {
            message: 'Error validating access token: Session has expired',
            type: 'OAuthException',
            code: 190,
            error_subcode: 463,
          },
        },
        400,
      ),
    async () => {
      const salud = await new InstagramClient().salud();
      assert.deepEqual(salud, { estado: 'sin-permiso' });
    },
  );
});

test('un permiso que el cliente no otorgo tambien es sin-permiso', async () => {
  await conFetch(
    () =>
      json(
        {
          error: {
            message: '(#200) Permissions error',
            type: 'OAuthException',
            code: 200,
          },
        },
        403,
      ),
    async () => {
      const salud = await new InstagramClient().salud();
      assert.deepEqual(salud, { estado: 'sin-permiso' });
    },
  );
});

test('un 401 pelado, sin cuerpo que lo explique, sigue siendo sin-permiso', async () => {
  await conFetch(
    () => json({}, 401),
    async () => {
      const salud = await new InstagramClient().salud();
      assert.deepEqual(salud, { estado: 'sin-permiso' });
    },
  );
});

test('si Meta se cae (5xx) NO se acusa al token: es no-se-pudo', async () => {
  await conFetch(
    () =>
      json(
        { error: { message: 'An unknown error occurred', type: 'OAuthException', code: 1 } },
        500,
      ),
    async () => {
      const salud = await new InstagramClient().salud();
      assert.deepEqual(
        salud,
        { estado: 'no-se-pudo' },
        'mandar a reconectar por una caida de Meta rompe una cuenta sana',
      );
    },
  );
});

test('un 5xx etiquetado como OAuth sigue siendo no-se-pudo', async () => {
  // Meta a veces devuelve sus caidas con la etiqueta de OAuth y sin codigo con
  // que decidir. Creerle a la etiqueta mandaria a reconectar a un cliente sano.
  await conFetch(
    () =>
      json(
        { error: { message: 'Service temporarily unavailable', type: 'OAuthException' } },
        503,
      ),
    async () => {
      const salud = await new InstagramClient().salud();
      assert.deepEqual(salud, { estado: 'no-se-pudo' });
    },
  );
});

test('un limite de peticiones tampoco es sin-permiso', async () => {
  await conFetch(
    () =>
      json({ error: { message: 'Application request limit reached', code: 4 } }, 400),
    async () => {
      const salud = await new InstagramClient().salud();
      assert.deepEqual(salud, { estado: 'no-se-pudo' });
    },
  );
});

test('con la red caida devuelve no-se-pudo en vez de lanzar', async () => {
  await conFetch(
    () => {
      throw new TypeError('fetch failed');
    },
    async () => {
      const salud = await new InstagramClient().salud();
      assert.deepEqual(salud, { estado: 'no-se-pudo' });
    },
  );
});

test('una respuesta que ni siquiera es JSON no tumba la pantalla', async () => {
  await conFetch(
    () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    async () => {
      const salud = await new InstagramClient().salud();
      assert.deepEqual(salud, { estado: 'no-se-pudo' });
    },
  );
});

test('en DRY_RUN responde una cuenta de prueba sin salir a la red', async () => {
  // DRY_RUN se resuelve al cargar la config, asi que para ejercitar esa rama en
  // el mismo archivo hay que encenderla en caliente y devolverla como estaba.
  const antes = env.DRY_RUN;
  (env as { DRY_RUN: boolean }).DRY_RUN = true;
  try {
    await conFetch(
      () => {
        throw new Error('en DRY_RUN no se puede tocar la red');
      },
      async (llamadas) => {
        const salud = await new InstagramClient().salud();
        assert.deepEqual(salud, { estado: 'ok', username: 'cuenta_de_prueba' });
        assert.equal(llamadas.length, 0, 'ni una llamada al Graph API');
      },
    );
  } finally {
    (env as { DRY_RUN: boolean }).DRY_RUN = antes;
  }
});
