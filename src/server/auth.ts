import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import type { PanelSession, PanelStore, PanelUser } from '../store/panelStore.js';

/**
 * Sesion del panel.
 *
 * La cookie lleva `<idDeSesion>.<firma>`. La firma se verifica ANTES de tocar la
 * base: una cookie inventada se cae en el HMAC y nunca llega a consultar nada.
 * El id de sesion no dice quien eres; eso lo resuelve la base. Cerrar sesion la
 * borra de verdad, no solo borra la cookie del navegador.
 *
 * Hoy la identidad entra por enlace de invitacion. Cuando Meta verifique el
 * negocio se suma Facebook como segundo proveedor: esta capa no cambia, porque
 * solo le importa QUIEN es la persona, no por donde llego.
 */

export const SESSION_COOKIE = 'inboxpilot_sesion';

/** 30 dias: el cliente entra una o dos veces por semana, no queremos re-loguearlo. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Firma con separacion de dominio: el nombre de la cookie va DENTRO del mensaje,
 * asi una futura cookie firmada con el mismo secreto no es intercambiable con
 * la de sesion.
 *
 * Falla duro si el secreto es debil en vez de confiar en la bandera del panel:
 * `createHmac` acepta una clave vacia sin protestar, y con clave vacia
 * cualquiera se fabrica una cookie valida.
 */
function firmar(valor: string): string {
  const secreto = env.SESSION_SECRET;
  if (secreto.trim().length < 32) {
    throw new Error('SESSION_SECRET ausente o demasiado corto: no se puede firmar la sesion');
  }
  return createHmac('sha256', secreto).update(`${SESSION_COOKIE}:${valor}`).digest('base64url');
}

/** Compara en tiempo constante para no filtrar la firma byte a byte. */
function firmaValida(valor: string, firma: string): boolean {
  const esperada = Buffer.from(firmar(valor));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

export function armarCookie(sessionId: string): string {
  return `${sessionId}.${firmar(sessionId)}`;
}

/** Devuelve el id de sesion si la cookie viene bien firmada. */
export function leerCookieFirmada(valor: string | undefined): string | undefined {
  if (!valor) return undefined;
  const corte = valor.lastIndexOf('.');
  if (corte <= 0) return undefined;
  const id = valor.slice(0, corte);
  const firma = valor.slice(corte + 1);
  return firmaValida(id, firma) ? id : undefined;
}

/**
 * Devuelve TODOS los valores que traiga esa cookie. Un navegador normal manda
 * una; un atacante que controle un subdominio puede anteponer otra con el mismo
 * nombre. Devolverlas todas deja que el llamador se quede con la que tenga firma
 * valida, en vez de que una cookie basura antepuesta deje fuera al cliente.
 */
function leerCookiesDeLaPeticion(req: Request, nombre: string): string[] {
  const crudo = req.header('cookie');
  if (!crudo) return [];
  const valores: string[] = [];
  for (const parte of crudo.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() !== nombre) continue;
    try {
      valores.push(decodeURIComponent(parte.slice(i + 1).trim()));
    } catch {
      // Cookie mal formada (ej. un '%' suelto). decodeURIComponent lanza
      // URIError y, sin este catch, la excepcion sube por un handler async y
      // TUMBA el proceso entero: un solo request anonimo baja tambien el
      // webhook. Se ignora ese valor y se sigue con los demas.
    }
  }
  return valores;
}

export function ponerCookieDeSesion(res: Response, session: PanelSession): void {
  // Secure salvo en desarrollo local. Antes dependia de NODE_ENV === 'production',
  // asi que un preview o un tunel servia la cookie de sesion sin cifrar.
  const segura = env.NODE_ENV !== 'development';
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  res.append(
    'Set-Cookie',
    [
      `${SESSION_COOKIE}=${encodeURIComponent(armarCookie(session.id))}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAge}`,
      segura ? 'Secure' : '',
    ]
      .filter(Boolean)
      .join('; '),
  );
}

export function borrarCookieDeSesion(res: Response): void {
  const segura = env.NODE_ENV !== 'development';
  res.append(
    'Set-Cookie',
    [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', segura ? 'Secure' : '']
      .filter(Boolean)
      .join('; '),
  );
}

/** Quien esta pidiendo esta pantalla, o undefined si nadie valido. */
export async function personaDeLaSesion(
  req: Request,
  panel: PanelStore,
): Promise<{ user: PanelUser; session: PanelSession } | undefined> {
  const id = idDeSesionEntrante(req);
  if (!id) return undefined;
  const session = await panel.getSession(id);
  if (!session) return undefined;
  const user = await panel.getUserById(session.userId);
  return user ? { user, session } : undefined;
}

/** Id de sesion que trae la peticion, si viene bien firmado. */
export function idDeSesionEntrante(req: Request): string | undefined {
  for (const valor of leerCookiesDeLaPeticion(req, SESSION_COOKIE)) {
    const id = leerCookieFirmada(valor);
    if (id) return id;
  }
  return undefined;
}

/** Cierra la sesion de verdad: la borra de la base y limpia la cookie. */
export async function cerrarSesion(
  req: Request,
  res: Response,
  panel: PanelStore,
): Promise<void> {
  const id = idDeSesionEntrante(req);
  if (id) await panel.deleteSession(id);
  borrarCookieDeSesion(res);
}
