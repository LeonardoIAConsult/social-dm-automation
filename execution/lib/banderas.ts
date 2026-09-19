/**
 * Banderas de las herramientas de linea de comandos. Vive aparte del script
 * para poder probarlo: importar `diagnostico_inbox.ts` ejecutaria su conexion a
 * la base nada mas cargarlo.
 */

/**
 * El borrado de la bandeja exige DOS interruptores. `DELETE FROM conversations`
 * no se lleva solo el historial: tambien las marcas `delivered:*`, que son lo
 * unico que impide re-enviarle el DM a alguien que ya lo recibio. Correrlo
 * contra la base de produccion por tener exportada la DATABASE_URL equivocada
 * significa re-DM masivo, o sea riesgo de bloqueo en Meta.
 */
export function debeBorrar(argv: readonly string[]): boolean {
  return argv.includes('--limpiar') && argv.includes('--si-de-verdad');
}
