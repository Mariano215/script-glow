import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightDefaults, readHighlights, highlightedCharacter, safeColor, lineHidden } from '../src/highlights.ts';
import { validatePreferences } from '../server/projects.js';

test('highlight defaults follow the actor; explicit character and Off stay independent', () => {
  assert.deepEqual(readHighlights({}), highlightDefaults);
  assert.equal(highlightedCharacter(highlightDefaults, 'DAVID'), 'DAVID');
  assert.equal(highlightedCharacter({ ...highlightDefaults, highlightCharacter: 'ELIZABETH' }, 'DAVID'), 'ELIZABETH');
  assert.equal(highlightedCharacter({ ...highlightDefaults, highlightCharacter: '' }, 'DAVID'), '');
  assert.equal(safeColor('#12ABEF', '#ffffff'), '#12abef');
  for (const value of ['red', '#abc', 'url(https://bad)', '#000000;display:none', null, {}]) assert.equal(safeColor(value, '#ffffff'), '#ffffff');
});

test('server preserves visual preferences, upgrades old projects, and rejects unsafe colors', () => {
  const legacy = { source: 'SCENE 1\nDAVID: Hello.', name: 'Test', role: 'DAVID', sceneId: 'scene-1', cast: {}, gap: 1, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
  const upgraded = validatePreferences(legacy);
  assert.equal(upgraded.highlightCharacter, '@role');
  assert.equal(upgraded.characterColor, '#60a5fa');
  const chosen = { ...legacy, highlightCharacter: 'ELIZABETH', characterColor: '#22C55E', spokenColor: '#AB12EF' };
  const normalized = validatePreferences(chosen);
  assert.equal(normalized.highlightCharacter, 'ELIZABETH');
  assert.equal(normalized.characterColor, '#22c55e');
  assert.equal(normalized.spokenColor, '#ab12ef');
  assert.equal(normalized.role, 'DAVID');
  assert.throws(() => validatePreferences({ ...legacy, spokenColor: 'red' }), /color/);
  assert.throws(() => validatePreferences({ ...legacy, highlightCharacter: 'x'.repeat(101) }), /character/);
});

test('listen only hides every line; hide my lines hides only the actor; revealing always wins', () => {
  const off = { hide: false, listen: false };
  const mine = { hide: true, listen: false };
  const listen = { hide: false, listen: true };
  assert.equal(lineHidden(off, true, false), false);
  assert.equal(lineHidden(off, false, false), false);
  assert.equal(lineHidden(mine, true, false), true);
  assert.equal(lineHidden(mine, false, false), false);
  assert.equal(lineHidden(listen, true, false), true);
  assert.equal(lineHidden(listen, false, false), true);
  assert.equal(lineHidden({ hide: true, listen: true }, false, false), true);
  for (const preferences of [off, mine, listen]) for (const owned of [true, false]) assert.equal(lineHidden(preferences, owned, true), false);
});
