import { logger } from '../utils/logger.js';
import type { RateLimiter } from './rateLimiter.js';
import type { OutgoingMessage, Platform, PlatformAdapter } from './types.js';

/**
 * Cola de envios con worker in-process (gap #2 vs openreply, right-sized).
 *
 * openreply usa BullMQ + Redis + un proceso worker aparte. Para este servicio
 * (single-tenant, volumen bajo, 1 servicio en Render) eso seria sobre-ingenieria:
 * aqui el worker vive en el mismo proceso, sin Redis ni 2do proceso. Aporta lo
 * valioso del gap:
 *   - Desacople: el webhook encola y responde rapido (no espera al envio).
 *   - Reintentos con backoff ante fallos transitorios (429/5xx/red) en vez de
 *     perder el DM.
 *   - Requeue al toparse el rate-limit (espera y reintenta) en vez de descartar.
 *
 * Es OPT-IN (env SEND_QUEUE_ENABLED). Apagado -> el engine envia sincrono como
 * siempre. Limitacion consciente: la cola es en memoria (los jobs pendientes se
 * pierden si el proceso reinicia); hacerla durable (respaldada en el store)
 * seria el siguiente paso si el volumen lo pide.
 */
export interface SendJob {
  platform: Platform;
  userId: string;
  message: OutgoingMessage;
}

export interface SendQueue {
  enqueue(job: SendJob): void;
}

export interface SendQueueOptions {
  /** Intentos totales por job antes de rendirse (incluye el primero). Default 4. */
  maxAttempts?: number;
  /** Backoff base en ms (crece 2^n). Default 1000. */
  baseDelayMs?: number;
  /** Espera al toparse el rate-limit antes de reintentar. Default 60000 (1 min). */
  rateDelayMs?: number;
  /** Planificador (inyectable para tests). Default setTimeout unref. */
  schedule?: (fn: () => void, ms: number) => void;
}

/**
 * Decide si un error de envio amerita reintento. El cliente lanza
 * `Error("Graph API <status>: ...")`. Reintentamos en 429 (rate-limit de Meta) y
 * 5xx (error del servidor); NO en 4xx (error de negocio, ej. fuera de ventana).
 * Sin status parseable (timeout/error de red del fetch) -> reintentable.
 */
export function isRetryableSendError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/Graph API (\d{3})/);
  if (m) {
    const status = Number(m[1]);
    return status === 429 || status >= 500;
  }
  return true;
}

const defaultSchedule = (fn: () => void, ms: number): void => {
  const t = setTimeout(fn, ms);
  // No mantener vivo el proceso solo por un reintento pendiente.
  if (typeof t.unref === 'function') t.unref();
};

export class InProcessSendQueue implements SendQueue {
  private readonly queue: Array<SendJob & { attempts: number }> = [];
  private draining = false;
  private settledPromise: Promise<void> = Promise.resolve();

  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly rateDelayMs: number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(
    private readonly adapters: Map<string, PlatformAdapter>,
    private readonly rateLimiter: RateLimiter,
    opts: SendQueueOptions = {},
  ) {
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.rateDelayMs = opts.rateDelayMs ?? 60_000;
    this.schedule = opts.schedule ?? defaultSchedule;
  }

  enqueue(job: SendJob): void {
    this.queue.push({ ...job, attempts: 0 });
    this.kick();
  }

  /**
   * Espera a que la cola quede vacia. Util SOLO para tests con `schedule`
   * sincrono (inmediato): ahi los reintentos corren dentro del mismo drain y
   * settled() los cubre. Con el `schedule` real (setTimeout) los reintentos
   * diferidos ocurren despues -> settled() puede resolver antes; en produccion
   * la cola es fire-and-forget y nadie la llama.
   */
  async settled(): Promise<void> {
    await this.settledPromise;
  }

  private kick(): void {
    if (this.draining) return;
    this.settledPromise = this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        if (job) await this.attempt(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async attempt(job: SendJob & { attempts: number }): Promise<void> {
    // Rate-limit: si topa, NO se pierde el DM -> se re-encola con espera.
    if (!this.rateLimiter.tryAcquire(job.platform)) {
      logger.debug({ userId: job.userId }, 'Rate-limit: envio re-encolado');
      this.requeue(job, this.rateDelayMs);
      return;
    }

    const adapter = this.adapters.get(job.platform);
    if (!adapter) {
      logger.error({ platform: job.platform }, 'Sin adaptador: se descarta el envio');
      return;
    }

    try {
      await adapter.sendMessage(job.userId, job.message);
    } catch (err) {
      const attempts = job.attempts + 1;
      if (isRetryableSendError(err) && attempts < this.maxAttempts) {
        logger.warn({ userId: job.userId, attempts, err }, 'Envio fallo, reintentando');
        this.requeue({ ...job, attempts }, this.backoff(attempts));
      } else {
        logger.error(
          { userId: job.userId, attempts, err },
          'Envio descartado (intentos agotados o error no reintentable)',
        );
      }
    }
  }

  private requeue(job: SendJob & { attempts: number }, delayMs: number): void {
    this.schedule(() => {
      this.queue.push(job);
      this.kick();
    }, delayMs);
  }

  /** Backoff exponencial: base * 2^(attempt-1). */
  private backoff(attempt: number): number {
    return this.baseDelayMs * 2 ** (attempt - 1);
  }
}
