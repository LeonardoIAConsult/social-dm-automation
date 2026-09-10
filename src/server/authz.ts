import type { Request } from 'express';
import type { AccountAccess, PanelStore } from '../store/panelStore.js';
import { personaDeLaSesion } from './auth.js';

/**
 * La unica puerta por la que una pantalla del panel obtiene una cuenta.
 *
 * Regla dura: la cuenta se resuelve desde la SESION, nunca desde algo que mande
 * el navegador. Si la peticion pide una cuenta concreta, se comprueba que la
 * persona tenga acceso antes de devolverla; si no lo tiene, se responde como si
 * la cuenta no existiera (404 y no 403: un 403 confirma que existe).
 *
 * Toda ruta nueva del panel pasa por aqui. Si alguna lee un `accountId` del
 * request por su cuenta, es un IDOR esperando a ocurrir.
 */

export interface Permiso {
  userId: string;
  /** Nombre para mostrar de quien entro, si lo hay. */
  nombre?: string;
  /** Cuenta resuelta y autorizada. */
  accountId: string;
  role: AccountAccess['role'];
  /** Todas las cuentas de esa persona (para el selector de Leonardo). */
  todas: AccountAccess[];
}

/** Motivo por el que no se puede servir la pantalla. */
export type Denegado = 'sin-sesion' | 'sin-cuenta';

/**
 * Resuelve la cuenta con la que hay que servir la pantalla.
 *
 * @param cuentaPedida cuenta que la peticion quiere ver (opcional). Se ignora si
 * la persona no tiene acceso a ella.
 */
export async function cuentaDeLaSesion(
  req: Request,
  panel: PanelStore,
  cuentaPedida?: string,
): Promise<Permiso | Denegado> {
  const quien = await personaDeLaSesion(req, panel);
  if (!quien) return 'sin-sesion';

  const todas = await panel.accountsOf(quien.user.id);
  if (todas.length === 0) return 'sin-cuenta';

  if (cuentaPedida) {
    // No basta con que la cuenta aparezca en la lista: se pregunta al almacen,
    // que es la fuente de verdad del permiso.
    const permitida = await panel.hasAccess(quien.user.id, cuentaPedida);
    if (!permitida) return 'sin-cuenta';
    const acceso = todas.find((a) => a.accountId === cuentaPedida);
    return {
      userId: quien.user.id,
      nombre: quien.user.name,
      accountId: cuentaPedida,
      role: acceso?.role ?? 'owner',
      todas,
    };
  }

  const primera = todas[0] as AccountAccess;
  return {
    userId: quien.user.id,
    nombre: quien.user.name,
    accountId: primera.accountId,
    role: primera.role,
    todas,
  };
}
