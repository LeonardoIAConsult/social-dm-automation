import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InProcessSendQueue, isRetryableSendError } from '../src/core/sendQueue.js';
import { NoopRateLimiter, type RateLimiter } from '../src/core/rateLimiter.js';
import type { OutgoingMessage, PlatformAdapter } from '../src/core/types.js';

/** Scheduler inmediato: corre el reintento ya, sin esperas reales (determinista). */
const immediate = (fn: () => void): void => fn();

/** Adaptador que falla las primeras `failN` veces con `err`, luego enfila OK. */
function adapterFailing(failN: number, err: Error, sent: OutgoingMessage[]): PlatformAdapter {
  let calls = 0;
  return {
    platform: 'instagram',
    verifySignature() {},
    parseWebhook() {
      return [];
    },
    async sendMessage(_userId, message) {
      calls++;
      if (calls <= failN) throw err;
      sent.push(message);
    },
    async isFollower() {
      return true;
    },
  };
}

/** Cuenta cuantas veces se llamo a sendMessage. */
function countingAdapter(counter: { n: number }, err?: Error): PlatformAdapter {
  return {
    platform: 'instagram',
    verifySignature() {},
    parseWebhook() {
      return [];
    },
    async sendMessage() {
      counter.n++;
      if (err) throw err;
    },
    async isFollower() {
      return true;
    },
  };
}

const job = { platform: 'instagram' as const, userId: 'U1', message: { kind: 'text' as const, text: 'hola' } };

test('isRetryableSendError: 429 y 5xx reintentan; 4xx no; red si', () => {
  assert.equal(isRetryableSendError(new Error('Graph API 429: rate')), true);
  assert.equal(isRetryableSendError(new Error('Graph API 500: boom')), true);
  assert.equal(isRetryableSendError(new Error('Graph API 400: bad')), false);
  assert.equal(isRetryableSendError(new Error('Graph API 403: forbidden')), false);
  assert.equal(isRetryableSendError(new Error('fetch failed')), true); // red/timeout
});

test('envio exitoso al primer intento', async () => {
  const sent: OutgoingMessage[] = [];
  const adapters = new Map<string, PlatformAdapter>([['instagram', adapterFailing(0, new Error('x'), sent)]]);
  const q = new InProcessSendQueue(adapters, new NoopRateLimiter(), { schedule: immediate });
  q.enqueue(job);
  await q.settled();
  assert.equal(sent.length, 1);
});

test('reintenta un fallo transitorio y termina enviando', async () => {
  const sent: OutgoingMessage[] = [];
  const adapters = new Map<string, PlatformAdapter>([
    ['instagram', adapterFailing(2, new Error('Graph API 500: boom'), sent)],
  ]);
  const q = new InProcessSendQueue(adapters, new NoopRateLimiter(), {
    schedule: immediate,
    maxAttempts: 4,
  });
  q.enqueue(job);
  await q.settled();
  assert.equal(sent.length, 1, 'termina enviando tras reintentos');
});

test('se rinde tras agotar maxAttempts (no envia)', async () => {
  const counter = { n: 0 };
  const adapters = new Map<string, PlatformAdapter>([
    ['instagram', countingAdapter(counter, new Error('Graph API 503: down'))],
  ]);
  const q = new InProcessSendQueue(adapters, new NoopRateLimiter(), {
    schedule: immediate,
    maxAttempts: 3,
  });
  q.enqueue(job);
  await q.settled();
  assert.equal(counter.n, 3, 'intenta exactamente maxAttempts veces');
});

test('error no reintentable (4xx) se descarta al primer intento', async () => {
  const counter = { n: 0 };
  const adapters = new Map<string, PlatformAdapter>([
    ['instagram', countingAdapter(counter, new Error('Graph API 400: bad'))],
  ]);
  const q = new InProcessSendQueue(adapters, new NoopRateLimiter(), {
    schedule: immediate,
    maxAttempts: 5,
  });
  q.enqueue(job);
  await q.settled();
  assert.equal(counter.n, 1, 'no reintenta un 4xx');
});

test('rate-limit: re-encola en vez de perder el envio', async () => {
  const sent: OutgoingMessage[] = [];
  // Limiter que rechaza la 1a vez y permite despues.
  let first = true;
  const limiter: RateLimiter = {
    tryAcquire() {
      if (first) {
        first = false;
        return false;
      }
      return true;
    },
  };
  const adapters = new Map<string, PlatformAdapter>([['instagram', adapterFailing(0, new Error('x'), sent)]]);
  const q = new InProcessSendQueue(adapters, limiter, { schedule: immediate });
  q.enqueue(job);
  await q.settled();
  assert.equal(sent.length, 1, 'el envio sale tras re-encolarse por rate-limit');
});
