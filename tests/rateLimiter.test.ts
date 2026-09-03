import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowRateLimiter, NoopRateLimiter } from '../src/core/rateLimiter.js';

test('permite hasta el tope y luego rechaza', () => {
  const rl = new SlidingWindowRateLimiter(3, 1000);
  assert.equal(rl.tryAcquire('ig', 0), true);
  assert.equal(rl.tryAcquire('ig', 1), true);
  assert.equal(rl.tryAcquire('ig', 2), true);
  assert.equal(rl.tryAcquire('ig', 3), false, 'el 4to dentro de la ventana se rechaza');
});

test('la ventana desliza: libera cupo al pasar windowMs', () => {
  const rl = new SlidingWindowRateLimiter(2, 1000);
  assert.equal(rl.tryAcquire('ig', 0), true);
  assert.equal(rl.tryAcquire('ig', 500), true);
  assert.equal(rl.tryAcquire('ig', 900), false, 'lleno dentro de la ventana');
  // t=1001 ya expiro el evento de t=0 -> hay cupo de nuevo.
  assert.equal(rl.tryAcquire('ig', 1001), true);
});

test('las claves son independientes (por cuenta/plataforma)', () => {
  const rl = new SlidingWindowRateLimiter(1, 1000);
  assert.equal(rl.tryAcquire('ig', 0), true);
  assert.equal(rl.tryAcquire('ig', 0), false, 'ig lleno');
  assert.equal(rl.tryAcquire('fb', 0), true, 'fb tiene su propio cupo');
});

test('max <= 0 deshabilita el limite', () => {
  const rl = new SlidingWindowRateLimiter(0, 1000);
  for (let i = 0; i < 100; i++) assert.equal(rl.tryAcquire('ig', i), true);
});

test('NoopRateLimiter nunca limita', () => {
  const rl = new NoopRateLimiter();
  for (let i = 0; i < 100; i++) assert.equal(rl.tryAcquire('ig'), true);
});
