import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { createApp } from './server/app.js';
import { FlowEngine } from './core/flowEngine.js';
import pg from 'pg';
import {
  FileConversationStore,
  InMemoryConversationStore,
  PostgresConversationStore,
  type ConversationStore,
} from './store/conversationStore.js';
import {
  InMemoryPanelStore,
  PostgresPanelStore,
  type PanelStore,
} from './store/panelStore.js';
import { StoreFunnelRecorder } from './core/funnel.js';
import { FuentePanelPrimero } from './core/recursos.js';
import { InstagramAdapter } from './platforms/instagram/instagramAdapter.js';
import {
  NoopRateLimiter,
  SlidingWindowRateLimiter,
  RATE_WINDOW_MS,
  type RateLimiter,
} from './core/rateLimiter.js';
import { InProcessSendQueue, type SendQueue } from './core/sendQueue.js';
import {
  InMemoryAccountRegistry,
  DEFAULT_ACCOUNT_ID,
  type Account,
  type AccountRegistry,
} from './core/account.js';
import type { PlatformAdapter } from './core/types.js';

/**
 * Punto de entrada. Cablea las piezas:
 *   store (estado) + adaptadores (redes) -> engine (flujos) -> server (webhooks)
 *
 * Para sumar otra red, se instancia su adaptador y se agrega al Map.
 */
/** Construye el store segun el backend. Postgres necesita init async (crear tabla). */
/**
 * Arma los dos almacenes. Con Postgres comparten un solo pool: son la misma
 * base, abrir dos juegos de conexiones no aporta nada y en el plan Free las
 * conexiones son un recurso escaso.
 *
 * El almacen del panel SIEMPRE existe; sin Postgres es en memoria (sirve para
 * desarrollo y no sobrevive reinicios, que esta bien para eso).
 */
async function buildStores(): Promise<{ store: ConversationStore; panel: PanelStore }> {
  if (env.STORE_BACKEND === 'postgres') {
    // TLS: por defecto VERIFICAMOS el certificado del servidor (Neon/Supabase
    // usan certs de CA publica -> funciona). Solo si tu Postgres usa cert
    // autofirmado, DATABASE_SSL_NO_VERIFY=true relaja la verificacion (con el
    // riesgo de MITM que eso implica).
    const pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      ssl: { rejectUnauthorized: !env.DATABASE_SSL_NO_VERIFY },
    });
    const store = new PostgresConversationStore(pool);
    await store.init();
    const panel = new PostgresPanelStore(pool);
    await panel.init();
    return { store, panel };
  }
  const panel = new InMemoryPanelStore();
  if (env.STORE_BACKEND === 'file') {
    return { store: new FileConversationStore(env.STORE_FILE_PATH), panel };
  }
  return { store: new InMemoryConversationStore(), panel };
}

/**
 * Registro de cuentas (tenants). Fase 0: una sola cuenta desde env (la actual).
 * Fase 2 (dashboard + OAuth) agregara mas y las cargara desde la DB.
 */
function buildAccountRegistry(): AccountRegistry {
  const account: Account = {
    id: DEFAULT_ACCOUNT_ID,
    platform: 'instagram',
    igBusinessAccountId: env.IG_BUSINESS_ACCOUNT_ID,
    accessToken: env.IG_ACCESS_TOKEN,
    label: 'Cuenta principal',
    resourcesSheetCsvUrl: env.RESOURCES_SHEET_CSV_URL || undefined,
  };
  return new InMemoryAccountRegistry([account]);
}

async function main(): Promise<void> {
  const { store, panel } = await buildStores();
  const accounts = buildAccountRegistry();

  const adapters = new Map<string, PlatformAdapter>();
  const instagram = new InstagramAdapter();
  adapters.set(instagram.platform, instagram);

  const rateLimiter: RateLimiter =
    env.RATE_LIMIT_PER_HOUR > 0
      ? new SlidingWindowRateLimiter(env.RATE_LIMIT_PER_HOUR, RATE_WINDOW_MS)
      : new NoopRateLimiter();

  // Gap #2 (opt-in): con cola, ELLA aplica el rate-limit (requeue si topa) y los
  // reintentos; el engine no debe rate-limitar tambien -> le pasamos Noop.
  let sendQueue: SendQueue | undefined;
  let engineRateLimiter: RateLimiter = rateLimiter;
  if (env.SEND_QUEUE_ENABLED) {
    sendQueue = new InProcessSendQueue(adapters, rateLimiter, {
      maxAttempts: env.SEND_QUEUE_MAX_ATTEMPTS,
    });
    engineRateLimiter = new NoopRateLimiter();
  }

  const engine = new FlowEngine(
    store,
    adapters,
    engineRateLimiter,
    sendQueue,
    accounts.primary()?.id ?? DEFAULT_ACCOUNT_ID,
    new StoreFunnelRecorder(panel),
    accounts,
    // El panel manda si la cuenta tiene campanas ahi; si no, la hoja de siempre.
    new FuentePanelPrimero(panel),
  );
  const app = createApp(
    engine,
    adapters,
    store,
    panel,
    accounts.primary()?.id ?? DEFAULT_ACCOUNT_ID,
  );

  app.listen(env.PORT, () => {
    logger.info(`🚀 Servidor escuchando en http://localhost:${env.PORT}`);
    logger.info(`   Webhook: POST /webhooks/instagram`);
    logger.info(`   Follow-gate: ${env.FOLLOW_GATE_ENABLED ? 'ON' : 'OFF'}`);
    logger.info(
      `   Estado: ${env.STORE_BACKEND}${env.STORE_BACKEND === 'file' ? ` (${env.STORE_FILE_PATH})` : ''}`,
    );
    logger.info(
      `   Rate limit: ${env.RATE_LIMIT_PER_HOUR > 0 ? `${env.RATE_LIMIT_PER_HOUR}/h por cuenta` : 'OFF'}`,
    );
    logger.info(
      `   Cola de envios: ${env.SEND_QUEUE_ENABLED ? `ON (max ${env.SEND_QUEUE_MAX_ATTEMPTS} intentos)` : 'OFF'}`,
    );
    logger.info(`   Panel: ${env.PANEL_ENABLED ? 'ON' : 'OFF'} (${env.STORE_BACKEND === 'postgres' ? 'postgres' : 'memoria'})`);
    logger.info(`   Cuentas (tenants): ${accounts.all().length}`);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fallo al arrancar el servidor');
  process.exit(1);
});
