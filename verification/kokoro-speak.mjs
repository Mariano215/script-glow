// Speaks three lines with the real worker and model files, in US and UK voices, and saves them as
// WAV files to listen to. Run it with the hook, which fails the run if espeak-ng is ever loaded:
//   NODE_OPTIONS="--import ./verification/no-espeak-hook.mjs" node verification/kokoro-speak.mjs <models>/kokoro-v1
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeWav, SAMPLE_RATE } from '../server/audio.js';
import { createKokoroClient } from '../server/kokoro/client.js';

const dir = process.argv[2];
assert.ok(dir, 'Usage: node verification/kokoro-speak.mjs <models>/kokoro-v1');
const voices = createKokoroClient({ args: [path.resolve(dir)] });
const out = mkdtempSync(path.join(os.tmpdir(), 'script-glow-kokoro-speak-'));
const lines = [['af_heart', "I'd've told you, if you'd asked."], ['bm_george', 'Tomorrow, and tomorrow, and tomorrow.'], ['am_michael', 'Meet me at 3:15, not a minute later.']];
for (const [i, [voice, text]] of lines.entries()) {
  const started = performance.now();
  const pcm = await voices.speak(voice, text);
  const seconds = pcm.length / 2 / SAMPLE_RATE;
  assert.ok(seconds > 0.5 && seconds < 15, `${voice} made ${seconds} s of audio`);
  const file = path.join(out, `${i + 1}-${voice}.wav`);
  writeFileSync(file, encodeWav(pcm));
  console.log(`${voice}: ${seconds.toFixed(2)} s of audio in ${((performance.now() - started) / 1000).toFixed(2)} s, ${file}`);
}
voices.stop();
console.log('PASS: the real worker spoke US and UK voices, and nothing loaded espeak-ng.');
