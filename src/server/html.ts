/**
 * Escape de HTML, UNO solo para todo el servidor.
 *
 * Antes habia dos: el de la bandeja escapaba comillas simples y el del panel no.
 * Esa divergencia es una bomba de tiempo: en cuanto alguien mete un valor de la
 * base dentro de un atributo con comillas simples, la version incompleta deja
 * escapar el atributo. Una sola funcion, que cubre los dos contextos.
 */
export function esc(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}
