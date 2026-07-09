import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInstagramWebhook } from '../src/platforms/instagram/webhookParser.js';
import { matchCampaign } from '../src/core/campaigns.js';

test('parsea un DM de texto entrante', () => {
  const body = {
    object: 'instagram',
    entry: [
      {
        id: '123',
        time: 1700000000000,
        messaging: [
          { sender: { id: 'USER1' }, recipient: { id: '123' }, timestamp: 1700000000001, message: { mid: 'm1', text: 'GUIA' } },
        ],
      },
    ],
  };
  const events = parseInstagramWebhook(body);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'message');
  assert.equal(events[0]?.user.id, 'USER1');
  assert.equal(events[0]?.text, 'GUIA');
});

test('ignora echoes de la propia cuenta', () => {
  const body = {
    object: 'instagram',
    entry: [
      { id: '123', messaging: [{ sender: { id: '123' }, message: { text: 'hola', is_echo: true } }] },
    ],
  };
  assert.equal(parseInstagramWebhook(body).length, 0);
});

test('convierte quick_reply en postback', () => {
  const body = {
    object: 'instagram',
    entry: [
      { id: '123', messaging: [{ sender: { id: 'U' }, message: { text: 'x', quick_reply: { payload: 'CHECK_FOLLOW:freebie-guia' } } }] },
    ],
  };
  const events = parseInstagramWebhook(body);
  assert.equal(events[0]?.type, 'postback');
  assert.equal(events[0]?.payload, 'CHECK_FOLLOW:freebie-guia');
});

test('parsea un comentario con keyword', () => {
  const body = {
    object: 'instagram',
    entry: [
      {
        id: '123',
        time: 1700000000000,
        changes: [
          { field: 'comments', value: { id: 'C1', text: 'quiero la GUIA', from: { id: 'U2', username: 'juan' }, media: { id: 'MEDIA1' } } },
        ],
      },
    ],
  };
  const events = parseInstagramWebhook(body);
  assert.equal(events[0]?.type, 'comment');
  assert.equal(events[0]?.commentId, 'C1');
  assert.equal(events[0]?.mediaId, 'MEDIA1');
});

test('matchCampaign encuentra la campana por keyword', () => {
  const c = matchCampaign('comment', 'dame la GUIA porfa', undefined);
  assert.equal(c?.name, 'freebie-guia');
});

test('matchCampaign no matchea sin keyword', () => {
  const c = matchCampaign('comment', 'hola lindo post', undefined);
  assert.equal(c, undefined);
});
