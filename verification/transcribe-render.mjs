// Optional local WhisperX verification, run after live-render.mjs completes.
import { loadConnections } from '../server/connections.js';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const connections = await loadConnections();

const audio = await readFile(new URL('../artifacts/live-full.wav', import.meta.url));
const form = new FormData();
form.set('file', new Blob([audio], { type: 'audio/wav' }), 'rehearsal.wav');
form.set('model', 'Systran/faster-whisper-large-v3');
form.set('language', 'en');
console.log('Checking generated dialogue with local WhisperX…');
const response = await fetch(`${connections.whisperx.url}/v1/audio/transcriptions`, {
  method: 'POST', body: form, signal: AbortSignal.timeout(180000),
});
assert.ok(response.ok, `WhisperX HTTP ${response.status}`);
const result = await response.json();
assert.equal(typeof result.text, 'string');
const normalized = result.text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ');
assert.ok(normalized.includes('ready to begin'), 'First partner cue recognized');
assert.ok(normalized.includes('take it from the top'), 'actor cue recognized');
assert.ok(normalized.includes('stage is yours'), 'Last partner cue recognized');
await writeFile(new URL('../artifacts/transcription.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(`PASS: ${result.text}`);
