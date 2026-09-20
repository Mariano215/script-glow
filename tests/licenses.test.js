import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

// The lockfile cannot show a file that an install script fetched after resolution, and
// onnxruntime-node's does exactly that on Linux x64: 343 MB of NVIDIA GPU providers, under their
// own terms, that Script Glow never asks for and THIRD_PARTY_NOTICES.md does not cover. The
// "allowScripts" block in package.json denies that script, but a node_modules installed before it
// keeps what it already downloaded, and desktop/builder.cjs packs what it finds.
test('no onnxruntime GPU provider that an install script fetched is left in node_modules', () => {
  const runtimes = new URL('../node_modules/onnxruntime-node/bin/napi-v3/', import.meta.url);
  const found = [];
  if (existsSync(runtimes))
    for (const platform of readdirSync(runtimes))
      for (const arch of readdirSync(new URL(`${platform}/`, runtimes)))
        for (const file of readdirSync(new URL(`${platform}/${arch}/`, runtimes)))
          if (/providers_(cuda|tensorrt)/.test(file)) found.push(`${platform}/${arch}/${file}`);
  assert.deepEqual(found, [], 'Install this tree again so the denied script cannot leave them behind: rm -rf node_modules && npm install');
});

// A shipped package with no license field would slip past the copyleft check above, so it fails
// here unless it is named below with the reason.
const NO_LICENSE_FIELD_OK = new Set([
  // The link npm makes for the sharp override: our own empty stub, MIT in stubs/sharp/package.json.
  'node_modules/sharp',
  // npm 12's record of that link's target, written relative to transformers.js. Nothing is installed there.
  'node_modules/@huggingface/transformers/stubs/sharp',
]);
const missingLicense = entries => entries.filter(([where, entry]) => !entry.license && !NO_LICENSE_FIELD_OK.has(where)).map(([where]) => where);

test('every shipped package states a license, apart from the sharp stub', () => {
  assert.deepEqual(missingLicense(shipped), []);
  assert.deepEqual(missingLicense([['node_modules/left-pad', { version: '1.0.0' }], ['node_modules/sharp', { link: true }]]), ['node_modules/left-pad']);
});

test('THIRD_PARTY_NOTICES.md is up to date and covers the voice files and the packages that run them', () => {
  execFileSync(process.execPath, ['scripts/third-party-notices.mjs', '--check'], { cwd: new URL('../', import.meta.url) });
  const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  for (const part of ['Kokoro-82M v1.0', 'Misaki English word lists', 'graphemes_to_phonemes_en_us', '### @huggingface/transformers ', '### onnxruntime-node ', '### number-to-words ', '### express '])
    assert.ok(notices.includes(part), part);
});

test('packages the build leaves out are not listed, and a package with no license file gets the full MIT text', () => {
  const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  assert.ok(!notices.includes('### onnxruntime-web '), 'onnxruntime-web does not ship');
  const ort = notices.slice(notices.indexOf('### onnxruntime-node '), notices.indexOf('###', notices.indexOf('### onnxruntime-node ') + 3));
  for (const part of ['Copyright (c) Microsoft Corporation', 'Permission is hereby granted, free of charge', 'THE SOFTWARE IS PROVIDED "AS IS"', 'onnxruntime-1.21.0-ThirdPartyNotices.txt'])
    assert.ok(ort.includes(part), part);
  assert.match(readFileSync(new URL('../licenses/onnxruntime-1.21.0-ThirdPartyNotices.txt', import.meta.url), 'utf8'), /^THIRD PARTY SOFTWARE NOTICES AND INFORMATION/);
});
