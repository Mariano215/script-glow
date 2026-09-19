import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS, validateConnections } from '../server/connections.js';
import { createSecrets } from '../server/secrets.js';

// A fake of each hosted service. Nothing here reaches the internet.
const pcm = Buffer.alloc(4800); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 1000 - 500, i);
async function hostedServer(engine, run, answer, extra = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-hosted-'));
  const secretsFile = path.join(temp, 'secrets.json');
  const calls = [];
  const serviceFetch = async (url, options = {}) => { calls.push({ url, headers: options.headers ?? {}, body: options.body ? JSON.parse(options.body) : undefined }); return answer(url, options); };
  const connections = { ...DEFAULT_CONNECTIONS, voice: { engine, model: '' }, ...extra };
  const server = createApp({ cacheDir: path.join(temp, 'cache'), previewDir: path.join(temp, 'previews'), connectionsFile: path.join(temp, 'connections.json'), secretsFile, connections, serviceFetch }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { session } = await (await fetch(`${base}/api/session`)).json();
  try { await run({ base, calls, session, secrets: createSecrets(secretsFile) }); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
}
const post = (base, route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function finished(base, id) {
  for (let i = 0; i < 1000; i++) {
    const job = await (await fetch(`${base}/api/jobs/${id}`)).json();
    if (['complete', 'error'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Job did not finish');
}
const scene = voice => ({ scene: { id: 's1', title: 'Kitchen', lines: [
  { id: 'a', character: 'ME', text: 'I have the key.', kind: 'dialogue' },
  { id: 'b', character: 'PARTNER', text: 'Then open it.', kind: 'dialogue' },
] }, voices: { ME: voice, PARTNER: voice }, myCharacter: 'ME', gapSeconds: 0, includeDirections: false });

test('an old profile with no engine still means Chatterbox, and an unknown engine is refused', () => {
  const { voice, ...old } = DEFAULT_CONNECTIONS;
  assert.deepEqual(validateConnections(old).voice, { engine: 'chatterbox', model: '' });
  assert.throws(() => validateConnections({ ...DEFAULT_CONNECTIONS, voice: { engine: 'fal', model: '' } }), /voice engine/);
  assert.throws(() => validateConnections({ ...DEFAULT_CONNECTIONS, voice: { engine: 'openai', model: 'x', apiKey: 'sk-no' } }), /API keys/);
  assert.equal(voice.engine, 'chatterbox');
});

test('OpenAI: no key means not ready; with a key, lines are voiced once, cached, and the key goes only in a header', () => hostedServer('openai', async ({ base, calls, secrets }) => {
  assert.equal((await (await fetch(`${base}/api/health`)).json()).tts.ok, false, 'Without a key the voices are not ready');
  const noKey = await (await post(base, '/api/connections/test', { ...DEFAULT_CONNECTIONS, voice: { engine: 'openai', model: '' }, only: 'voice' })).json();
  assert.match(noKey.results[0].detail, /no OpenAI key yet/);

  await secrets.set('openai', 'sk-test-0123456789abcdef4f2a');
  assert.equal((await (await fetch(`${base}/api/health`)).json()).tts.ok, true);
  const { voices, details, engine } = await (await fetch(`${base}/api/voices`)).json();
  assert.equal(engine, 'openai');
  assert.ok(voices.includes('openai:coral'));
  assert.deepEqual(details['openai:coral'], { label: 'Coral', gender: 'female' });

  const checked = await (await post(base, '/api/connections/test', { ...DEFAULT_CONNECTIONS, voice: { engine: 'openai', model: '' }, only: 'voice' })).json();
  assert.deepEqual([checked.results[0].ok, checked.results[0].detail], [true, 'Key accepted. 13 voices.']);

  const job = await finished(base, (await (await post(base, '/api/render', scene('openai:coral'))).json()).jobId);
  assert.equal(job.status, 'complete', job.error);
  const spoken = calls.filter(call => call.url.endsWith('/v1/audio/speech'));
  assert.equal(spoken.length, 2);
  assert.deepEqual(spoken[0].body, { model: 'gpt-4o-mini-tts', voice: 'coral', input: 'I have the key.', response_format: 'pcm' });
  assert.equal(spoken[0].headers.Authorization, 'Bearer sk-test-0123456789abcdef4f2a');
  assert.equal(calls.some(call => call.url.includes('sk-test')), false, 'The key is never in a URL');

  await finished(base, (await (await post(base, '/api/render', scene('openai:coral'))).json()).jobId);
  assert.equal(calls.filter(call => call.url.endsWith('/v1/audio/speech')).length, 2, 'A second render is paid for by nobody: lines come from the cache');

  const directed = scene('openai:coral');
  directed.scene.lines.push({ id: 'd', character: 'Narrator', text: 'She crosses to the door.', kind: 'direction' });
  directed.directionVoice = 'openai:coral';
  await finished(base, (await (await post(base, '/api/render', directed)).json()).jobId);
  assert.equal(calls.filter(call => call.url.endsWith('/v1/audio/speech')).length, 2, 'A hosted engine is not paid to speak directions the actor turned off');

  const refused = await (await post(base, '/api/render', scene('Stock-Amber'))).json();
  assert.match(refused.error, /available voice/, 'A local voice is not sent to a hosted engine');
}, url => {
  if (url.endsWith('/v1/models')) return Buffer.from(JSON.stringify({ data: [{ id: 'gpt-4o-mini-tts' }] }));
  if (url.endsWith('/v1/audio/speech')) return pcm;
  throw new Error(`unexpected ${url}`);
}));

test('a refused key is explained in plain words, and a preview needs this launch\'s secret', () => hostedServer('openai', async ({ base, session, secrets }) => {
  await secrets.set('openai', 'sk-test-0123456789abcdef4f2a');
  const job = await finished(base, (await (await post(base, '/api/render', scene('openai:coral'))).json()).jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error, /OpenAI refused the key/);
  assert.equal(job.error.includes('sk-test'), false);
  assert.equal((await fetch(`${base}/api/voices/preview?voice=openai:coral`)).status, 403, 'A page elsewhere cannot make this spend money');
  assert.equal((await fetch(`${base}/api/voices/preview?voice=openai:nobody&session=${session}`)).status, 404);
}, url => {
  if (url.endsWith('/v1/audio/speech')) throw new Error('Local voice service returned HTTP 401.');
  throw new Error(`unexpected ${url}`);
}));

test('ElevenLabs: voices come from the account, with genders, and speech asks for 24 kHz PCM', () => hostedServer('elevenlabs', async ({ base, calls, session, secrets }) => {
  await secrets.set('elevenlabs', 'eleven-0123456789abcdef4f2a');
  const { voices, details } = await (await fetch(`${base}/api/voices`)).json();
  assert.deepEqual(voices, ['elevenlabs:abc123']);
  assert.deepEqual(details['elevenlabs:abc123'], { label: 'Rachel', gender: 'female', accent: 'american' });
  const preview = await fetch(`${base}/api/voices/preview?voice=elevenlabs:abc123&session=${session}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('content-type'), 'audio/wav');
  const spoken = calls.find(call => call.url.includes('/v1/text-to-speech/'));
  assert.equal(spoken.url, 'https://api.elevenlabs.io/v1/text-to-speech/abc123?output_format=pcm_24000');
  assert.equal(spoken.headers['xi-api-key'], 'eleven-0123456789abcdef4f2a');
  assert.equal(spoken.body.model_id, 'eleven_multilingual_v2');
}, url => {
  if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify({ voices: [{ voice_id: 'abc123', name: 'Rachel', labels: { gender: 'female', accent: 'american' } }, { voice_id: '../bad', name: 'Bad' }] }));
  if (url.includes('/v1/text-to-speech/')) return pcm;
  throw new Error(`unexpected ${url}`);
}));

test('Gemini: the audio comes back as base64 PCM inside JSON', () => hostedServer('gemini', async ({ base, calls, secrets }) => {
  await secrets.set('gemini', 'AIza-0123456789abcdefghij');
  const job = await finished(base, (await (await post(base, '/api/render', scene('gemini:Kore'))).json()).jobId);
  assert.equal(job.status, 'complete', job.error);
  const spoken = calls.find(call => call.url.endsWith('/v1beta/interactions'));
  assert.equal(spoken.headers['x-goog-api-key'], 'AIza-0123456789abcdefghij');
  assert.deepEqual(spoken.body.generation_config, { speech_config: [{ voice: 'Kore' }] });
  assert.equal(spoken.body.model, 'gemini-3.1-flash-tts-preview');
}, url => {
  // The shape the live API returns: audio inside the model step, at a stated rate.
  if (url.endsWith('/v1beta/interactions')) return Buffer.from(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/l16; rate=24000; channels=1', data: pcm.toString('base64') }] }] }));
  throw new Error(`unexpected ${url}`);
}));

// Name guesses: only the names go out, and whatever comes back is checked before it is used.
const namesOut = prompt => JSON.parse(prompt.split('\n')[1]);
const guessed = names => JSON.stringify({ guesses: names.map(name => ({ name, gender: name === 'DAVID' ? 'male' : 'unknown' })) });
const guess = base => post(base, '/api/casting/guess-genders', { names: ['DAVID', 'ROBIN'] });

test('Claude guesses names with a JSON schema, the fallback header, and the key in x-api-key', () => hostedServer('chatterbox', async ({ base, calls, secrets }) => {
  const missing = await guess(base);
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /no Anthropic \(Claude\) key yet/);
  await secrets.set('anthropic', 'sk-ant-0123456789abcdef4f2a');
  const answer = await (await guess(base)).json();
  assert.deepEqual(answer.guesses, [{ name: 'DAVID', gender: 'male' }, { name: 'ROBIN', gender: 'unknown' }]);
  assert.equal(answer.model, 'claude-opus-5');
  const sent = calls.find(call => call.url === 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.headers['x-api-key'], 'sk-ant-0123456789abcdef4f2a');
  assert.equal(sent.headers['anthropic-version'], '2023-06-01');
  assert.equal(sent.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(sent.body.fallbacks, 'default');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.deepEqual(namesOut(sent.body.messages[0].content), ['DAVID', 'ROBIN'], 'Only the names are sent');
}, (url, options) => {
  if (url === 'https://api.anthropic.com/v1/messages') return Buffer.from(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: guessed(namesOut(JSON.parse(options.body).messages[0].content)) }] }));
  throw new Error(`unexpected ${url}`);
}, { names: { engine: 'anthropic', model: '' } }));

test('OpenRouter replies in a code fence are accepted; a wrong shape is refused', () => {
  let shape = 'fenced';
  return hostedServer('chatterbox', async ({ base, secrets }) => {
    await secrets.set('openrouter', 'sk-or-0123456789abcdef4f2a');
    assert.equal((await (await guess(base)).json()).guesses[0].gender, 'male');
    shape = 'wrong';
    const refused = await post(base, '/api/casting/guess-genders', { names: ['ALEX'] });
    assert.equal(refused.status, 502);
    assert.match((await refused.json()).error, /invalid casting suggestions/);
  }, (url, options) => {
    if (url !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error(`unexpected ${url}`);
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'openai/gpt-5.6');
    const content = shape === 'fenced' ? `\`\`\`json\n${guessed(namesOut(request.messages[1].content))}\n\`\`\`` : '{"guesses":[{"name":"SOMEONE ELSE","gender":"male"}]}';
    return Buffer.from(JSON.stringify({ choices: [{ message: { content } }] }));
  }, { names: { engine: 'openrouter', model: '' } });
});

test('testing a name model checks the key without guessing anything', () => hostedServer('chatterbox', async ({ base, calls, secrets }) => {
  await secrets.set('gemini', 'AIza-0123456789abcdefghij');
  const { results } = await (await post(base, '/api/connections/test', { ...DEFAULT_CONNECTIONS, names: { engine: 'gemini', model: '' }, only: 'names' })).json();
  assert.deepEqual([results[0].service, results[0].ok], ['names', true]);
  assert.equal(calls.some(call => call.url.includes('generateContent')), false);
}, url => {
  if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models?')) return Buffer.from('{"models":[]}');
  throw new Error(`unexpected ${url}`);
}));

test('a refusal shows the company\'s own reason, with the key removed from it', () => hostedServer('chatterbox', async ({ base, secrets }) => {
  await secrets.set('anthropic', 'sk-ant-0123456789abcdef4f2a');
  const { results } = await (await post(base, '/api/connections/test', { ...DEFAULT_CONNECTIONS, names: { engine: 'anthropic', model: '' }, only: 'names' })).json();
  assert.equal(results[0].ok, false);
  assert.match(results[0].detail, /rejected the request \(HTTP 400\).*said: "This key \[key\] is not scoped to a workspace\."/);
  assert.equal(results[0].detail.includes('sk-ant-0123456789abcdef4f2a'), false);
}, () => { throw Object.assign(new Error('Local voice service returned HTTP 400.'), { status: 502, detail: 'This key sk-ant-0123456789abcdef4f2a is not scoped to a workspace.' }); }));
