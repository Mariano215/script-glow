import test from 'node:test';
import assert from 'node:assert/strict';
import { cueRate, cueAt, stepCue, shouldWait, firstLetters, loopRange, buildTargets, buildEnd, buildNext, listenStart, listenFrom, listenStep, lineMatch } from '../src/playback.ts';

const cues = [
  { lineId: 'a', start: 0, end: 2, character: 'DAVID' },
  { lineId: 'b', start: 2, end: 5, character: 'ANNA' },
  { lineId: 'c', start: 5, end: 9, character: 'DAVID' },
];

test('practice keeps the actor\'s own pause at 1x; every other cue follows the chosen speed', () => {
  const practice = { rate: 1.5, mode: 'practice' as const, role: 'DAVID' };
  assert.equal(cueRate(practice, 'DAVID'), 1, 'The silent span the actor speaks into is never compressed');
  assert.equal(cueRate(practice, 'ELIZABETH'), 1.5);
  assert.equal(cueRate(practice, undefined), 1.5, 'Gaps between cues are not the actor\'s turn');
  assert.equal(cueRate({ ...practice, role: '' }, ''), 1.5, 'An unset role does not freeze the whole scene at 1x');
  const full = { rate: 1.5, mode: 'full' as const, role: 'DAVID' };
  assert.equal(cueRate(full, 'DAVID'), 1.5, 'Full cast reads the actor\'s line aloud, so it speeds up with the rest');
  assert.equal(cueRate({ ...practice, rate: 0.75 }, 'DAVID'), 1, 'A slower rate does not stretch the pause either');
  assert.equal(cueRate({ ...practice, rate: 0.75 }, 'ELIZABETH'), 0.75);
});

test('the cue under the playhead is found by its own span', () => {
  assert.equal(cueAt(cues, 0)?.lineId, 'a');
  assert.equal(cueAt(cues, 1.99)?.lineId, 'a');
  assert.equal(cueAt(cues, 2)?.lineId, 'b', 'A boundary belongs to the cue that starts there');
  assert.equal(cueAt(cues, 9), undefined, 'Past the last cue there is no cue');
  assert.equal(cueAt(undefined, 1), undefined);
});

test('cue steps move to a cue start, restart a cue already under way, and stop at the ends', () => {
  assert.equal(stepCue(cues, 0, 1), 2);
  assert.equal(stepCue(cues, 2, 1), 5);
  assert.equal(stepCue(cues, 8, 1), null, 'There is nothing after the last cue');
  assert.equal(stepCue(cues, 6, -1), 5, 'Back restarts the cue already playing');
  assert.equal(stepCue(cues, 5, -1), 2, 'At the very start of a cue, back goes to the one before');
  assert.equal(stepCue(cues, 0, -1), null, 'At the beginning there is nowhere back to go');
  assert.equal(stepCue([], 3, -1), null);
  assert.equal(stepCue(undefined, 3, 1), null);
});

test('waiting happens only on the actor\'s silent turn and only once per cue', () => {
  const on = { mode: 'practice' as const, role: 'DAVID', wait: true };
  assert.equal(shouldWait(on, cues[0], ''), true);
  assert.equal(shouldWait(on, cues[1], ''), false, 'Another character is read aloud, so there is nothing to wait for');
  assert.equal(shouldWait(on, cues[0], 'a'), false, 'A cue already resumed does not stop playback again');
  assert.equal(shouldWait({ ...on, wait: false }, cues[0], ''), false);
  assert.equal(shouldWait({ ...on, mode: 'full' }, cues[0], ''), false, 'Full cast reads the actor\'s line, so it never waits');
  assert.equal(shouldWait({ ...on, role: '' }, { ...cues[0], character: '' }, ''), false, 'An unset role never traps playback');
  assert.equal(shouldWait(on, undefined, ''), false);
});

test('first letters prompt a line without giving it away', () => {
  assert.equal(firstLetters('I waited up for you.'), 'I w u f y.');
  assert.equal(firstLetters('Stop — and look at me!'), 'S — a l a m!');
  assert.equal(firstLetters(''), '');
  assert.equal(firstLetters('123 Main'), '123 M', 'Numbers are not letters and stay as they are');
});

test('an A to B range is read from the named lines in either order', () => {
  assert.deepEqual(loopRange(cues, 'a', 'b'), { start: 0, end: 5 });
  assert.deepEqual(loopRange(cues, 'c', 'a'), { start: 0, end: 9 }, 'Marks set back to front still make a range');
  assert.deepEqual(loopRange(cues, 'b', 'b'), { start: 2, end: 5 }, 'One line is a valid loop');
  assert.equal(loopRange(cues, 'a', 'gone'), null, 'A line that no longer exists clears the range');
  assert.equal(loopRange(undefined, 'a', 'b'), null);
});

test('additive rehearsal grows by the actor\'s own lines and repeats each block', () => {
  assert.deepEqual(buildTargets(cues, 'DAVID').map(cue => cue.lineId), ['a', 'c'], 'The block ends on one of the actor\'s lines');
  assert.deepEqual(buildTargets(cues, 'NOBODY').map(cue => cue.lineId), ['a', 'b', 'c'], 'A scene the actor is silent in grows a line at a time');
  assert.deepEqual(buildTargets(cues, '').map(cue => cue.lineId), ['a', 'b', 'c']);
  const targets = buildTargets(cues, 'DAVID');
  assert.equal(buildEnd(targets, 0), 2, 'The first block ends where the first of the actor\'s lines ends');
  assert.equal(buildEnd(targets, 1), 9, 'The second block takes in everything up to the next one');
  assert.equal(buildEnd(targets, 9), 9, 'A step past the end stays on the last block');
  assert.equal(buildEnd([], 0), null);
  assert.deepEqual(buildNext(0, 1, 2, 2), { step: 0, pass: 2, done: false }, 'The same block comes round again');
  assert.deepEqual(buildNext(0, 2, 2, 2), { step: 1, pass: 1, done: false }, 'Then one more line joins it');
  assert.deepEqual(buildNext(1, 2, 2, 2), { step: 1, pass: 2, done: true }, 'The last block finishes the scene');
  assert.deepEqual(buildNext(0, 1, 1, 2), { step: 1, pass: 1, done: false }, 'One repeat moves straight on');
  assert.deepEqual(buildNext(0, 1, 0, 2), { step: 1, pass: 1, done: false }, 'A nonsense repeat count still advances');
});

// A run of microphone levels, 20 ms apart, the way the browser samples them.
const run = (holdMs: number, levels: number[], from = 0) =>
  levels.reduce((state, level, index) => listenStep(state, level, from + index * 20, holdMs), listenStart(from));
const steady = (count: number, level: number) => Array.from({ length: count }, () => level);
// The room is measured over the first 300 ms of the wait, so every run starts with that.
const room = steady(16, 0.004);

test('the microphone ends the wait only after speech, and only after the held silence', () => {
  const holdMs = 500;
  assert.equal(run(holdMs, room).phase, 'quiet', 'Room noise alone is never taken for a line');
  assert.equal(run(holdMs, [...room, ...steady(200, 0.003)]).phase, 'quiet', 'An actor who never speaks is waited for');
  assert.equal(run(holdMs, [...room, ...steady(50, 0.2)]).phase, 'speaking', 'Speech that has not stopped is not a finished line');
  assert.equal(run(holdMs, [...room, ...steady(50, 0.2), ...steady(20, 0.003)]).phase, 'speaking', 'Silence shorter than the hold does not end the line');
  assert.equal(run(holdMs, [...room, ...steady(50, 0.2), ...steady(30, 0.003)]).phase, 'done', 'Silence past the hold ends it');
});

test('a hold set for an actor who pauses waits that much longer', () => {
  const line = [...room, ...steady(50, 0.2)];
  const pause = steady(100, 0.003);
  assert.equal(run(500, [...line, ...pause]).phase, 'done', 'Two seconds of silence ends a half second hold');
  assert.equal(run(5000, [...line, ...pause]).phase, 'speaking', 'The same pause is still the actor thinking on a five second hold');
  assert.equal(run(5000, [...line, ...pause, ...steady(50, 0.2), ...steady(300, 0.003)]).phase, 'done', 'They speak again, then stop for good');
});

test('a spike is not speech, and a loud room raises its own floor', () => {
  assert.equal(run(500, [...room, 0.2, 0.2, ...steady(40, 0.003)]).phase, 'quiet', 'A cough of 40 ms never starts the line');
  const noisy = steady(16, 0.05);
  assert.equal(run(500, [...noisy, ...steady(50, 0.06)]).phase, 'quiet', 'A fan at the same level as the room is still the room');
  assert.equal(run(500, [...noisy, ...steady(50, 0.3), ...steady(30, 0.05)]).phase, 'done', 'Speech over the fan is heard, and the fan is the silence it ends in');
});

test('the burst a microphone gives as it opens is not taken for the room', () => {
  // Measured on iOS: silence, one loud frame, then the room. The burst must not set the floor,
  // or ordinary speech never clears it and the wait is never ended.
  const opening = [0, 0.36, 0.33, 0.07, 0.07, 0.07, 0.07, ...steady(9, 0.07)];
  assert.equal(run(500, [...opening, ...steady(50, 0.2), ...steady(30, 0.05)]).phase, 'done');
});

test('an actor with the first line is heard against the room measured before the scene began', () => {
  const room = run(500, [...steady(8, 0), ...steady(8, 0.03)]).floor;
  const line = [...steady(40, 0.25), ...steady(40, 0.03)];
  assert.equal(run(500, line).phase, 'quiet', 'Measured on their own voice, the line is never heard');
  const heard = line.reduce((state, level, index) => listenStep(state, level, index * 20, 500), listenFrom(0, room));
  assert.equal(heard.phase, 'done');
});

test('the wait is only ended once', () => {
  const ended = run(500, [...room, ...steady(50, 0.2), ...steady(30, 0.003)]);
  assert.equal(listenStep(ended, 0.9, 10_000, 500).phase, 'done', 'A door slamming after the line does not reopen it');
});

test('what the actor said is matched against the line, not spelled against it', () => {
  const line = 'Then say the rest of it.';
  assert.equal(lineMatch('Then say the rest of it.', line).verdict, 'said');
  assert.equal(lineMatch('SPEAKER_00: then say the rest of it', line).verdict, 'said', 'The server labels the speaker and drops the full stop');
  assert.equal(lineMatch('Then, say the rest of it!', line).verdict, 'said', 'Punctuation and case are not performance');
  assert.equal(lineMatch('Then say the rest', line).verdict, 'partial', 'Half a line is a dried line, not a wrong one');
  assert.equal(lineMatch('I wanted to wait', line).verdict, 'different', 'A different line of the scene is different');
  assert.equal(lineMatch('', line).verdict, 'different', 'Silence transcribed as nothing is not the line');
  assert.equal(lineMatch('Then say the rest of it, please, I am asking you', line).verdict, 'said', 'An actor who adds words still said the line');
  assert.equal(lineMatch('anything', '').verdict, 'said', 'An empty expected line cannot be got wrong');
  assert.ok(lineMatch('Then say the rest of it.', line).score > lineMatch('Then say the rest', line).score);
});
