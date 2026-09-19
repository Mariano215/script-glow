import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { encodeWav } from '../server/audio.js';
import { DEFAULT_CONNECTIONS, loadConnections, saveConnections } from '../server/connections.js';

async function fixture(run, serviceFetch) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-settings-'));
  const file = path.join(temp, 'connections.json');
  const app = createApp({ cacheDir: path.join(temp, 'cache'), previewDir: path.join(temp, 'previews'), connectionsFile: file, secretsFile: path.join(temp, 'secrets.json'), serviceFetch: serviceFetch ?? (async () => { throw new Error('no service'); }) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { session } = await (await fetch(`${base}/api/session`)).json();
  const send = (route, body, headers = {}) => fetch(base + route, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base, 'x-script-glow-session': session, ...headers }, body: JSON.stringify(body) });
  try { await run({ base, file, temp, session, send }); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
}

const profile = { ...DEFAULT_CONNECTIONS, name: 'Friend laptop', chatterbox: { url: 'http://127.0.0.1:9000', cacheNamespace: 'friend', legacyCache: false } };

test('a saved profile is written whole, read back, and used for the next call', () => fixture(async ({ base, file, send }) => {
  const saved = await send('/api/connections', profile);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).chatterbox.url, 'http://127.0.0.1:9000');
  assert.equal((await loadConnections(file, true)).name, 'Friend laptop', 'The file on disk is a profile the loader accepts');
  assert.equal((await (await fetch(`${base}/api/connections`)).json()).chatterbox.url, 'http://127.0.0.1:9000', 'The running app answers with the new profile');
}));

test('a profile is refused when it carries credentials, a stray key, or a bad URL, and the old one stays', () => fixture(async ({ file, send }) => {
  await send('/api/connections', profile);
  const before = await readFile(file, 'utf8');
  for (const bad of [
    { ...profile, chatterbox: { ...profile.chatterbox, url: 'http://user:secret@127.0.0.1:9000' } },
    { ...profile, chatterbox: { ...profile.chatterbox, url: 'file:///etc/passwd' } },
    { ...profile, chatterbox: { ...profile.chatterbox, url: 'http://127.0.0.1:9000/?token=abc' } },
    { ...profile, apiKey: 'sk-do-not-store-this' },
    { ...profile, name: '' },
  ]) {
    const refused = await send('/api/connections', bad);
    assert.equal(refused.status, 400, `refused: ${JSON.stringify(bad).slice(0, 60)}`);
  }
  assert.equal(await readFile(file, 'utf8'), before, 'A refused profile leaves the working one untouched');
}));

test('a browser write without this launch\'s secret is refused', () => fixture(async ({ base, send, session }) => {
  const withoutSecret = await fetch(`${base}/api/connections`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(profile) });
  assert.equal(withoutSecret.status, 403);
  const wrongSecret = await send('/api/connections', profile, { 'x-script-glow-session': 'guessed' });
  assert.equal(wrongSecret.status, 403);
  assert.notEqual(session, '');
}));

test('testing a connection lists what is already installed and never asks for speech', () => {
  const calls = [];
  return fixture(async ({ base, session }) => {
    const answer = await fetch(`${base}/api/connections/test`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'x-script-glow-session': session }, body: JSON.stringify(profile) });
    const { results } = await answer.json();
    assert.deepEqual(results.map(item => [item.service, item.ok]), [['chatterbox', true], ['ollama', true], ['whisperx', false]]);
    assert.equal(results[0].detail, '2 voices');
    assert.match(results[1].detail, /2 models installed: gemma, llama/);
    assert.match(results[2].detail, /no such server/);
    assert.equal(calls.some(url => url.includes('/v1/tts')), false, 'Testing never synthesizes speech');
    assert.equal(calls.some(url => url.includes('/api/pull')), false, 'Testing never downloads a model');
  }, async url => {
    calls.push(url);
    if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify(['one', 'two']));
    if (url.endsWith('/api/tags')) return Buffer.from(JSON.stringify({ models: [{ name: 'gemma' }, { name: 'llama' }] }));
    throw new Error('no such server');
  });
});

test('the names check says which model an empty draft would pick automatically', () => {
  const calls = [];
  return fixture(async ({ base, session }) => {
    const answer = await fetch(`${base}/api/connections/test`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'x-script-glow-session': session }, body: JSON.stringify({ ...profile, only: 'names' }) });
    const { results } = await answer.json();
    assert.equal(results.length, 1);
    assert.equal(results[0].service, 'names');
    assert.match(results[0].detail, /^Using gemma \(chosen automatically\)\. 2 models installed: gemma, llama$/);

    // A typed model does not claim to have been chosen automatically.
    const typed = { ...profile, names: { engine: 'ollama', model: 'llama' }, ollama: { ...profile.ollama, model: 'llama' }, only: 'names' };
    const typedAnswer = await fetch(`${base}/api/connections/test`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'x-script-glow-session': session }, body: JSON.stringify(typed) });
    assert.match((await typedAnswer.json()).results[0].detail, /^2 models installed: gemma, llama$/);
  }, async url => {
    calls.push(url);
    if (url.endsWith('/api/tags')) return Buffer.from(JSON.stringify({ models: [{ name: 'gemma' }, { name: 'llama' }] }));
    throw new Error('no such server');
  });
});

test('a half-written profile never replaces a working one', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-atomic-'));
  try {
    const file = path.join(temp, 'connections.json');
    await saveConnections(file, profile);
    await assert.rejects(() => saveConnections(file, { ...profile, name: 'x'.repeat(200) }), /Invalid connection profile/);
    assert.equal((await loadConnections(file, true)).name, 'Friend laptop');
    await writeFile(file, '{ not json');
    await assert.rejects(() => loadConnections(file, true), /invalid JSON/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('a key is stored apart from the profile, owner-only, and never sent back', () => fixture(async ({ base, file, temp, session, send }) => {
  const key = 'sk-test-0123456789abcdef4f2a';
  const saved = await send('/api/secrets/openai', { key });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { provider: 'openai', configured: true, hint: 'sk-…4f2a' });
  const listed = await (await fetch(`${base}/api/secrets`)).text();
  assert.equal(listed.includes(key), false, 'The key is never echoed');
  assert.deepEqual(JSON.parse(listed).secrets.find(item => item.provider === 'openai'), { provider: 'openai', configured: true, hint: 'sk-…4f2a' });
  const secretsFile = path.join(temp, 'secrets.json');
  assert.equal(JSON.parse(await readFile(secretsFile, 'utf8')).openai, key);
  if (process.platform !== 'win32') assert.equal((await stat(secretsFile)).mode & 0o777, 0o600, 'Only the owner can read the key file');
  await assert.rejects(() => readFile(file, 'utf8'), { code: 'ENOENT' }, 'The profile is not touched');
  // Two keys saved at once both survive.
  await Promise.all([send('/api/secrets/gemini', { key: 'AIza-0123456789abcdefghij' }), send('/api/secrets/xai', { key: 'xai-0123456789abcdefghij' })]);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(secretsFile, 'utf8'))).sort(), ['gemini', 'openai', 'xai']);
  for (const [route, body] of [['/api/secrets/openai', { key: 'short' }], ['/api/secrets/openai', { key: 'sk has spaces 0123456789' }], ['/api/secrets/nobody', { key }], ['/api/secrets/__proto__', { key }]])
    assert.equal((await send(route, body)).status, 400, `refused: ${route} ${body.key}`);
  const noSecret = await fetch(`${base}/api/secrets/openai`, { method: 'DELETE', headers: { Origin: base } });
  // A FAL key is "id:secret"; the colon must be accepted.
  assert.equal((await send('/api/secrets/fal', { key: '0a1b2c3d-4e5f-6789-abcd:0123456789abcdef' })).status, 200);
  assert.equal(noSecret.status, 403, 'A browser cannot remove a key without this launch\'s secret');
  const removed = await fetch(`${base}/api/secrets/openai`, { method: 'DELETE', headers: { Origin: base, 'x-script-glow-session': session } });
  assert.deepEqual(await removed.json(), { provider: 'openai', configured: false });
  assert.equal(Object.hasOwn(JSON.parse(await readFile(secretsFile, 'utf8')), 'openai'), false);
}));

test('your own voice is sent to Chatterbox, kept as your sample, chosen for your role, and never replaces another voice', () => {
  const sent = [];
  const tone = seconds => { const pcm = Buffer.alloc(seconds * 24000 * 2); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE((i % 200) - 100, i); return encodeWav(pcm); };
  return fixture(async ({ base, file, temp, session }) => {
    const upload = (name, body, type = 'audio/wav') => fetch(`${base}/api/voices/mine?name=${name}`, { method: 'POST', headers: { 'Content-Type': type, Origin: base, 'x-script-glow-session': session }, body });
    const saved = await upload('MyVoice', tone(8));
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual(await saved.json(), { voice: 'MyVoice', seconds: 8, previewUrl: '/private-voice-preview.wav' });
    assert.equal(sent[0].url, 'http://127.0.0.1:8095/v1/voices/MyVoice?replace=true');
    assert.equal(sent[0].headers['Content-Type'], 'audio/wav');
    assert.equal((await loadConnections(file, true)).casting.preferredActorVoice, 'MyVoice', 'Your role now uses your voice');
    const sample = await fetch(`${base}/private-voice-preview.wav`);
    assert.equal(sample.status, 200, 'Your sample can be played back');
    assert.equal(Buffer.from(await sample.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
    if (process.platform !== 'win32') assert.equal((await stat(path.join(temp, 'previews', 'actor-preview.wav'))).mode & 0o777, 0o600);
    // Recording again under the same name is allowed; taking a stock voice's name is not.
    assert.equal((await upload('MyVoice', tone(6))).status, 200);
    const taken = await upload('Stock-Amber', tone(6));
    assert.equal(taken.status, 409);
    assert.match((await taken.json()).error, /already has a voice named Stock-Amber/);
    // Windows and macOS ignore case in file names, so this would overwrite Stock-Amber.wav.
    assert.equal((await upload('stock-amber', tone(6))).status, 409);
    for (const [name, body, type] of [['MyVoice', tone(2)], ['MyVoice', tone(31)], ['MyVoice', Buffer.from('not audio')], ['../x', tone(8)], ['default', tone(8)], ['MyVoice', tone(8), 'application/json']])
      assert.ok([400, 415].includes((await upload(name, body, type)).status), `refused: ${name} ${body.length} ${type ?? ''}`);
    const outsider = await fetch(`${base}/api/voices/mine?name=MyVoice`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', Origin: base }, body: tone(8) });
    assert.equal(outsider.status, 403, 'A page elsewhere cannot replace your voice');
    assert.equal(sent.length, 2, 'Only the two good recordings reached Chatterbox');
  }, async (url, options = {}) => {
    if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify({ voices: ['default', 'Stock-Amber', ...(sent.length ? ['MyVoice'] : [])] }));
    if (url.includes('/v1/voices/')) { sent.push({ url, headers: options.headers }); return Buffer.from('{}'); }
    throw new Error(`unexpected ${url}`);
  });
});

test('a stored voice server token is sent to Chatterbox, and a refused token says where to fix it', () => {
  const seen = [];
  let accept = true;
  return fixture(async ({ base, send }) => {
    assert.equal((await send('/api/secrets/chatterbox', { key: 'voice-token-0123456789abcdef' })).status, 200);
    assert.equal((await fetch(`${base}/api/voices`)).status, 200);
    assert.equal(seen.at(-1), 'voice-token-0123456789abcdef');
    accept = false;
    const refused = await fetch(`${base}/api/voices`);
    assert.equal(refused.status, 503);
    assert.match((await refused.json()).error, /refused the token/);
    const listed = await (await fetch(`${base}/api/secrets`)).json();
    assert.equal(JSON.stringify(listed).includes('voice-token-0123456789abcdef'), false, 'The token never comes back to the page');
  }, async (url, options = {}) => {
    seen.push(options.headers?.['x-voice-token']);
    if (!accept) throw new Error('Local voice service returned HTTP 401.');
    return Buffer.from(JSON.stringify({ voices: ['default'] }));
  });
});

test('a key pasted into a model field is refused, so it never reaches the shareable profile', () => fixture(async ({ send }) => {
  const saved = await send('/api/connections', { ...profile, names: { engine: 'openai', model: 'sk-proj-0123456789abcdef' } });
  assert.equal(saved.status, 400);
  assert.match((await saved.json()).error, /looks like an API key/);
}));

test('keys saved by an earlier version are moved to the user folder, owner-only, and the old file removed', async () => {
  const { moveOldSecrets } = await import('../server/secrets.js');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-move-'));
  try {
    const from = path.join(temp, 'data', 'secrets.json'), to = path.join(temp, 'home', 'script-glow', 'secrets.json');
    await mkdir(path.dirname(from), { recursive: true });
    await writeFile(from, '{"openai":"sk-test-0123456789abcdef4f2a"}\n');
    assert.equal(await moveOldSecrets(to, from), true);
    assert.equal(JSON.parse(await readFile(to, 'utf8')).openai, 'sk-test-0123456789abcdef4f2a');
    if (process.platform !== 'win32') { assert.equal((await stat(to)).mode & 0o777, 0o600); assert.equal((await stat(path.dirname(to))).mode & 0o777, 0o700, 'The folder is private too'); }
    await assert.rejects(() => stat(from), { code: 'ENOENT' });
    await writeFile(from, '{"openai":"sk-older-0123456789abcdef"}\n');
    assert.equal(await moveOldSecrets(to, from), false, 'An existing key file is never overwritten');
    assert.equal(JSON.parse(await readFile(to, 'utf8')).openai, 'sk-test-0123456789abcdef4f2a');
    assert.ok(await stat(from), 'A different old file is kept, with a warning, so no key is lost');
    await writeFile(from, await readFile(to));
    assert.equal(await moveOldSecrets(to, from), false);
    await assert.rejects(() => stat(from), { code: 'ENOENT' }, 'An old copy identical to the new file is removed');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
