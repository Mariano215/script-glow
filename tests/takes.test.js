import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createProjectStore, MAX_TAKES } from '../server/projects.js';

const preferences = () => ({ source: 'INT. ROOM - DAY\n\nDAVID\nHello.', name: 'Takes', role: 'DAVID', cast: { DAVID: 'MyVoice' }, guesses: {}, genders: {}, manualVoices: {}, sceneId: 'scene-1', gap: 0, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' });
const body = (...chunks) => Readable.from(chunks.map(chunk => Buffer.from(chunk)));

async function fixture(run) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-takes-'));
  try { await run(createProjectStore(path.join(temp, 'projects'), path.join(temp, 'cache')), temp); }
  finally { await rm(temp, { recursive: true, force: true }); }
}

test('a take is stored, listed, renamed and removed without touching the project manifest', () => fixture(async store => {
  const project = await store.create({ preferences: preferences() });
  assert.deepEqual(await store.takes(project.id), []);
  const take = await store.addTake(project.id, body('a take'), { type: 'video/webm', sceneId: 'scene-1', label: 'Scene 1 · take 1', ms: 4200 });
  assert.match(take.file, /^[a-f0-9-]{36}\.webm$/, 'The name on disk is generated, never sent by the browser');
  assert.equal(take.bytes, 6);
  assert.equal(take.ms, 4200);
  const listed = await store.takes(project.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].label, 'Scene 1 · take 1');
  const { path: file } = await store.takePath(project.id, take.file);
  assert.equal(await readFile(file, 'utf8'), 'a take');
  assert.equal((await store.renameTake(project.id, take.file, 'The good one')).label, 'The good one');
  const before = await store.get(project.id);
  await store.deleteTake(project.id, take.file);
  assert.deepEqual(await store.takes(project.id), []);
  await assert.rejects(() => store.takePath(project.id, take.file), /not found/);
  const after = await store.get(project.id);
  assert.deepEqual(after.renders, before.renders, 'Deleting a take leaves the renders alone');
  assert.equal(after.preferences.source, before.preferences.source);
}));

test('a take is refused when the container, the project, the name or the recording is wrong', () => fixture(async store => {
  const project = await store.create({ preferences: preferences() });
  await assert.rejects(() => store.addTake(project.id, body('x'), { type: 'text/html' }), /video\/webm or video\/mp4/);
  await assert.rejects(() => store.addTake(project.id, body('x'), { type: 'video/webm', label: 'x'.repeat(101) }), /Invalid take details/);
  await assert.rejects(() => store.addTake(project.id, body(''), { type: 'video/webm' }), /empty/);
  await assert.rejects(() => store.addTake('not-a-project', body('x'), { type: 'video/webm' }), /Invalid project id/);
  await assert.rejects(() => store.takePath(project.id, '../../project.json'), /not found/);
  await assert.rejects(() => store.takePath(project.id, 'take.webm'), /not found/);
  await assert.rejects(() => store.deleteTake(project.id, '../project.json'), /not found/);
  assert.deepEqual(await store.takes(project.id), [], 'No refused take leaves a file behind');
}));

test('a damaged index still lists the takes it can read, and the cap refuses instead of deleting', () => fixture(async (store, temp) => {
  const project = await store.create({ preferences: preferences() });
  const keep = await store.addTake(project.id, body('one'), { type: 'video/webm', label: 'Keeper' });
  const index = path.join(temp, 'projects', project.id, 'takes', 'index.json');
  await writeFile(index, JSON.stringify([{ file: keep.file, label: 'Keeper' }, { file: 'not-a-name', label: 'Bad' }, 'rubbish']));
  assert.deepEqual((await store.takes(project.id)).map(item => item.label), ['Keeper']);
  await writeFile(index, 'not json at all');
  assert.deepEqual(await store.takes(project.id), [], 'An unreadable index hides nothing that a later take cannot re-record');
  const entries = [];
  for (let n = 0; n < MAX_TAKES; n++) entries.push(await store.addTake(project.id, body(`take ${n}`), { type: 'video/webm', label: `Take ${n}` }));
  await assert.rejects(() => store.addTake(project.id, body('one more'), { type: 'video/webm' }), /Delete one before recording another/);
  assert.equal((await store.takes(project.id)).length, MAX_TAKES, 'The cap refuses the new take rather than dropping an old one');
}));

test('a slate is its own kind of take, and an unknown kind is refused', () => fixture(async store => {
  const project = await store.create({ preferences: preferences() });
  const slate = await store.addTake(project.id, body('slate'), { type: 'video/webm', kind: 'slate' });
  assert.equal(slate.kind, 'slate');
  assert.equal(slate.label, 'Slate');
  assert.equal((await store.addTake(project.id, body('scene'), { type: 'video/webm' })).kind, 'scene');
  await assert.rejects(() => store.addTake(project.id, body('x'), { type: 'video/webm', kind: 'blooper' }), /Invalid take kind/);
  const saved = await store.update(project.id, { revision: 1, preferences: { ...preferences(), readerLevel: 0.6 } });
  assert.equal(saved.preferences.readerLevel, 0.6, 'The reader volume is kept with the project');
  await assert.rejects(() => store.update(project.id, { revision: 2, preferences: { ...preferences(), readerLevel: 3 } }), /reader volume/);
}));

test('the MP4 command is built only from generated names and checked numbers', async () => {
  const { mp4Arguments } = await import('../server/video.js');
  const args = mp4Arguments({ input: 'a.webm', output: 'b.part.mp4', start: 1.5, length: 4 });
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2), ['-ss', '1.500']);
  assert.deepEqual(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2), ['-t', '4.000']);
  assert.ok(args.includes('libx264') && args.includes('aac') && args.includes('+faststart'), 'H.264, AAC, and playable before it finishes downloading');
  assert.equal(args.at(-1), 'b.part.mp4');
  assert.equal(mp4Arguments({ input: 'a.webm', output: 'b.mp4' }).includes('-ss'), false, 'No trim, no seek');
  for (const bad of [{ input: '../x.webm', output: 'b.mp4' }, { input: 'a.webm', output: 'b.mp4; rm -rf /' }, { input: 'a.webm', output: 'b.mp4', start: -1 }, { input: 'a.webm', output: 'b.mp4', length: Number.NaN }])
    assert.throws(() => mp4Arguments(bad), /Invalid/);
});

// Runs only where FFmpeg is installed (set SCRIPT_GLOW_FFMPEG or put ffmpeg on the PATH).
test('a take is trimmed and converted to an MP4 beside the original', async t => {
  const { findFfmpeg } = await import('../server/video.js');
  const tool = await findFfmpeg();
  if (!tool) { t.skip('FFmpeg is not installed here'); return; }
  const { spawnSync } = await import('node:child_process');
  await fixture(async store => {
    const project = await store.create({ preferences: preferences() });
    const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-video-'));
    try {
      // A three-second test clip with sound, made by FFmpeg itself, in the same format a browser records.
      const made = spawnSync(tool.program, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libvpx', '-c:a', 'libopus', '-shortest', 'clip.webm'], { cwd: temp });
      if (made.status !== 0) { t.skip('This FFmpeg cannot write WebM'); return; }
      const source = await store.addTake(project.id, Readable.from([await readFile(path.join(temp, 'clip.webm'))]), { type: 'video/webm', label: 'Take 1', ms: 3000 });
      await assert.rejects(() => store.exportTake(project.id, source.file, { start: 2, end: 1 }), /start before the end/);
      const mp4 = await store.exportTake(project.id, source.file, { start: 0.5, end: 2.5 });
      assert.match(mp4.file, /^[a-f0-9-]{36}\.mp4$/);
      assert.equal(mp4.label, 'Take 1 (trimmed) MP4');
      assert.equal(mp4.ms, 2000);
      assert.equal(mp4.from, source.file);
      const { path: file } = await store.takePath(project.id, mp4.file);
      const bytes = await readFile(file);
      assert.equal(bytes.subarray(4, 8).toString(), 'ftyp', 'It is an MP4 file');
      const listed = await store.takes(project.id);
      assert.deepEqual(listed.map(item => item.file), [source.file, mp4.file], 'The original is kept');
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
});

// Runs only where FFmpeg is installed. Scene audio saved as MP3 instead of WAV.
test('scene audio converts from WAV to MP3', async t => {
  const { findFfmpeg, makeMp3, mp3Arguments } = await import('../server/video.js');
  assert.throws(() => mp3Arguments({ input: '../a.wav', output: 'b.mp3' }), /Invalid/);
  if (!await findFfmpeg()) { t.skip('FFmpeg is not installed here'); return; }
  const { encodeWav } = await import('../server/audio.js');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-mp3-'));
  try {
    await writeFile(path.join(temp, 'scene-full.wav'), encodeWav(Buffer.alloc(48000)));
    await makeMp3({ cwd: temp, input: 'scene-full.wav', output: 'scene-full.mp3' });
    const bytes = await readFile(path.join(temp, 'scene-full.mp3'));
    assert.ok(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), 'It is an MP3 file');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
