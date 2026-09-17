import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTakeType, supportedTakeTypes, takeContainer, takeNeedsConverting, takeLabel, takeClock, TAKE_TYPES } from '../src/selftape.ts';

test('the recorder asks for MP4 first and settles for what the browser can actually produce', () => {
  assert.equal(pickTakeType(() => true), TAKE_TYPES[0], 'A browser with H.264 records what casting sites accept');
  assert.equal(pickTakeType(type => !type.includes('codecs')), 'video/mp4', 'A Chromium without the codec strings still writes MP4');
  assert.equal(pickTakeType(type => type.startsWith('video/webm')), 'video/webm;codecs=vp9,opus');
  assert.equal(pickTakeType(() => false), '', 'A browser that cannot record says so instead of guessing');
  assert.deepEqual(supportedTakeTypes(type => !type.includes('codecs')), ['video/mp4', 'video/webm'], 'Every usable container is kept, so a refused one can fall back');
  assert.deepEqual(supportedTakeTypes(() => false), []);
});

test('the container and the warning follow the chosen type', () => {
  assert.equal(takeContainer(TAKE_TYPES[0]), 'video/mp4');
  assert.equal(takeContainer('video/webm;codecs=vp9,opus'), 'video/webm');
  assert.equal(takeNeedsConverting('video/webm'), true, 'A WebM take is flagged because some casting sites refuse it');
  assert.equal(takeNeedsConverting(TAKE_TYPES[0]), false);
  assert.equal(takeNeedsConverting(''), false, 'With no recording there is nothing to warn about');
});

test('a take is named after its scene and numbered from the takes already kept', () => {
  assert.equal(takeLabel('INT. KITCHEN - DAY', 0), 'INT. KITCHEN - DAY · take 1');
  assert.equal(takeLabel('  ', 2), 'Scene · take 3', 'An untitled scene still gets a plain name');
  assert.ok(takeLabel('x'.repeat(200), 9).length <= 100, 'The name stays inside the limit the server accepts');
});

test('the clock reads as minutes and seconds', () => {
  assert.equal(takeClock(0), '0:00');
  assert.equal(takeClock(9500), '0:10');
  assert.equal(takeClock(65000), '1:05');
  assert.equal(takeClock(-5), '0:00');
});

test('a recorded voice becomes a mono 16-bit WAV the server can read', async () => {
  const { monoWav } = await import('../src/selftape.ts');
  const { decodeWav } = await import('../server/audio.js');
  const left = new Float32Array(48000).fill(0.5), right = new Float32Array(48000).fill(-0.1);
  const wav = monoWav([left, right], 48000);
  assert.equal(wav.length, 44 + 48000 * 2);
  const pcm = decodeWav(Buffer.from(wav));
  assert.equal(pcm.length / 2, 24000, 'One second, resampled to the app rate');
  assert.equal(pcm.readInt16LE(2000), Math.round(0.2 * 32767), 'Channels are averaged');
  assert.equal(new DataView(monoWav([new Float32Array([2])], 8000).buffer).getInt16(44, true), 32767, 'Loud samples are clipped, not wrapped');
});

test('a take is checked against what the big casting sites accept', async () => {
  const { castingFit } = await import('../src/selftape.ts');
  const MB = 1024 * 1024;
  const small = castingFit(40 * MB, 'a.mp4');
  assert.deepEqual(small.map(fit => fit.ok), [true, true, true], 'A 40 MB MP4 goes anywhere');
  const webm = castingFit(40 * MB, 'a.webm');
  assert.deepEqual(webm.find(fit => fit.site === 'Casting Networks'), { site: 'Casting Networks', ok: false, reason: 'needs MP4' });
  assert.equal(webm.find(fit => fit.site === 'Spotlight')!.ok, true, 'Spotlight takes WebM');
  const large = castingFit(400 * MB, 'a.mp4');
  assert.equal(large.find(fit => fit.site === 'Casting Networks')!.reason, 'over 300 MB');
  assert.equal(large.find(fit => fit.site === 'Eco Cast')!.ok, true, 'Eco Cast allows up to 500 MB');
  assert.equal(castingFit(600 * MB, 'a.mp4').find(fit => fit.site === 'Eco Cast')!.reason, 'over 500 MB');
});

test('saved takes are named performer, project and scene, safely', async () => {
  const { castingFileName } = await import('../src/selftape.ts');
  assert.equal(castingFileName('Jane Doe', 'Evelyn', 'Thorne Lab – Later'), 'Jane_Doe_Evelyn_Thorne_Lab_Later');
  assert.equal(castingFileName('Zoë  O\'Neil', 'the last light', 'Slate'), 'Zoe_O_Neil_The_Last_Light_Slate');
  assert.equal(castingFileName('', 'Evelyn', 'Kitchen'), 'Evelyn_Kitchen', 'No name yet still gives a useful name');
  assert.equal(castingFileName('../../etc', '<b>', ''), 'Etc_B', 'Nothing but letters, digits and underscores survives');
  assert.equal(castingFileName('', '', ''), 'Self_tape');
  assert.ok(castingFileName('x'.repeat(300)).length <= 120);
});
