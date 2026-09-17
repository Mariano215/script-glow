import test from 'node:test';
import assert from 'node:assert/strict';
import { cueRate, cueAt, stepCue, shouldWait, firstLetters, loopRange, buildTargets, buildEnd, buildNext } from '../src/playback.ts';

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
