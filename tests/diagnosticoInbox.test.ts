import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debeBorrar } from '../execution/lib/banderas.js';

/**
 * El borrado de la bandeja apunta a la base que diga DATABASE_URL, que puede
 * ser la de produccion. Una sola bandera era demasiado facil de teclear por
 * error justo antes de grabar.
 */
test('borrar la bandeja exige las dos banderas', () => {
  assert.equal(debeBorrar(['--limpiar']), false, 'una sola bandera no borra');
  assert.equal(debeBorrar(['--si-de-verdad']), false, 'la confirmacion sola tampoco');
  assert.equal(debeBorrar([]), false);
  assert.equal(debeBorrar(['--limpiar', '--si-de-verdad']), true);
});
