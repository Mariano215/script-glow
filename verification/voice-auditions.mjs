import { loadConnections } from '../server/connections.js';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { decodeWav, encodeWav } from '../server/audio.js';
const connections = await loadConnections();

const { voices } = JSON.parse(await readFile(new URL('../scripts/stock-voices.json', import.meta.url), 'utf8'));
const folder = new URL('../artifacts/voices/', import.meta.url);
await mkdir(folder, { recursive: true });
const text = 'I thought you had already left. Wait! There is something you need to know.';
const results = [];
for (const { id } of voices) {
  console.log(`Generating ${id}…`);
  const response = await fetch(`${connections.chatterbox.url}/v1/tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: id, text }), signal: AbortSignal.timeout(180000),
  });
  assert.ok(response.ok, `${id}: HTTP ${response.status}`);
  const pcm = decodeWav(Buffer.from(await response.arrayBuffer()));
  assert.ok(pcm.some((value) => value !== 0), `${id}: non-silent audio required`);
  const filename = `${id}.wav`;
  await writeFile(new URL(filename, folder), encodeWav(pcm));
  results.push({ id, filename, duration: pcm.length / 48000 });
  console.log(`${id}: ${(pcm.length / 48000).toFixed(2)}s valid generated audio`);
}
await writeFile(new URL('report.json', folder), JSON.stringify({ text, generatedAt: new Date().toISOString(), results }, null, 2));
console.log('PASS: all four stock references generate valid speech WAVs. Audition the saved files to judge delivery.');
