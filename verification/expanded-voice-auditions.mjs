// Generates only the fixed, non-private audition text. Never copies personal references.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { decodeWav, encodeWav, SAMPLE_RATE } from '../server/audio.js';
import { loadConnections } from '../server/connections.js';

const manifest = JSON.parse(await readFile(new URL('../scripts/expanded-voices.json', import.meta.url), 'utf8'));
const connections = await loadConnections();
const folder = new URL('../public/voice-previews/', import.meta.url);
const artifacts = new URL('../artifacts/expanded-voices/', import.meta.url);
await mkdir(folder, { recursive: true });
await mkdir(artifacts, { recursive: true });
const text = 'I thought you had already left. Wait! There is something you need to know.';
// Public auditions only: never generate a personal actor voice into public assets.
const ids = [...manifest.voices.map(({ id }) => id), 'Stock-Mica', 'Stock-Amber', 'Stock-Granite', 'Stock-Ash'];
const results = [];
const normalize = (value) => value.toLowerCase().replace(/speaker[_\s]*\d+\s*:/g, '').replace(/there['’]s\b/g, 'there is').replace(/[^a-z\s]/g, '').trim().split(/\s+/);
const expected = normalize(text);
function wordDistance(actual) {
  const words = normalize(actual);
  let prior = words.map((_, index) => index + 1);
  prior.unshift(0);
  for (let i = 1; i <= expected.length; i++) {
    const next = [i];
    for (let j = 1; j <= words.length; j++) next[j] = Math.min(next[j - 1] + 1, prior[j] + 1, prior[j - 1] + (expected[i - 1] === words[j - 1] ? 0 : 1));
    prior = next;
  }
  return prior[words.length];
}
async function transcribe(bytes, filename) {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'audio/wav' }), filename);
  form.set('model', 'Systran/faster-whisper-large-v3');
  form.set('language', 'en');
  const response = await fetch(`${connections.whisperx.url}/v1/audio/transcriptions`, { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
  assert.ok(response.ok, `WhisperX HTTP ${response.status}`);
  const result = await response.json();
  assert.equal(typeof result.text, 'string');
  return result.text;
}
for (const id of ids) {
  assert.match(id, /^(Stock-[A-Za-z]+|VoiceZero-[A-Za-z]+)$/);
  const filename = `${id}.wav`;
  const target = new URL(filename, folder);
  let existing;
  try { existing = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let verified = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let bytes = existing;
    const started = performance.now();
    if (!bytes && attempt === 1 && /^Stock-(Mica|Amber|Granite|Ash)$/.test(id)) {
      try { bytes = await readFile(new URL(`../artifacts/voices/${filename}`, import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!bytes) {
      console.log(`Generating ${id} (attempt ${attempt})...`);
      const response = await fetch(`${connections.chatterbox.url}/v1/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: id, text }), signal: AbortSignal.timeout(180000),
      });
      assert.ok(response.ok, `${id}: TTS HTTP ${response.status}`);
      bytes = encodeWav(decodeWav(Buffer.from(await response.arrayBuffer())));
    }
    const pcm = decodeWav(bytes);
    const seconds = pcm.length / 2 / SAMPLE_RATE;
    let power = 0, peak = 0;
    for (let offset = 0; offset < pcm.length; offset += 2) {
      const value = pcm.readInt16LE(offset) / 32768;
      power += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const rms = Math.sqrt(power / (pcm.length / 2));
    assert.ok(seconds >= 2 && seconds <= 20, `${id}: implausible duration ${seconds}`);
    assert.ok(rms > 0.005 && peak > 0.05, `${id}: insufficient audio signal`);
    const transcript = await transcribe(bytes, filename);
    const errors = wordDistance(transcript);
    if (errors > 1) {
      await writeFile(new URL(`${id}-attempt-${attempt}.wav`, artifacts), bytes);
      console.error(`${id}: transcript failed (${errors} word edits): ${transcript}`);
      if (existing) throw new Error(`${id}: existing public preview failed transcript; refusing replacement.`);
      continue;
    }
    if (!existing) await writeFile(target, bytes, { flag: 'wx' });
    results.push({ id, filename, seconds, rms, peak, transcript, wordErrors: errors, sha256: createHash('sha256').update(bytes).digest('hex'), verificationSeconds: (performance.now() - started) / 1000, reused: Boolean(existing) });
    await writeFile(new URL('report.json', artifacts), JSON.stringify({ text, generatedAt: new Date().toISOString(), complete: results.length === ids.length, results }, null, 2));
    console.log(`${id}: PASS ${seconds.toFixed(2)}s, ${errors} word errors; ${transcript}`);
    verified = true;
    break;
  }
  assert.ok(verified, `${id}: intelligibility failed after two attempts`);
}
console.log(`PASS: ${results.length} generated previews decoded with signal and verified by WhisperX. Accent/acting quality still requires human audition.`);
