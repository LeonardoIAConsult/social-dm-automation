/**
 * Levanta el panel en tu maquina, con datos de ejemplo, para verlo con los ojos.
 *
 * No toca produccion ni la base de Render: todo vive en memoria y se borra al
 * cerrarlo. Sirve para revisar la cara del producto, probar el editor y ver como
 * se comporta cada pantalla antes de mostrarselo a un cliente.
 *
 * Uso:
 *   npx tsx execution/panel_demo.ts
 *
 * Imprime dos enlaces de entrada: uno de un cliente con actividad (Marcela) y
 * otro de una cuenta recien creada, para ver como se ve el primer dia.
 */
process.env.PANEL_ENABLED = 'true';
process.env.SESSION_SECRET = 'demo-local-secreto-largo-para-firmar-cookies-1234';
process.env.DRY_RUN = 'true';
process.env.STORE_BACKEND = 'memory';
process.env.RESOURCES_SHEET_CSV_URL = '';
process.env.META_APP_SECRET = 'demo-local';
process.env.INBOX_USER = '';
process.env.INBOX_PASS = '';
// Puerto propio para no chocar con un servidor de desarrollo ya levantado.
process.env.PORT = process.env.PUERTO_DEMO ?? '3200';

const { createApp } = await import('../src/server/app.js');
const { FlowEngine } = await import('../src/core/flowEngine.js');
const { StoreFunnelRecorder } = await import('../src/core/funnel.js');
const { FuentePanelPrimero } = await import('../src/core/recursos.js');
const { InMemoryConversationStore } = await import('../src/store/conversationStore.js');
const { InMemoryPanelStore } = await import('../src/store/panelStore.js');
const { InstagramAdapter } = await import('../src/platforms/instagram/instagramAdapter.js');

const PUERTO = Number(process.env.PORT);
const CON_ACTIVIDAD = 'tienda-de-marcela';
const RECIEN_CREADA = 'panaderia-de-jose';

const panel = new InMemoryPanelStore();
const store = new InMemoryConversationStore();
const adapters = new Map([['instagram', new InstagramAdapter()]]);
const engine = new FlowEngine(
  store,
  adapters,
  undefined,
  undefined,
  CON_ACTIVIDAD,
  new StoreFunnelRecorder(panel),
  undefined,
  new FuentePanelPrimero(panel),
);

// ── Datos de ejemplo, verosimiles ─────────────────────────────────────────
await panel.saveCampaign({
  accountId: CON_ACTIVIDAD,
  keyword: 'PLANTILLA',
  url: 'https://ejemplo.com/plantilla-de-precios.pdf',
  message: 'Aquí tienes tu plantilla 🎁',
  requireFollow: true,
});

const hora = 60 * 60 * 1000;
const ahora = Date.now();
const gente = ['ig-ana', 'ig-carlos', 'ig-lucia', 'ig-pedro', 'ig-sofia'];
let cuando = ahora - 30 * hora;
for (const [i, persona] of gente.entries()) {
  cuando += 3 * hora;
  await panel.recordEvent({
    accountId: CON_ACTIVIDAD,
    platformUserId: persona,
    type: 'comment_detected',
    at: cuando,
    dedupeKey: `demo:comment:${persona}`,
  });
  await panel.recordEvent({
    accountId: CON_ACTIVIDAD,
    platformUserId: persona,
    type: 'dm_sent',
    at: cuando + 2000,
    dedupeKey: `demo:dm:${persona}`,
  });
  // Tres reciben; una se queda esperando por no seguir; otra ni toca el boton.
  if (i < 3) {
    await panel.recordEvent({
      accountId: CON_ACTIVIDAD,
      platformUserId: persona,
      type: 'resource_delivered',
      at: cuando + 60_000,
      dedupeKey: `demo:entrega:${persona}`,
    });
  } else if (i === 3) {
    await panel.recordEvent({
      accountId: CON_ACTIVIDAD,
      platformUserId: persona,
      type: 'blocked_not_following',
      at: cuando + 30_000,
      dedupeKey: `demo:bloqueo:${persona}`,
    });
  }
}

const conActividad = await panel.createInvite({
  accountId: CON_ACTIVIDAD,
  role: 'owner',
  ttlMs: 8 * hora,
  label: 'Demo con actividad',
});
const recienCreada = await panel.createInvite({
  accountId: RECIEN_CREADA,
  role: 'owner',
  ttlMs: 8 * hora,
  label: 'Demo primer dia',
});

createApp(engine, adapters, store, panel, CON_ACTIVIDAD).listen(PUERTO, () => {
  const base = `http://localhost:${PUERTO}`;
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('  PANEL DE DEMOSTRACIÓN — datos falsos, todo en memoria');
  console.log('─────────────────────────────────────────────────────────────\n');
  console.log('  Cliente CON actividad (Marcela, 5 personas comentaron):');
  console.log(`  ${base}/panel/entrar?t=${conActividad.token}\n`);
  console.log('  Cuenta RECIÉN creada (así se ve el primer día):');
  console.log(`  ${base}/panel/entrar?t=${recienCreada.token}\n`);
  console.log('  Cada enlace sirve UNA vez: si lo recargas, reinicia esto.');
  console.log('  Para cerrar: Ctrl+C\n');
});
