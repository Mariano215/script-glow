import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, kokoroOffered } from '../server/app.js';
import { DEFAULT_CONNECTIONS, validateConnections } from '../server/connections.js';

// Fake model files and the fake worker (tests/fixtures/fake-kokoro-worker.js), so no model runs.
const workerFile = fileURLToPath(new URL('./fixtures/fake-kokoro-worker.js', import.meta.url));
const FILES = { 'kokoro/onnx/model.onnx': Buffer.from('model v1'), 'kokoro/voices/af_heart.bin': Buffer.from('heart'), 'kokoro/voices/bm_george.bin': Buffer.from('george'), 'g2p/us_gold.json': Buffer.from('{}') };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestOf = files => ({ version: 1, tag: 'test', base: 'https://example.invalid/kokoro', files: Object.entries(files).map(([file, bytes]) => ({ path: file, size: bytes.length, sha256: sha(bytes) })) });
const post = (base, route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// The process id the fake worker wrote, for the kokoroServer made last.
let pid;
const alive = worker => { try { process.kill(worker, 0); return true; } catch { return false; } };
async function kokoroServer(t, { downloaded = true, files = FILES, cacheDir, available = true, voice = { engine: 'kokoro', model: '' } } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-kokoro-engine-'));
  const modelsDir = path.join(temp, 'models');
  if (downloaded) for (const [file, bytes] of Object.entries(files)) { await mkdir(path.dirname(path.join(modelsDir, file)), { recursive: true }); await writeFile(path.join(modelsDir, file), bytes); }
  // The download is served from memory, so it works without the internet.
  const kokoroFetch = async url => { const found = Object.entries(files).find(([file]) => url.endsWith(`/${file.replaceAll('/', '--')}`)); return found ? new Response(found[1]) : new Response('missing', { status: 404 }); };
  const server = createApp({ cacheDir: cacheDir ?? path.join(temp, 'cache'), previewDir: path.join(temp, 'previews'), connectionsFile: path.join(temp, 'connections.json'), secretsFile: path.join(temp, 'secrets.json'), modelsDir,
    connections: { ...DEFAULT_CONNECTIONS, voice }, serviceFetch: async url => { throw new Error(`no network in this test: ${url}`); },
    kokoro: { available, manifest: manifestOf(files), fetch: kokoroFetch, workerFile } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  pid = async () => Number(await readFile(path.join(modelsDir, 'worker.pid'), 'utf8'));
  const calls = async () => (await readFile(path.join(modelsDir, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { base, calls };
}
async function render(base, body) {
  const { jobId } = await (await post(base, '/api/render', body)).json();
  for (let i = 0; i < 500; i++) {
    const job = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    if (['complete', 'error'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('The render did not finish');
}
const scene = (lines = [{ id: 'a', character: 'ME', text: 'I have the key.', kind: 'dialogue' }, { id: 'b', character: 'PARTNER', text: 'Then open it.', kind: 'dialogue' }]) =>
  ({ scene: { id: 's1', title: 'Kitchen', lines }, voices: { ME: 'kokoro:af_heart', PARTNER: 'kokoro:bm_george' }, myCharacter: 'ME', gapSeconds: 0, includeDirections: false });

test('built-in voices are local: no key, listed with gender and accent, and checked on this computer', async t => {
  assert.equal(validateConnections({ ...DEFAULT_CONNECTIONS, voice: { engine: 'kokoro', model: '' } }).voice.engine, 'kokoro');
  const { base } = await kokoroServer(t);
  assert.deepEqual((await (await fetch(`${base}/api/health`)).json()).tts, { ok: true, engine: 'kokoro' });
  const { engine, voices, details } = await (await fetch(`${base}/api/voices`)).json();
  assert.equal(engine, 'kokoro');
  assert.deepEqual(voices, ['kokoro:af_heart', 'kokoro:bm_george']);
  assert.deepEqual(details['kokoro:bm_george'], { label: 'George', gender: 'male', accent: 'UK' });
  const checked = await (await post(base, '/api/connections/test', { ...DEFAULT_CONNECTIONS, voice: { engine: 'kokoro', model: '' }, only: 'voice' })).json();
  assert.deepEqual([checked.results[0].ok, checked.results[0].detail], [true, 'Ready. 2 voices on this computer.']);
});

test('a render speaks each line once, reuses the line cache, and speaks the directions ahead like Chatterbox', async t => {
  const { base, calls } = await kokoroServer(t);
  const body = scene();
  body.scene.lines.splice(1, 0, { id: 'd', character: 'Narrator', text: 'She crosses to the door.', kind: 'direction' });
  body.directionVoice = 'kokoro:bm_george';
  const first = await render(base, body);
  assert.equal(first.status, 'complete', first.error);
  assert.equal(first.total, 3, 'The direction is spoken ahead, because it costs nothing');
  assert.deepEqual(await calls(), ['af_heart|I have the key.', 'bm_george|She crosses to the door.', 'bm_george|Then open it.']);
  assert.equal((await render(base, body)).status, 'complete');
  assert.equal((await calls()).length, 3, 'The second render comes from the line cache');
});

test('a new model file never reuses audio made with the old one', async t => {
  const shared = await mkdtemp(path.join(os.tmpdir(), 'script-glow-kokoro-cache-'));
  t.after(() => rm(shared, { recursive: true, force: true }));
  const before = await kokoroServer(t, { cacheDir: shared });
  assert.equal((await render(before.base, scene())).status, 'complete');
  const same = await kokoroServer(t, { cacheDir: shared });
  assert.equal((await render(same.base, scene())).status, 'complete');
  assert.deepEqual(await same.calls(), [], 'The same model reuses the cached lines');
  const updated = await kokoroServer(t, { cacheDir: shared, files: { ...FILES, 'kokoro/onnx/model.onnx': Buffer.from('model v2') } });
  assert.equal((await render(updated.base, scene())).status, 'complete');
  assert.equal((await updated.calls()).length, 2, 'Both lines are made again with the new model');
});

test('without the files a render says so; a download makes them ready, and a render waits for it', async t => {
  const { base, calls } = await kokoroServer(t, { downloaded: false });
  assert.deepEqual((await (await fetch(`${base}/api/kokoro`)).json()).ready, false);
  assert.equal((await (await fetch(`${base}/api/health`)).json()).tts.ok, false);
  const refused = await render(base, scene());
  assert.equal(refused.status, 'error');
  assert.match(refused.error, /Built-in voices are not downloaded/);
  assert.deepEqual(await calls(), []);
  assert.equal((await post(base, '/api/kokoro/download', {})).status, 202);
  const waited = await render(base, scene());
  assert.equal(waited.status, 'complete', waited.error);
  assert.equal((await (await fetch(`${base}/api/kokoro`)).json()).ready, true);
  const worker = await pid();
  const removed = await fetch(`${base}/api/kokoro`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.throws(() => process.kill(worker, 0), { code: 'ESRCH' }, 'The worker has exited before its files are deleted');
  assert.equal((await removed.json()).ready, false);
});

test('switching to another engine stops the built-in voices worker', async t => {
  const { base } = await kokoroServer(t);
  assert.equal((await render(base, scene())).status, 'complete');
  const worker = await pid();
  process.kill(worker, 0);
  const saved = await fetch(`${base}/api/connections`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...DEFAULT_CONNECTIONS, voice: { engine: 'openai', model: '' } }) });
  assert.equal(saved.status, 200);
  for (let i = 0; i < 100 && alive(worker); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(alive(worker), false, 'The worker is stopped once Kokoro is no longer the engine');
});

test('a preview is made on this computer, once', async t => {
  const { base, calls } = await kokoroServer(t);
  const { session } = await (await fetch(`${base}/api/session`)).json();
  const preview = await fetch(`${base}/api/voices/preview?voice=${encodeURIComponent('kokoro:af_heart')}&session=${session}`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /audio\/wav/);
  await fetch(`${base}/api/voices/preview?voice=${encodeURIComponent('kokoro:af_heart')}&session=${session}`);
  assert.deepEqual(await calls(), ['af_heart|Hello. This is how I sound when I read your scene with you.']);
});

test('a long speech reaches the model in pieces short enough for it', async t => {
  const { base, calls } = await kokoroServer(t);
  const speech = Array.from({ length: 20 }, (_, i) => `This is sentence number ${i + 1} of a long speech.`).join(' ');
  const job = await render(base, scene([{ id: 'a', character: 'ME', text: speech, kind: 'dialogue' }]));
  assert.equal(job.status, 'complete', job.error);
  const pieces = (await calls()).map(call => call.split('|')[1]);
  assert.ok(pieces.length >= 3 && pieces.every(piece => piece.length <= 350), pieces.map(piece => piece.length).join(', '));
  assert.equal(pieces.join(' '), speech);
});

test('the release switch: Kokoro is offered only when the gate clears or the experimental flag is set', () => {
  assert.equal(kokoroOffered({ misakiProvenanceCleared: false }, {}), false);
  assert.equal(kokoroOffered({ misakiProvenanceCleared: false }, { SCRIPT_GLOW_EXPERIMENTAL_KOKORO: '1' }), true);
  assert.equal(kokoroOffered({ misakiProvenanceCleared: true }, {}), true);
  assert.equal(kokoroOffered({ misakiProvenanceCleared: 'yes' }, { SCRIPT_GLOW_EXPERIMENTAL_KOKORO: '0' }), false);
});

test('switched on, the page is told Kokoro is available', async t => {
  const { base } = await kokoroServer(t);
  assert.equal((await (await fetch(`${base}/api/connections`)).json()).kokoroAvailable, true);
});

test('switched off, Kokoro is hidden: no routes, no saving it, and a stored profile starts but reports it unavailable', async t => {
  const { base, calls } = await kokoroServer(t, { available: false });
  assert.equal((await (await fetch(`${base}/api/connections`)).json()).kokoroAvailable, false);
  assert.equal((await fetch(`${base}/api/kokoro`)).status, 404);
  assert.equal((await post(base, '/api/kokoro/download', {})).status, 404);
  assert.equal((await fetch(`${base}/api/kokoro`, { method: 'DELETE' })).status, 404);
  assert.deepEqual((await (await fetch(`${base}/api/health`)).json()).tts, { ok: false, engine: 'kokoro' });
  const voices = await fetch(`${base}/api/voices`);
  assert.equal(voices.status, 503);
  assert.match((await voices.json()).error, /Built-in voices are not available/);
  const checked = await (await post(base, '/api/connections/test', { ...DEFAULT_CONNECTIONS, voice: { engine: 'kokoro', model: '' }, only: 'voice' })).json();
  assert.equal(checked.results[0].ok, false);
  const saved = await fetch(`${base}/api/connections`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...DEFAULT_CONNECTIONS, voice: { engine: 'kokoro', model: '' } }) });
  assert.equal(saved.status, 400);
  assert.match((await saved.json()).error, /Built-in voices are not available/);
  const refused = await post(base, '/api/render', scene());
  assert.equal(refused.status, 503);
  assert.match((await refused.json()).error, /Built-in voices are not available/);
  assert.deepEqual(await calls(), []);
});

test('switched off, other engines save as before', async t => {
  const { base } = await kokoroServer(t, { available: false, voice: { engine: 'chatterbox', model: '' } });
  const saved = await fetch(`${base}/api/connections`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...DEFAULT_CONNECTIONS, voice: { engine: 'openai', model: '' } }) });
  assert.equal(saved.status, 200);
});
