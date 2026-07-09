import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeywordFromCaption } from '../src/core/keywordExtractor.js';

test('keyword entre comillas cerca del verbo', () => {
  assert.equal(extractKeywordFromCaption('Comenta "GUIA" y te la envío 🎁'), 'GUIA');
});

test('keyword en mayúsculas tras el verbo', () => {
  assert.equal(extractKeywordFromCaption('Escribe LIBRO en los comentarios'), 'LIBRO');
});

test('patron "la palabra X"', () => {
  assert.equal(extractKeywordFromCaption('comenta la palabra PLANTILLA abajo 👇'), 'PLANTILLA');
});

test('ingles: comment "EBOOK"', () => {
  assert.equal(extractKeywordFromCaption('Comment "EBOOK" below to get it'), 'EBOOK');
});

test('fallback a palabra en mayúsculas', () => {
  assert.equal(extractKeywordFromCaption('Descarga tu RECURSO gratis hoy'), 'RECURSO');
});

test('ignora stopwords en mayúsculas', () => {
  assert.equal(extractKeywordFromCaption('comenta LA palabra MASTERCLASS'), 'MASTERCLASS');
});

test('sin keyword devuelve null', () => {
  assert.equal(extractKeywordFromCaption('que lindo dia hoy en la playa'), null);
});

test('caption vacío devuelve null', () => {
  assert.equal(extractKeywordFromCaption(''), null);
  assert.equal(extractKeywordFromCaption(null), null);
});
