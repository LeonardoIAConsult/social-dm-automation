import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDateFolderName } from '../src/integrations/googleDrive.js';

test('toDateFolderName formatea epoch a YYYY-MM-DD', () => {
  // 2026-07-09 12:00 local
  const ms = new Date(2026, 6, 9, 12, 0, 0).getTime();
  assert.equal(toDateFolderName(ms), '2026-07-09');
});

test('toDateFolderName rellena con ceros', () => {
  const ms = new Date(2026, 0, 3, 8, 5, 0).getTime();
  assert.equal(toDateFolderName(ms), '2026-01-03');
});
