import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// What ships: every installed package that is not only a development tool. package-lock.json
// records each package's license, so no network and no node_modules walk is needed.
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const shipped = Object.entries(lock.packages).filter(([where, entry]) => where.startsWith('node_modules/') && !entry.dev);
const nameOf = where => where.slice(where.lastIndexOf('node_modules/') + 'node_modules/'.length);

test('nothing that ships is GPL, LGPL or AGPL', () => {
  const copyleft = shipped.filter(([, entry]) => /GPL/i.test(String(entry.license ?? ''))).map(([where, entry]) => `${nameOf(where)} (${entry.license})`);
  assert.deepEqual(copyleft, []);
});

// phonemizer says Apache-2.0 in its package.json but bundles espeak-ng (GPL-3.0), so a license
// field check alone would not catch it. kokoro-js imports it.
test('espeak-ng, kokoro-js and the LGPL sharp image library are not installed', () => {
  const names = shipped.map(([where]) => nameOf(where));
  assert.deepEqual(names.filter(name => ['phonemizer', 'kokoro-js', 'espeak-ng'].includes(name) || name.startsWith('@img/sharp-libvips')), []);
});

test('sharp is the empty stub in stubs/sharp', () => {
  // npm 12 writes this override's "resolved" path relative to the dependent that pulled sharp
  // in (@huggingface/transformers), not to the repo root, so it ends in "stubs/sharp" rather
  // than equaling it exactly. link: true plus that suffix still proves it is our local stub,
  // not a real installed sharp package.
  assert.equal(lock.packages['node_modules/sharp']?.link, true);
  assert.match(String(lock.packages['node_modules/sharp']?.resolved), /stubs\/sharp$/);
});
