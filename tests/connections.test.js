import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONNECTIONS, loadConnections, validateConnections } from '../server/connections.js';
import { createApp } from '../server/app.js';
import { encodeWav } from '../server/audio.js';

const profile = () => structuredClone(DEFAULT_CONNECTIONS);
const wav = encodeWav(Buffer.alloc(4800));
const input = { scene: { id: 's1', title: 'Room', lines: [{ id: 'a', kind: 'dialogue', character: 'ME', text: 'Hello.' }] }, voices: { ME: 'TestVoice' }, myCharacter: 'ME', gapSeconds: 0, includeDirections: false };
const post = (base, route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function temporary(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'script-glow-connections-'));
  try { await fn(dir); }
  finally {
    assert.equal(path.dirname(dir), os.tmpdir());
    assert.ok(path.basename(dir).startsWith('script-glow-connections-'));
    await rm(dir, { recursive: true, force: true });
  }
}
async function withServer(options, fn) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('the first-run flag is on only for a new install, and a save turns it off', () => temporary(async dir => {
  const connectionsFile = path.join(dir, 'connections.json');
  const options = { connectionsFile, secretsFile: path.join(dir, 'secrets.json'), cacheDir: path.join(dir, 'cache') };
  await withServer(options, async base => {
    assert.equal((await (await fetch(`${base}/api/connections`)).json()).firstRun, false, 'Off unless the app asks for it');
  });
  await withServer({ ...options, firstRunScreen: true }, async base => {
    assert.equal((await (await fetch(`${base}/api/connections`)).json()).firstRun, true);
    const saved = await fetch(`${base}/api/connections`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile()) });
    assert.equal(saved.status, 200);
    assert.equal((await (await fetch(`${base}/api/connections`)).json()).firstRun, false);
  });
}));

async function render(base) {
  const accepted = await post(base, '/api/render', input); assert.equal(accepted.status, 202);
  const { jobId } = await accepted.json();
  for (let i = 0; i < 500; i++) {
    const job = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    if (job.status === 'error') assert.fail(job.error);
    if (job.status === 'complete') return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Render did not complete');
}

test('generic profile has no personal voice/model and validator isolates normalized settings', () => {
  const value = profile(); value.chatterbox.url = 'https://voice.example/proxy///';
  const result = validateConnections(value);
  assert.equal(result.chatterbox.url, 'https://voice.example/proxy');
  assert.equal(result.casting.preferredActorVoice, '');
  assert.deepEqual(result.casting.aliases, {});
  assert.equal(result.ollama.model, '');
  value.chatterbox.url = 'http://changed.example';
  assert.equal(result.chatterbox.url, 'https://voice.example/proxy');
  assert.equal(DEFAULT_CONNECTIONS.casting.preferredActorVoice, '');
  assert.deepEqual(DEFAULT_CONNECTIONS.casting.aliases, {});
});

test('profile rejects secrets, invalid URLs, malformed fields and alias chains', () => {
  for (const mutate of [
    value => { value.apiKey = 'secret'; },
    value => { value.ollama.apiKey = 'secret'; },
    value => { value.version = 2; },
    value => { value.chatterbox.legacyCache = 'true'; },
    value => { value.ollama.model = 42; },
    value => { value.name = 'bad\nname'; },
    value => { value.casting.aliases = { a: 'b', b: 'c' }; },
    value => { value.casting.aliases = { a: 'a' }; },
    value => { value.casting.aliases = []; },
    ...['file:///etc/passwd', 'https://name:secret@example.com', 'https://example.com?token=secret', 'https://example.com#fragment', 'not a URL'].map(url => value => { value.chatterbox.url = url; }),
  ]) { const value = profile(); mutate(value); assert.throws(() => validateConnections(value)); }
  for (const value of [null, [], {}]) assert.throws(() => validateConnections(value));
  const value = profile(); value.casting.aliases = { default: 'ActorVoice' };
  assert.deepEqual(validateConnections(value).casting.aliases, { default: 'ActorVoice' });
});

test('file loader falls back only for optional missing profile, otherwise fails startup', async () => temporary(async dir => {
  const filename = path.join(dir, 'connections.json');
  assert.deepEqual(await loadConnections(filename, false), DEFAULT_CONNECTIONS);
  await assert.rejects(loadConnections(filename, true), /Cannot load/);
  await writeFile(filename, '{'); await assert.rejects(loadConnections(filename, false), /invalid JSON/);
  await writeFile(filename, ' '.repeat(16001)); await assert.rejects(loadConnections(filename), /16 KB/);
  await writeFile(filename, JSON.stringify(profile())); assert.deepEqual(await loadConnections(filename), DEFAULT_CONNECTIONS);
}));

test('configured URLs/model are injected, public profile is read-only and private preview is owner-only', async () => temporary(async dir => {
  const value = profile();
  value.chatterbox.url = 'http://127.0.0.1:19001'; value.whisperx.url = 'http://127.0.0.1:19002';
  value.ollama = { url: 'http://127.0.0.1:19003', model: 'test-model:latest' };
  value.casting = { preferredActorVoice: 'TestVoice', aliases: { default: 'TestVoice' } };
  const previewDir = path.join(dir, 'previews'); await mkdir(previewDir); await writeFile(path.join(previewDir, 'actor-preview.wav'), wav);
  const calls = [];
  const serviceFetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/health')) return Buffer.from('{"status":"ok"}');
    if (url.endsWith('/v1/voices')) return Buffer.from('["TestVoice"]');
    if (url.endsWith('/api/generate')) {
      assert.equal(JSON.parse(options.body).model, value.ollama.model);
      return Buffer.from(JSON.stringify({ done: true, response: JSON.stringify({ guesses: [{ name: 'DAVID', gender: 'male' }] }) }));
    }
    if (url.endsWith('/v1/tts')) return wav;
    assert.fail(`Unexpected service URL ${url}`);
  };
  await withServer({ cacheDir: path.join(dir, 'cache'), connections: value, previewDir, serviceFetch }, async base => {
    const response = await fetch(base + '/api/connections'); assert.equal(response.headers.get('cache-control'), 'no-store');
    const publicProfile = await response.json(); assert.equal(publicProfile.casting.previewUrl, '/private-voice-preview.wav');
    assert.equal(publicProfile.ollama.model, value.ollama.model);
    assert.equal((await post(base, '/api/connections', profile())).status, 404);
    assert.equal((await fetch(base + '/api/connections', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const preview = await fetch(base + publicProfile.casting.previewUrl); assert.equal(preview.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), wav);
    assert.equal((await fetch(base + publicProfile.casting.previewUrl, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.deepEqual(await (await fetch(base + '/api/health')).json(), { tts: { ok: true }, stt: { ok: true } });
    await fetch(base + '/api/voices');
    assert.equal((await post(base, '/api/casting/guess-genders', { names: ['DAVID'] })).status, 200);
    await render(base);
  });
  for (const url of [`${value.chatterbox.url}/health`, `${value.whisperx.url}/health`, `${value.chatterbox.url}/v1/voices`, `${value.chatterbox.url}/v1/tts`, `${value.ollama.url}/api/generate`]) assert.ok(calls.includes(url), url);
  await withServer({ cacheDir: path.join(dir, 'generic-cache'), previewDir, serviceFetch: async () => assert.fail('Unconfigured AI must not call services') }, async base => {
    assert.equal((await fetch(base + '/private-voice-preview.wav')).status, 404);
    assert.equal((await (await fetch(base + '/api/connections')).json()).casting.previewUrl, undefined);
    const inference = await post(base, '/api/casting/guess-genders', { names: ['DAVID'] });
    assert.equal(inference.status, 503); assert.match((await inference.json()).error, /Name guessing is off/);
  });
}));

test('legacy line cache remains byte-compatible while new profiles isolate URL and namespace', async () => temporary(async dir => {
  const cacheDir = path.join(dir, 'cache'); await mkdir(path.join(cacheDir, 'lines'), { recursive: true });
  const oldKey = createHash('sha256').update(JSON.stringify({ version: 1, text: 'Hello.', voice: 'TestVoice' })).digest('hex');
  const oldFile = path.join(cacheDir, 'lines', `${oldKey}.wav`); await writeFile(oldFile, wav);
  let ttsCalls = 0;
  const serviceFetch = async url => {
    if (url.endsWith('/v1/voices')) return Buffer.from('["TestVoice"]');
    ttsCalls++; return wav;
  };
  const value = profile(); value.chatterbox.legacyCache = true;
  await withServer({ cacheDir, connections: value, serviceFetch }, render);
  assert.equal(ttsCalls, 0, 'legacy entry reused');
  value.chatterbox.legacyCache = false;
  await withServer({ cacheDir, connections: value, serviceFetch }, async base => { await render(base); await render(base); });
  assert.equal(ttsCalls, 1, 'new namespace reused only its own entry');
  value.chatterbox.cacheNamespace = 'second-engine';
  await withServer({ cacheDir, connections: value, serviceFetch }, render); assert.equal(ttsCalls, 2);
  value.chatterbox.url = 'http://127.0.0.1:19999';
  await withServer({ cacheDir, connections: value, serviceFetch }, render); assert.equal(ttsCalls, 3);
  assert.equal((await readdir(path.join(cacheDir, 'lines'))).length, 4);
  assert.deepEqual(await readFile(oldFile), wav);
}));
