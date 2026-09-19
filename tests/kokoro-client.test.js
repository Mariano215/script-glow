import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKokoroClient } from '../server/kokoro/client.js';

const workerFile = fileURLToPath(new URL('./fixtures/fake-kokoro-worker.js', import.meta.url));
async function client(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'script-glow-kokoro-client-'));
  const made = createKokoroClient({ workerFile, args: [dir], ...options });
  t.after(async () => { made.stop(); await rm(dir, { recursive: true, force: true }); });
  return made;
}
// The fake worker's audio starts with its process id, then what it was asked to say.
const pid = pcm => pcm.readInt32LE(0);
const said = pcm => pcm.subarray(8, 8 + pcm.readInt32LE(4)).toString();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('lines are spoken one at a time, in the order asked, by one worker', async t => {
  const voices = await client(t);
  const results = await Promise.all([voices.speak('af_heart', 'slow first'), voices.speak('af_heart', 'second'), voices.speak('bm_george', 'third')]);
  assert.deepEqual(results.map(said), ['af_heart|slow first', 'af_heart|second', 'bm_george|third']);
  assert.equal(new Set(results.map(pid)).size, 1);
});

test('a line over the time limit fails with a plain message, and the next line still works', async t => {
  const voices = await client(t, { timeoutMs: 300 });
  await assert.rejects(voices.speak('af_heart', 'hang'), /more than 0.3 seconds on one line/);
  assert.equal(said(await voices.speak('af_heart', 'after')), 'af_heart|after');
});

test('a crash restarts the worker once and retries the line; a second crash fails it', async t => {
  const voices = await client(t);
  const before = await voices.speak('af_heart', 'before');
  const retried = await voices.speak('af_heart', 'crash-once');
  assert.equal(said(retried), 'af_heart|crash-once');
  assert.notEqual(pid(retried), pid(before), 'A new worker spoke the retried line');
  await assert.rejects(voices.speak('af_heart', 'crash'), /stopped twice on this line/);
  assert.equal(said(await voices.speak('af_heart', 'again')), 'af_heart|again');
});

test('an error from the worker is passed on and not retried', async t => {
  const voices = await client(t);
  await assert.rejects(voices.speak('af_heart', 'fail'), /could not read this line/);
});

test('an idle worker is stopped, and the next line starts a new one', async t => {
  const voices = await client(t, { idleMs: 200 });
  const first = pid(await voices.speak('af_heart', 'one'));
  await pause(600);
  assert.throws(() => process.kill(first, 0), { code: 'ESRCH' }, 'The idle worker has exited');
  assert.notEqual(pid(await voices.speak('af_heart', 'two')), first);
});
