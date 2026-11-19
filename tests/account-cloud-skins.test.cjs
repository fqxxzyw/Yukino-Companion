'use strict';
const test = require('node:test'), assert = require('node:assert/strict');

test('a verified cloud skin remains usable offline without changing local progress thresholds', async () => {
  const {getSkinStatus} = await import('../src/companion/skin-unlocks.mjs');
  const {canUseSkin} = require('../electron/skin-policy.cjs');
  const models = require('../resources/character-models.json').models;
  // V1 is retired once the V2 catalogue ships, so test the cloud entitlement
  // against the same model as a ready runtime asset instead of the hold flag.
  const model02 = {...models.find((item) => item.id === 'yukino-02-v1'), ready: true, hold: false, status: 'ready'};
  const model03 = models.find((item) => item.id === 'yukino-03-v1');
  const state = {
    relationship: {affection: 35, cloudUnlocked: ['beret-v2']},
    usedDates: {version: 1, dates: []},
  };
  assert.equal(getSkinStatus(model02, state).unlocked, true);
  assert.equal(getSkinStatus(model02, state).reason, '账号已确认');
  assert.equal(canUseSkin(model02, state), true);
  assert.equal(getSkinStatus(model03, state).unlocked, false);
  assert.equal(canUseSkin(model03, state), false);
  // A guest or malformed state must not inherit another profile's cloud skins.
  assert.equal(getSkinStatus(model02, {relationship: {affection: 35}, usedDates: {version: 1, dates: []}}).unlocked, false);
  assert.equal(getSkinStatus(model02, {relationship: {affection: 35, cloudUnlocked: ['beret-v2']}, usedDates: {}}).preview, false);
});
