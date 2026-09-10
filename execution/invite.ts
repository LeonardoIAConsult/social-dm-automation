/**
 * Genera el enlace de invitacion al panel para un cliente y lo imprime.
 * Leonardo se lo manda por WhatsApp; el cliente lo toca y queda dentro.
 *
 * El token se muestra UNA sola vez: en la base solo queda su hash. Si se pierde,
 * se genera otro (el viejo sigue valido hasta que venza, o se puede dejar morir).
 *
 * Uso:
 *   DATABASE_URL='postgresql://...' npx tsx execution/invite.ts <accountId> [dias] [etiqueta]
 *
 * Ejemplo:
 *   npx tsx execution/invite.ts default 7 "Marcela - Tienda"
 *
 * Variables: PANEL_BASE_URL (default https://social-dm-automation.onrender.com)
 */
import pg from 'pg';
import { PostgresPanelStore, type PanelStore } from '../src/store/panelStore.js';

const [accountId, diasRaw = '7', label] = process.argv.slice(2);

if (!accountId) {
  console.error('Falta el accountId. Uso: npx tsx execution/invite.ts <accountId> [dias] [etiqueta]');
  process.exit(1);
}

const dias = Number(diasRaw);
if (!Number.isFinite(dias) || dias <= 0 || dias > 90) {
  console.error(`Dias invalidos: "${diasRaw}". Usa un numero entre 1 y 90.`);
  process.exit(1);
}

const base = (process.env.PANEL_BASE_URL || 'https://social-dm-automation.onrender.com').replace(
  /\/+$/,
  '',
);

async function armarAlmacen(): Promise<{ panel: PanelStore; cerrar: () => Promise<void> }> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('Falta DATABASE_URL: sin base, la invitacion no le serviria a nadie.');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
  const panel = new PostgresPanelStore(pool);
  await panel.init();
  return { panel, cerrar: () => pool.end() };
}

async function main() {
  const { panel, cerrar } = await armarAlmacen();
  try {
    const { token, expiresAt } = await panel.createInvite({
      accountId,
      role: 'owner',
      ttlMs: dias * 24 * 60 * 60 * 1000,
      label,
    });

    const enlace = `${base}/panel/entrar?t=${token}`;
    console.log('\nEnlace de invitacion (mandalo por WhatsApp, sirve UNA vez):\n');
    console.log(enlace);
    console.log(`\nCuenta: ${accountId}`);
    if (label) console.log(`Para:   ${label}`);
    console.log(`Vence:  ${new Date(expiresAt).toLocaleString('es-CO')} (${dias} dias)\n`);
  } finally {
    await cerrar();
  }
}

main().catch((err) => {
  console.error('No se pudo crear la invitacion:', err instanceof Error ? err.message : err);
  process.exit(1);
});
