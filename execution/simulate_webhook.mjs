/**
 * Simulador de webhooks de Instagram para pruebas LOCALES (sin Meta).
 *
 * Construye un payload igual al que enviaria Meta, lo firma con HMAC-SHA256
 * usando META_APP_SECRET (igual que la firma real), y lo POSTea al server local.
 * Asi pruebas el flujo completo (match de campana, follow-gate, entrega) sin
 * depender de la App Review ni de credenciales reales. Requiere DRY_RUN=true.
 *
 * Uso:
 *   node execution/simulate_webhook.mjs comment "quiero la GUIA"
 *   node execution/simulate_webhook.mjs message "GUIA"
 *   node execution/simulate_webhook.mjs follow-check freebie-guia
 *
 * Variables (opcional): PORT, META_APP_SECRET, SIM_USER, SIM_MEDIA
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// --- Carga simple de .env (sin dependencias) ---
function loadEnv() {
  const p = path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const SECRET = process.env.META_APP_SECRET || 'dev-app-secret';
const USER = process.env.SIM_USER || 'SIM_USER_123';
const MEDIA = process.env.SIM_MEDIA || 'SIM_MEDIA_456';

const [kind = 'comment', arg = 'quiero la GUIA'] = process.argv.slice(2);
const now = Date.now();

function body() {
  switch (kind) {
    case 'comment':
      return {
        object: 'instagram',
        entry: [
          {
            id: 'IG_BIZ',
            time: now,
            changes: [
              {
                field: 'comments',
                value: {
                  id: 'COMMENT_' + now,
                  text: arg,
                  from: { id: USER, username: 'usuario_prueba' },
                  media: { id: MEDIA },
                },
              },
            ],
          },
        ],
      };
    case 'message':
      return {
        object: 'instagram',
        entry: [
          {
            id: 'IG_BIZ',
            time: now,
            messaging: [
              { sender: { id: USER }, recipient: { id: 'IG_BIZ' }, timestamp: now, message: { mid: 'm_' + now, text: arg } },
            ],
          },
        ],
      };
    case 'follow-check':
      // Simula el click en "Ya te sigo" (quick reply) de la campana `arg`.
      return {
        object: 'instagram',
        entry: [
          {
            id: 'IG_BIZ',
            time: now,
            messaging: [
              { sender: { id: USER }, recipient: { id: 'IG_BIZ' }, timestamp: now, message: { mid: 'm_' + now, text: 'Ya te sigo', quick_reply: { payload: 'CHECK_FOLLOW:' + arg } } },
            ],
          },
        ],
      };
    default:
      console.error(`Tipo desconocido: ${kind}. Usa comment | message | follow-check`);
      process.exit(1);
  }
}

const payload = JSON.stringify(body());
const signature = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');

// TARGET permite apuntar a produccion (Render). Por defecto, local.
const target = process.env.TARGET || `http://localhost:${PORT}`;
const url = `${target.replace(/\/$/, '')}/webhooks/instagram`;
console.log(`→ POST ${url}\n  tipo=${kind} texto="${arg}" user=${USER} media=${MEDIA}`);

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
  body: payload,
});
console.log(`← HTTP ${res.status}. Mira los logs del server (npm run dev) para ver el flujo.`);
