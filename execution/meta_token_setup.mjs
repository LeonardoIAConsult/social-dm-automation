/**
 * Helper de conexion con Meta (Instagram Login).
 *
 * Convierte un token de CORTA duracion (el que copias de Graph API Explorer o
 * del flujo de Instagram Login) en uno de LARGA duracion (~60 dias) y te dice
 * tu IG user id, para pegar ambos en el .env.
 *
 * Uso:
 *   IG_APP_ID=xxx IG_APP_SECRET=yyy IG_SHORT_TOKEN=zzz node execution/meta_token_setup.mjs
 *   (o define esos valores en .env y solo corre: node execution/meta_token_setup.mjs)
 *
 * Referencia oficial (verifica endpoints segun tu version de API):
 *   https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const p = path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv();

const APP_ID = process.env.IG_APP_ID;
const APP_SECRET = process.env.IG_APP_SECRET || process.env.META_APP_SECRET;
const SHORT = process.env.IG_SHORT_TOKEN;

if (!APP_SECRET || !SHORT) {
  console.error('Faltan variables. Necesito: IG_APP_SECRET (o META_APP_SECRET) e IG_SHORT_TOKEN.');
  console.error('Opcional: IG_APP_ID (para el flujo de Facebook Login).');
  process.exit(1);
}

async function j(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(JSON.stringify(data.error ?? data));
  return data;
}

try {
  // 1) Token corto -> largo (flujo Instagram Login).
  const ex = await j(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token` +
      `&client_secret=${encodeURIComponent(APP_SECRET)}` +
      `&access_token=${encodeURIComponent(SHORT)}`,
  );
  const longToken = ex.access_token;
  console.log(`\n✅ Token de larga duracion (expira en ~${Math.round((ex.expires_in ?? 0) / 86400)} dias):`);
  console.log(longToken);

  // 2) IG user id (sirve como IG_BUSINESS_ACCOUNT_ID en el flujo Instagram Login).
  const me = await j(
    `https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(longToken)}`,
  );
  console.log(`\n✅ Tu cuenta: @${me.username}  (user_id: ${me.user_id})`);

  console.log('\n👉 Pega esto en tu .env:');
  console.log(`IG_ACCESS_TOKEN=${longToken}`);
  console.log(`IG_BUSINESS_ACCOUNT_ID=${me.user_id}`);
  console.log('\nY recuerda: DRY_RUN=false para modo real.');
} catch (err) {
  console.error('\n❌ Fallo:', err.message);
  console.error('Verifica que el token corto sea valido y que la app tenga Instagram configurado.');
  console.error('Si usas Facebook Login (no Instagram Login), el endpoint es distinto (oauth/access_token con fb_exchange_token).');
  process.exit(1);
}
