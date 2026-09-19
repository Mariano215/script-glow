// The 20 actor lines through the real word lists and the BART fallback, which must give what the
// spike gave (tests/fixtures/g2p-lines.json). Also prints one line through the UK word lists.
// Usage: node verification/kokoro-g2p.mjs <models>/kokoro-v1/g2p
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadG2P } from '../server/kokoro/g2p.js';

const dir = process.argv[2];
assert.ok(dir, 'Usage: node verification/kokoro-g2p.mjs <folder with us_gold.json and bart_enc_us.onnx>');
const lines = JSON.parse(readFileSync(new URL('../tests/fixtures/g2p-lines.json', import.meta.url), 'utf8'));
const g2p = await loadG2P(dir);
let different = 0;
for (const { text, phonemes } of lines) {
  const got = await g2p(text);
  if (got !== phonemes) { different++; console.log(`DIFFERENT: ${text}\n  spike: ${phonemes}\n  now:   ${got}`); }
}
assert.equal(different, 0, `${different} of ${lines.length} lines differ from the spike`);
console.log('UK:', await (await loadG2P(dir, { british: true }))('Tomorrow, and tomorrow, and tomorrow.'));
console.log(`PASS: all ${lines.length} lines match through the real word lists and the BART fallback.`);
