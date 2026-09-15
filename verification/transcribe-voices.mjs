import { loadConnections } from '../server/connections.js';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const connections = await loadConnections();

const folder = new URL('../artifacts/voices/', import.meta.url);
const report = JSON.parse(await readFile(new URL('report.json', folder), 'utf8'));
for (const voice of report.results) {
  console.log(`Transcribing ${voice.id}…`);
  const form = new FormData();
  form.set('file', new Blob([await readFile(new URL(voice.filename, folder))], { type: 'audio/wav' }), voice.filename);
  form.set('language', 'en');
  const response = await fetch(`${connections.whisperx.url}/v1/audio/transcriptions`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(180000),
  });
  assert.ok(response.ok, `${voice.id}: WhisperX HTTP ${response.status}`);
  const result = await response.json();
  assert.equal(typeof result.text, 'string');
  const normalized = result.text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ');
  assert.ok(normalized.includes('already left') && normalized.includes('need to know'), `${voice.id}: expected audition words; received ${result.text}`);
  voice.transcript = result.text;
  console.log(`${voice.id}: ${result.text}`);
}
await writeFile(new URL('transcriptions.json', folder), JSON.stringify(report, null, 2));
console.log('PASS: all four stock voice auditions recognized by local WhisperX.');
