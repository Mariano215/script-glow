import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp, speechChunks, validateRender } from '../server/app.js';
import { decodeWav, encodeWav, assembleScene, SAMPLE_RATE } from '../server/audio.js';
import { parseScript } from '../src/parser.ts';

const pcm = Buffer.alloc(4800); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 1000 - 500, i);
const wav = encodeWav(pcm);
const input = () => ({ scene: { id: 's1', title: 'Kitchen', lines: [
  { id: 'a', character: 'ME', text: 'I have the key.', kind: 'dialogue' },
  { id: 'b', character: 'PARTNER', text: 'Then open it.', kind: 'dialogue' },
] }, voices: { ME: 'MyVoice', PARTNER: 'default' }, myCharacter: 'ME', gapSeconds: 0.25, includeDirections: false });

test('WAV export mutes only selected actor; cues and both timelines remain sample accurate', () => {
  const lines = input().scene.lines;
  const result = assembleScene(lines.map(line => ({ line, pcm })), 'ME', 0.25);
  const full = result.full.subarray(44), practice = result.practice.subarray(44);
  assert.equal(full.length, practice.length);
  assert.equal(result.duration, 0.7);
  assert.deepEqual(result.cues, [ { lineId: 'a', character: 'ME', start: 0, end: 0.1 }, { lineId: 'b', character: 'PARTNER', start: 0.35, end: 0.45 } ]);
  assert.ok(practice.subarray(0, pcm.length).every(byte => byte === 0));
  assert.deepEqual(practice.subarray(16800, 16800 + pcm.length), pcm);
  assert.deepEqual(decodeWav(wav), pcm);
});

test('WAV decoder handles IEEE float stereo, rejects malformed payloads and NaNs', () => {
  const float = Buffer.alloc(44 + 80);
  wav.copy(float, 0, 0, 44); float.writeUInt32LE(float.length - 8, 4); float.writeUInt16LE(3, 20); float.writeUInt16LE(2, 22);
  float.writeUInt32LE(24000 * 8, 28); float.writeUInt16LE(8, 32); float.writeUInt16LE(32, 34); float.writeUInt32LE(80, 40);
  for (let i = 44; i < float.length; i += 8) { float.writeFloatLE(0.5, i); float.writeFloatLE(0.25, i + 4); }
  assert.equal(decodeWav(float).readInt16LE(0), 12288);
  assert.equal(decodeWav(float).length, 20);
  float.writeFloatLE(NaN, 44); assert.throws(() => decodeWav(float), /non-finite/);
  assert.throws(() => decodeWav(wav.subarray(0, wav.length - 1)), /Truncated/);
  assert.throws(() => decodeWav(Buffer.from('not audio')), /invalid WAV/);
});

test('render validation rejects unknown voices, duplicate ids, oversized input and invalid gap', () => {
  const voices = ['MyVoice', 'default'];
  assert.doesNotThrow(() => validateRender(input(), voices));
  const missingRole = input(); missingRole.myCharacter = 'OTHER'; assert.doesNotThrow(() => validateRender(missingRole, voices));
  const duplicate = input(); duplicate.scene.lines[1].id = 'a'; assert.throws(() => validateRender(duplicate, voices), /unique id/);
  const unknown = input(); unknown.voices.ME = '../../private'; assert.throws(() => validateRender(unknown, voices), /available voice/);
  assert.throws(() => validateRender({ ...input(), gapSeconds: NaN }, voices), /settings/);
  const large = input(); large.scene.lines[0].text = 'a'.repeat(20001); assert.throws(() => validateRender(large, voices), /20,000/);
  for (const scope of ['all', null, 1]) assert.throws(() => validateRender({ ...input(), scope }, voices), /scope/);
  assert.equal(validateRender(input(), voices).scope, 'scene');
  const script = { ...input(), scope: 'script' };
  script.scene.lines = Array.from({ length: 301 }, (_, i) => ({ ...input().scene.lines[i % 2], id: `line-${i}` }));
  assert.doesNotThrow(() => validateRender(script, voices));
  assert.throws(() => validateRender({ ...script, scope: 'scene' }, voices), /1–300/);
  script.scene.lines = Array.from({ length: 5001 }, (_, i) => ({ ...input().scene.lines[0], id: `line-${i}` }));
  assert.throws(() => validateRender(script, voices), /1–5,000/);
  script.scene.lines = Array.from({ length: 251 }, (_, i) => ({ ...input().scene.lines[0], id: `line-${i}`, text: 'x'.repeat(2000) }));
  assert.throws(() => validateRender(script, voices), /500,000/);
});

test('a long run-on sentence is split at spaces and keeps every letter', () => {
  const sentence = Array.from({ length: 150 }, (_, i) => `words${i} sits`).join(' ');
  assert.ok(sentence.length > 1200 && !/[.!?]/.test(sentence));
  const chunks = speechChunks(sentence);
  assert.ok(chunks.length > 1 && chunks.every(chunk => chunk.length <= 1000));
  assert.equal(chunks.join(' '), sentence);
});

async function withServer(fn, serviceFetch) {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'script-glow-test-'));
  // Production exports live below a hidden .cache ancestor. Express sendFile
  // must resolve relative to the explicit render root, not reject that ancestor.
  const cacheDir = path.join(testDir, '.cache');
  let calls = 0;
  const mock = serviceFetch || (async url => {
    if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify({ voices: ['MyVoice', 'default'] }));
    if (url.endsWith('/health')) return Buffer.from('{"status":"ok"}');
    calls++; return wav;
  });
  const server = createApp({ cacheDir, serviceFetch: mock, previewDir: path.join(testDir, 'previews'), connectionsFile: path.join(testDir, 'connections.json'), secretsFile: path.join(testDir, 'secrets.json') }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, () => calls, cacheDir); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(testDir, { recursive: true, force: true }); }
}
const post = (base, route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function completed(base, id) {
  for (let i = 0; i < 1000; i++) {
    const job = await (await fetch(`${base}/api/jobs/${id}`)).json();
    if (['complete', 'error'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Job did not finish');
}

test('API renders downloadable variants and reuses cached line audio', async () => withServer(async (base, calls) => {
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { tts: { ok: true }, stt: { ok: true } });
  for (let i = 0; i < 2; i++) {
    const accepted = await post(base, '/api/render', input()); assert.equal(accepted.status, 202);
    const job = await completed(base, (await accepted.json()).jobId); assert.equal(job.status, 'complete'); assert.equal(job.completed, 2);
    const fullResponse = await fetch(base + job.result.fullUrl);
    const practiceResponse = await fetch(base + job.result.practiceUrl);
    assert.equal(fullResponse.status, 200); assert.equal(practiceResponse.status, 200);
    assert.match(fullResponse.headers.get('content-type'), /audio\/wav/);
    const full = Buffer.from(await fullResponse.arrayBuffer());
    const practice = Buffer.from(await practiceResponse.arrayBuffer());
    assert.equal(full.subarray(0, 4).toString(), 'RIFF');
    assert.equal(full.length, practice.length); assert.ok(practice.subarray(44, 44 + pcm.length).every(byte => byte === 0));
  }
  assert.equal(calls(), 2);
}));

test('full script renders more than 300 lines with sample-exact cues and mute track', async () => withServer(async (base, calls, cacheDir) => {
  const body = { ...input(), scope: 'script', gapSeconds: 0.0001 };
  body.scene = { id: 'full-script', title: 'Full script', lines: Array.from({ length: 301 }, (_, i) => ({ ...input().scene.lines[i % 2], id: `line-${i}` })) };
  const accepted = await post(base, '/api/render', body); assert.equal(accepted.status, 202);
  const job = await completed(base, (await accepted.json()).jobId);
  assert.equal(job.status, 'complete'); assert.equal(job.completed, 301); assert.equal(job.total, 301);
  const full = Buffer.from(await (await fetch(base + job.result.fullUrl)).arrayBuffer());
  const practice = Buffer.from(await (await fetch(base + job.result.practiceUrl)).arrayBuffer());
  const stride = pcm.length + Math.round(body.gapSeconds * SAMPLE_RATE) * 2;
  assert.equal(full.length, 44 + 301 * stride); assert.equal(practice.length, full.length);
  assert.equal(full.readUInt32LE(4), full.length - 8); assert.equal(practice.readUInt32LE(40), practice.length - 44);
  assert.equal(job.result.duration, (301 * stride) / (2 * SAMPLE_RATE));
  assert.equal(job.result.cues.length, 301);
  for (let i = 0; i < 301; i++) {
    const offset = 44 + i * stride;
    assert.equal(job.result.cues[i].start, i * stride / (2 * SAMPLE_RATE));
    assert.equal(job.result.cues[i].end, (i * stride + pcm.length) / (2 * SAMPLE_RATE));
    assert.deepEqual(full.subarray(offset, offset + pcm.length), pcm);
    assert.deepEqual(practice.subarray(offset, offset + pcm.length), i % 2 ? pcm : Buffer.alloc(pcm.length));
  }
  assert.equal(calls(), 2);
  assert.ok((await readdir(path.join(cacheDir, 'renders'))).every(name => name.endsWith('.wav')));
}));

test('cancelled streaming render cleans its unpublished files and preserves completed exports', async () => {
  let release; let block = false;
  await withServer(async (base, _calls, cacheDir) => {
    const first = await completed(base, (await (await post(base, '/api/render', input())).json()).jobId);
    assert.equal(first.status, 'complete');
    block = true;
    const pending = { ...input(), scope: 'script' }; pending.scene.lines[1].text = 'Block this uncached line.';
    const id = (await (await post(base, '/api/render', pending)).json()).jobId;
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await fetch(`${base}/audio/${id}-full.wav`)).status, 404);
    assert.ok((await readdir(path.join(cacheDir, 'renders'))).some(name => name === `${id}-full.wav.part`));
    await post(base, `/api/jobs/${id}/cancel`, {});
    assert.equal((await completed(base, id)).error, 'Render cancelled.');
    release();
    // Completion of the next serialized job proves cancellation cleanup finished.
    const after = await completed(base, (await (await post(base, '/api/render', input())).json()).jobId);
    assert.equal(after.status, 'complete');
    const names = await readdir(path.join(cacheDir, 'renders'));
    assert.ok(names.every(name => !name.startsWith(id) && !name.endsWith('.part')));
    assert.equal((await fetch(base + first.result.fullUrl)).status, 200);
    assert.equal((await fetch(base + first.result.practiceUrl)).status, 200);
  }, async url => {
    if (url.endsWith('/v1/voices')) return Buffer.from('["MyVoice","default"]');
    if (block) { block = false; await new Promise(resolve => { release = resolve; }); }
    return wav;
  });
});

test('API rejects cross-site mutations, invalid PDFs, unknown jobs and voices', async () => withServer(async base => {
  assert.equal((await post(base, '/api/render', input(), { Origin: 'https://evil.example' })).status, 403);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/health', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await post(base, '/api/import', { name: 'fake.pdf', data: Buffer.from('not a pdf').toString('base64') })).status, 400);
  assert.equal((await fetch(base + '/api/jobs/missing')).status, 404);
  const body = input(); body.voices.ME = 'unknown'; assert.equal((await post(base, '/api/render', body)).status, 400);
}));

test('queue cancellation is visible and does not overlap active GPU requests', async () => {
  let release; let active = 0; let maxActive = 0; let first = true;
  await withServer(async base => {
    const start = async () => (await (await post(base, '/api/render', input())).json()).jobId;
    const firstId = await start();
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    const secondId = await start();
    assert.equal((await post(base, `/api/jobs/${firstId}/cancel`, {})).status, 200);
    assert.equal((await completed(base, firstId)).error, 'Render cancelled.');
    release();
    assert.equal((await completed(base, secondId)).status, 'complete');
    assert.equal(maxActive, 1);
  }, async url => {
    if (url.endsWith('/v1/voices')) return Buffer.from('{"voices":["MyVoice","default"]}');
    active++; maxActive = Math.max(active, maxActive);
    if (first) { first = false; await new Promise(resolve => { release = resolve; }); }
    active--; return wav;
  });
});

test('queue rejects a fifth outstanding render and permits replacement after cancellation', async () => {
  let release; let first = true;
  await withServer(async base => {
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const res = await post(base, '/api/render', input()); assert.equal(res.status, 202); ids.push((await res.json()).jobId);
    }
    assert.equal((await post(base, '/api/render', input())).status, 429);
    await post(base, `/api/jobs/${ids[3]}/cancel`, {});
    const replacement = await post(base, '/api/render', input()); assert.equal(replacement.status, 202);
    release();
    assert.equal((await completed(base, (await replacement.json()).jobId)).status, 'complete');
  }, async url => {
    if (url.endsWith('/v1/voices')) return Buffer.from('{"voices":["MyVoice","default"]}');
    if (first) { first = false; await new Promise(resolve => { release = resolve; }); }
    return wav;
  });
});

test('local service failure is reported as unavailable and failed TTS ends a job explicitly', async () => {
  await withServer(async base => {
    assert.equal((await fetch(base + '/api/voices')).status, 503);
    assert.deepEqual(await (await fetch(base + '/api/health')).json(), { tts: { ok: false }, stt: { ok: false } });
  }, async () => { throw new Error('offline'); });
  await withServer(async base => {
    const res = await post(base, '/api/render', input());
    const job = await completed(base, (await res.json()).jobId);
    assert.equal(job.status, 'error'); assert.match(job.error, /invalid WAV/);
  }, async url => url.endsWith('/v1/voices') ? Buffer.from('["MyVoice","default"]') : Buffer.from('invalid data'));
});

test('failed streaming job removes its partial exports before next job runs', async () => {
  let failNext = true;
  await withServer(async (base, _calls, cacheDir) => {
    const accepted = await post(base, '/api/render', { ...input(), scope: 'script' });
    const failedId = (await accepted.json()).jobId;
    const failed = await completed(base, failedId);
    assert.equal(failed.status, 'error'); assert.match(failed.error, /invalid WAV/);
    const next = await completed(base, (await (await post(base, '/api/render', input())).json()).jobId);
    assert.equal(next.status, 'complete');
    assert.ok((await readdir(path.join(cacheDir, 'renders'))).every(name => !name.startsWith(failedId) && !name.endsWith('.part')));
    assert.equal((await fetch(`${base}/audio/${failedId}-full.wav`)).status, 404);
  }, async url => {
    if (url.endsWith('/v1/voices')) return Buffer.from('["MyVoice","default"]');
    if (failNext) { failNext = false; return Buffer.from('invalid data'); }
    return wav;
  });
});

test('PDF geometry preserves character blocks, wrapped dialogue, and stage directions', async () => withServer(async base => {
  const rows = [
    [72, 720, 'INT. ROOM - DAY'], [240, 684, 'JORDAN'],
    [180, 672, 'Are you ready'], [180, 660, 'to begin?'],
    [240, 636, 'PARTNER'], [180, 624, 'Yes. The stage is yours.'],
    [72, 600, 'The lights dim.'], [240, 576, 'JORDAN'], [180, 564, 'Then let us begin.'],
  ];
  // Deliberately shuffled PDF content order: visual geometry determines reading order.
  const content = [...rows.slice(4), ...rows.slice(0, 4)].map(([x, y, text]) => `BT /F1 12 Tf 1 0 0 1 ${x} ${y} Tm (${text}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const res = await post(base, '/api/import', { name: 'scene.pdf', data: Buffer.from(pdf).toString('base64') });
  assert.equal(res.status, 200);
  const extracted = (await res.json()).text;
  assert.match(extracted, /Are you ready\nto begin\?\n\nPARTNER/);
  const parsed = parseScript(extracted);
  assert.deepEqual(parsed.characters, ['JORDAN', 'PARTNER']);
  assert.equal(parsed.scenes[0].lines[0].text, 'Are you ready to begin?');
  assert.ok(parsed.scenes[0].lines.some(line => line.kind === 'direction' && line.text === 'The lights dim.'));
  // Repeated native parser startup/teardown must never stop the API process.
  for (let repeat = 0; repeat < 2; repeat++) {
    const again = await post(base, '/api/import', { name: 'scene.pdf', data: Buffer.from(pdf).toString('base64') });
    assert.equal(again.status, 200); assert.equal((await again.json()).text, extracted);
  }
  const malformed = await post(base, '/api/import', { name: 'broken.pdf', data: Buffer.from('%PDF-1.7 broken file').toString('base64') });
  assert.equal(malformed.status, 422);
  assert.equal((await fetch(base + '/api/health')).status, 200);
}));

test('monologues longer than one TTS request render as sentence chunks under a single muted cue', async () => {
  const texts = [];
  const mock = async (url, options) => {
    if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify({ voices: ['MyVoice', 'default'] }));
    if (url.endsWith('/health')) return Buffer.from('{"status":"ok"}');
    texts.push(JSON.parse(options.body).text); return wav;
  };
  await withServer(async base => {
    const speech = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i + 1} of a long speech.`).join(' ');
    assert.ok(speech.length > 2000);
    const body = input(); body.scene.lines[0].text = speech;
    const accepted = await post(base, '/api/render', body); assert.equal(accepted.status, 202);
    const job = await completed(base, (await accepted.json()).jobId);
    assert.equal(job.status, 'complete', job.error);
    const chunks = texts.slice(0, -1);
    assert.ok(chunks.length > 1 && chunks.every(text => text.length <= 1000));
    assert.equal(chunks.join(' '), speech);
    const cue = job.result.cues[0];
    assert.equal(cue.lineId, 'a'); assert.equal((cue.end - cue.start).toFixed(3), (chunks.length * 0.1).toFixed(3));
    const practice = Buffer.from(await (await fetch(base + job.result.practiceUrl)).arrayBuffer());
    assert.ok(practice.subarray(44, 44 + chunks.length * pcm.length).every(byte => byte === 0));
  }, mock);
});
