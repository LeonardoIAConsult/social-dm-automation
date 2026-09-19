import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../../config/env.js';

/**
 * Dos protecciones que la auditoria marco y no eran explotables todavia, pero
 * que se vuelven necesarias en cuanto haya mas de un cliente.
 *
 * 1. **Tope de peticiones.** La prueba en vivo se refresca sola cada pocos
 *    segundos y cada refresco consulta la base. Sin tope, un cliente con varias
 *    pestanas abiertas (o alguien de mala fe) hace trabajar al servidor gratis.
 * 2. **Prueba de origen (CSRF).** Hoy la cookie es `SameSite=Strict`, que ya
 *    impide que otro sitio envie formularios en nombre del cliente. Pero eso
 *    depende del navegador y de que nadie controle un subdominio hermano. Un
 *    campo oculto firmado no depende de nadie.
 */

// ── Tope de peticiones ────────────────────────────────────────────────────

interface Ventana {
  desde: number;
  cuantas: number;
}

/**
 * Contador por clave y ventana de tiempo. En memoria a proposito: con una sola
 * instancia alcanza, y meter la base en el camino de CADA peticion seria pagar
 * mas de lo que se protege.
 */
export class TopeDePeticiones {
  private readonly ventanas = new Map<string, Ventana>();

  constructor(
    private readonly maximo: number,
    private readonly ventanaMs: number,
  ) {}

  /** true = puede seguir. false = se paso. */
  permite(clave: string, ahora = Date.now()): boolean {
    const v = this.ventanas.get(clave);
    if (!v || ahora - v.desde >= this.ventanaMs) {
      this.ventanas.set(clave, { desde: ahora, cuantas: 1 });
      this.podar(ahora);
      return true;
    }
    v.cuantas++;
    return v.cuantas <= this.maximo;
  }

  /** Sin poda, el mapa crece con cada visitante nuevo y no baja nunca. */
  private podar(ahora: number): void {
    if (this.ventanas.size < 5000) return;
    for (const [clave, v] of this.ventanas) {
      if (ahora - v.desde >= this.ventanaMs) this.ventanas.delete(clave);
    }
  }
}

/** Quien pide, para contarlo. La sesion si la hay; si no, la IP. */
export function quienPide(req: Request, sessionId?: string): string {
  if (sessionId) return `s:${sessionId}`;
  const reenviada = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return `ip:${reenviada || req.socket.remoteAddress || 'desconocida'}`;
}

// ── Prueba de origen ──────────────────────────────────────────────────────

/**
 * Token atado a la sesion. No hace falta guardarlo: se recalcula y se compara.
 * Sin sesion no hay token, y no hace falta: la unica ruta sin sesion es el canje
 * de la invitacion, cuyo secreto ES el token del enlace.
 */
export function tokenDeOrigen(sessionId: string): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`origen:${sessionId}`)
    .digest('base64url');
}

export function origenValido(sessionId: string, enviado: unknown): boolean {
  if (typeof enviado !== 'string' || enviado.length === 0) return false;
  const esperado = Buffer.from(tokenDeOrigen(sessionId));
  const recibido = Buffer.from(enviado);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}
