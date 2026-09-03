/**
 * Limitador de envios (gap #3 vs openreply). Meta banea si mandas demasiados
 * mensajes por hora; el diseno compliant exige quedarse por debajo del tope.
 *
 * Backstop, NO gestor de throughput: con volumen bajo single-tenant casi nunca
 * se toca. Si se alcanza el tope, el envio se OMITE (no se encola) — encolar +
 * reintentar es el gap #2 (diferido). Ventana deslizante en RAM, sin deps.
 */
export interface RateLimiter {
  /** Intenta registrar un envio para `key`. true = permitido; false = tope alcanzado. */
  tryAcquire(key: string, now?: number): boolean;
}

/**
 * Ventana deslizante: como maximo `max` eventos por `windowMs`, por clave
 * (una clave por cuenta/plataforma). `max <= 0` deshabilita el limite.
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  tryAcquire(key: string, now = Date.now()): boolean {
    if (this.max <= 0) return true; // deshabilitado
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent); // guarda la poda aunque rechacemos
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/** Nunca limita. Para tests y dry-run donde el tope no aplica. */
export class NoopRateLimiter implements RateLimiter {
  tryAcquire(): boolean {
    return true;
  }
}

/** Ventana estandar del tope por hora de Meta. */
export const RATE_WINDOW_MS = 60 * 60 * 1000;
