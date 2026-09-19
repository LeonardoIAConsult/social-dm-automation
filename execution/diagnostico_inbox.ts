/**
 * Dice QUE paso con una conversacion, leyendo el estado real de la base.
 *
 * Cuando un comentario llega pero no sale respuesta, hay dos culpables posibles
 * y se distinguen mirando el estado guardado:
 *
 *  - No hay `matchedKeyword`  -> la palabra NO hizo match. El problema esta en la
 *    hoja de recursos (no esta la palabra, o la hoja no se pudo leer).
 *  - Hay `matchedKeyword` pero ningun mensaje 'out' -> el match funciono y el
 *    ENVIO fallo. Casi siempre son permisos de Meta (acceso estandar: la app
 *    solo puede escribirle a cuentas con rol en la app).
 *
 * Uso:
 *   DATABASE_URL='postgresql://...' npx tsx execution/diagnostico_inbox.ts
 *   DATABASE_URL='...' npx tsx execution/diagnostico_inbox.ts --limpiar --si-de-verdad
 *
 * `--limpiar` (mas `--si-de-verdad`) borra TODAS las conversaciones, para que una
 * grabacion empiece con
 * la bandeja vacia. Solo borra conversaciones; no toca campanas ni sesiones.
 */
import pg from 'pg';
import { PostgresConversationStore } from '../src/store/conversationStore.js';
import { debeBorrar } from './lib/banderas.js';

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}
const limpiar = process.argv.includes('--limpiar');
const deVerdad = debeBorrar(process.argv);

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
const store = new PostgresConversationStore(pool);

try {
  const conversaciones = await store.list();
  console.log(`\nConversaciones guardadas: ${conversaciones.length}\n`);

  for (const c of conversaciones) {
    const entrantes = c.messages.filter((m) => m.dir === 'in');
    const salientes = c.messages.filter((m) => m.dir === 'out');
    const palabra = c.data.matchedKeyword;
    const entregas = Object.keys(c.data).filter((k) => k.startsWith('delivered:'));

    console.log(`── ${c.username ? '@' + c.username : c.userId} (cuenta ${c.accountId ?? 'default'})`);
    console.log(`   recibidos: ${entrantes.length}  ·  enviados: ${salientes.length}`);
    console.log(`   palabra detectada: ${palabra ?? '(ninguna)'}`);
    console.log(`   paso del flujo: ${c.step ?? '(sin empezar)'}  ·  campana: ${c.activeFlow ?? '(ninguna)'}`);
    console.log(`   entregas marcadas: ${entregas.length ? entregas.join(', ') : 'ninguna'}`);
    console.log(`   sigue la cuenta: ${c.followCache ? String(c.followCache.isFollower) : '(no se consulto)'}`);
    for (const m of c.messages) {
      const flecha = m.dir === 'in' ? '←' : '→';
      console.log(`     ${flecha} [${m.kind}] ${(m.text ?? '').slice(0, 70)}`);
    }

    console.log('   VEREDICTO:');
    if (!palabra) {
      console.log('     La palabra NO hizo match. Revisa la hoja de recursos:');
      console.log('     que la palabra este ahi y que la hoja siga publicada como CSV.');
    } else if (salientes.length === 0) {
      console.log('     La palabra SI hizo match y el envio fallo.');
      console.log('     Causa mas probable: permisos de Meta (acceso estandar).');
      console.log('     Confirma que esa cuenta figure como evaluador de Instagram');
      console.log('     en Roles de la app Y que haya ACEPTADO la invitacion.');
    } else {
      console.log('     El flujo corrio: hubo match y salio respuesta.');
    }
    console.log('');
  }

  if (limpiar && !deVerdad) {
    console.log('NO se borro nada.');
    console.log('  --limpiar borra TODAS las conversaciones de la base a la que apunta');
    console.log('  DATABASE_URL, incluidas las marcas de "ya entregado" que evitan');
    console.log('  re-enviarle el DM a quien ya lo recibio.');
    console.log('  Comprueba a que base apuntas y repite con:  --limpiar --si-de-verdad\n');
  } else if (limpiar) {
    const { rowCount } = await pool.query('DELETE FROM conversations');
    console.log(`Limpieza: ${rowCount ?? 0} conversaciones borradas. La bandeja queda vacia.\n`);
  } else if (conversaciones.length > 0) {
    console.log('Para vaciar la bandeja antes de grabar, repite con  --limpiar\n');
  }
} finally {
  await pool.end();
}
