import { logger } from '../../utils/logger.js';
import type { PanelStore } from '../../store/panelStore.js';
import type { EstadoConexion } from './vista.js';

/**
 * Traduce el estado tecnico de la cuenta a lo unico que el cliente quiere saber:
 * ¿esto esta funcionando?
 *
 * Regla que manda aqui: **nunca decir una palabra tecnica y nunca dejar un
 * problema sin salida.** Si algo esta mal, se dice que pasa en una frase y se
 * pone UN boton. Si no lo podemos saber, se dice que se esta revisando, no se
 * inventa un verde ni se asusta con un rojo.
 */

/** Lo minimo que necesitamos del adaptador. Es opcional: puede no existir. */
export interface ConSalud {
  salud?: () => Promise<{ estado: 'ok' | 'sin-permiso' | 'no-se-pudo'; username?: string }>;
}

export async function armarEstadoDeConexion(
  adapter: ConSalud | undefined,
  panel: PanelStore,
  accountId: string,
  /**
   * Cuenta que el adaptador sabe consultar. Hoy el adaptador usa el token de UNA
   * cuenta: preguntarle por otra devolveria el estado de la primera, y el cliente
   * veria un verde que no es suyo. Si no coincide, se dice "no sabemos".
   */
  cuentaDelAdaptador?: string,
): Promise<EstadoConexion> {
  const entrega = await panel.ultimoEvento(accountId, 'resource_delivered');
  const ultimaEntrega = entrega ? new Date(entrega.at) : undefined;

  if (!adapter?.salud) return { tipo: 'sin-datos' };
  if (cuentaDelAdaptador !== undefined && cuentaDelAdaptador !== accountId) {
    // Mostrar el estado de otra cuenta seria mentirle al cliente. Mejor callar.
    return { tipo: 'sin-datos' };
  }

  let salud: Awaited<ReturnType<NonNullable<ConSalud['salud']>>>;
  try {
    salud = await adapter.salud();
  } catch (err) {
    // La pantalla nunca se cae por esto: si no se pudo preguntar, se dice que
    // se esta revisando.
    logger.warn({ err, accountId }, 'No se pudo consultar la salud de la cuenta');
    return { tipo: 'sin-datos' };
  }

  if (salud.estado === 'ok') {
    return {
      tipo: 'activo',
      cuentaInstagram: salud.username ? `@${salud.username}` : undefined,
      ultimaEntrega,
    };
  }

  if (salud.estado === 'sin-permiso') {
    return {
      tipo: 'atencion',
      quePaso:
        'Se cerró el permiso de tu Instagram y por eso ahora mismo no está respondiendo a nadie.',
      accion: { texto: 'Avisar para que lo reconecten', url: '/panel/reconectar' },
    };
  }

  // 'no-se-pudo': puede ser Instagram lento o nuestra red. No es culpa del
  // cliente y no significa que este roto: no se pinta rojo.
  return { tipo: 'sin-datos' };
}
