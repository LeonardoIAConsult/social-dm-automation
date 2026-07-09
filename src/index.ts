import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { createApp } from './server/app.js';
import { FlowEngine } from './core/flowEngine.js';
import { InMemoryConversationStore } from './store/conversationStore.js';
import { InstagramAdapter } from './platforms/instagram/instagramAdapter.js';
import type { PlatformAdapter } from './core/types.js';

/**
 * Punto de entrada. Cablea las piezas:
 *   store (estado) + adaptadores (redes) -> engine (flujos) -> server (webhooks)
 *
 * Para sumar otra red, se instancia su adaptador y se agrega al Map.
 */
function main(): void {
  const store = new InMemoryConversationStore();

  const adapters = new Map<string, PlatformAdapter>();
  const instagram = new InstagramAdapter();
  adapters.set(instagram.platform, instagram);

  const engine = new FlowEngine(store, adapters);
  const app = createApp(engine, adapters);

  app.listen(env.PORT, () => {
    logger.info(`🚀 Servidor escuchando en http://localhost:${env.PORT}`);
    logger.info(`   Webhook: POST /webhooks/instagram`);
    logger.info(`   Follow-gate: ${env.FOLLOW_GATE_ENABLED ? 'ON' : 'OFF'}`);
  });
}

main();
