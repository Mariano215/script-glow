// Built-in voices end to end in the packed app, with the real model: download the files (or reuse
// them), then make a scene with a US and a UK voice and print the time per line. Build first with
// npm run dist:dir. The files come from the kokoro-assets-v1 release, or, before it is published,
// from a folder made in Task 4: KOKORO_LOCAL_FILES="$KOKORO_FILES" node verification/kokoro-desktop.mjs
// SCRIPT_GLOW_TEST_HOME keeps the downloaded files between runs (CI caches that folder).
// While server/kokoro/release-gate.json is false, set SCRIPT_GLOW_EXPERIMENTAL_KOKORO=1 so the app offers them.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';

const candidates = process.platform === 'win32'
  ? ['release/win-unpacked/Script Glow.exe']
  : ['release/mac-arm64/Script Glow.app/Contents/MacOS/Script Glow', 'release/mac/Script Glow.app/Contents/MacOS/Script Glow'];
const executablePath = candidates.find(file => existsSync(file));
assert.ok(executablePath, 'No packed app found. Run: npm run dist:dir');
const home = process.env.SCRIPT_GLOW_TEST_HOME || mkdtempSync(path.join(os.tmpdir(), 'script-glow-kokoro-desktop-'));
const models = path.join(home, 'models', 'kokoro-v1');
if (process.env.KOKORO_LOCAL_FILES && !existsSync(models)) { mkdirSync(path.dirname(models), { recursive: true }); cpSync(process.env.KOKORO_LOCAL_FILES, models, { recursive: true }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = { 'Content-Type': 'application/json' };
const app = await electron.launch({ executablePath, env: { ...process.env, SCRIPT_GLOW_HOME: home } });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  const base = new URL(page.url()).origin;
  // Requests from here carry no Origin header, so they need no session, like any local tool.
  const call = async (route, options) => {
    const response = await fetch(base + route, options);
    const body = await response.json();
    assert.ok(response.ok, `${route}: ${body.error}`);
    return body;
  };
  await call('/api/connections', { method: 'PUT', headers: json, body: JSON.stringify({ ...DEFAULT_CONNECTIONS, voice: { engine: 'kokoro', model: '' } }) });
  await call('/api/kokoro/download', { method: 'POST', headers: json, body: '{}' });
  const downloadStarted = Date.now();
  let files;
  for (;;) {
    files = await call('/api/kokoro');
    if (files.ready || files.status === 'error') break;
    assert.ok(Date.now() - downloadStarted < 20 * 60000, 'The download took more than 20 minutes');
    await pause(2000);
  }
  assert.equal(files.ready, true, files.error);
  console.log(`Files ready after ${((Date.now() - downloadStarted) / 1000).toFixed(0)} s.`);

  const lines = [
    ['MARCUS', "I'd've told you, if you'd asked."], ['ELENA', 'Tomorrow, and tomorrow, and tomorrow.'],
    ['MARCUS', 'Meet me at 3:15, not a minute later.'], ['ELENA', 'Wait... did you hear that?'],
    ['MARCUS', 'We\'re gonna need a bigger boat.'], ['ELENA', 'Hmm. Maybe. We\'ll see.'],
  ].map(([character, text], i) => ({ id: `l${i}`, character, text, kind: 'dialogue' }));
  const body = { scene: { id: 'e2e', title: 'End to end', lines }, voices: { MARCUS: 'kokoro:am_michael', ELENA: 'kokoro:bf_emma' }, myCharacter: 'MARCUS', gapSeconds: 0.2, includeDirections: false };
  const renderStarted = Date.now();
  const { jobId } = await call('/api/render', { method: 'POST', headers: json, body: JSON.stringify(body) });
  let job;
  for (;;) {
    job = await call(`/api/jobs/${jobId}`);
    if (['complete', 'error'].includes(job.status)) break;
    await pause(250);
  }
  assert.equal(job.status, 'complete', job.error);
  const seconds = (Date.now() - renderStarted) / 1000;
  assert.ok(job.result.duration > lines.length * 0.5, `Every line has real audio (${job.result.duration} s in all)`);
  const wav = Buffer.from(await (await fetch(base + job.result.fullUrl)).arrayBuffer());
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  console.log(`PASS: built-in voices in the packed app. ${lines.length} lines in ${seconds.toFixed(1)} s, ${(seconds / lines.length).toFixed(2)} s per line (the first line includes loading the model).`);
} finally {
  await app.close();
  if (!process.env.SCRIPT_GLOW_TEST_HOME) rmSync(home, { recursive: true, force: true });
}
