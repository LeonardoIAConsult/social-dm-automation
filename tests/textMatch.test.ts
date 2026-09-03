import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, matchesKeyword } from '../src/core/textMatch.js';

test('normalize quita tildes, mayus y signos', () => {
  assert.equal(normalize('¡Guía!'), 'guia');
  assert.equal(normalize('VER MÁS 👀'), 'ver mas');
});

test('match tolera mayus/minus', () => {
  assert.ok(matchesKeyword('GUIA', 'guia'));
  assert.ok(matchesKeyword('guia', 'GUIA'));
});

test('match tolera tildes en cualquier lado', () => {
  assert.ok(matchesKeyword('quiero la guía', 'GUIA'));
  assert.ok(matchesKeyword('quiero la guia', 'GUÍA'));
});

test('match tolera palabras extra y signos', () => {
  assert.ok(matchesKeyword('hola, dame la GUIA!! porfa', 'guia'));
  assert.ok(matchesKeyword('👉 automatiza ya', 'AUTOMATIZA'));
});

test('match keyword de varias palabras', () => {
  assert.ok(matchesKeyword('quiero VER MAS info', 'ver mas'));
  assert.ok(matchesKeyword('ver más', 'ver mas'));
});

test('no matchea substrings parciales', () => {
  assert.equal(matchesKeyword('guiado por expertos', 'guia'), false);
  assert.equal(matchesKeyword('automatizacion', 'automatiza'), false);
});

test('no matchea si no esta', () => {
  assert.equal(matchesKeyword('bonito post', 'guia'), false);
});
