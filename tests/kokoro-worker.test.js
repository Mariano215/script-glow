import test from 'node:test';
import assert from 'node:assert/strict';
import { cached, tokenize } from '../server/kokoro/worker.js';

test('a failed model or word-list load is not kept, so the next line loads again', async () => {
  const map = new Map();
  let tries = 0;
  const load = async () => { tries++; if (tries === 1) throw new Error('disk busy'); return 'loaded'; };
  await assert.rejects(cached(map, 'model', load), /disk busy/);
  assert.equal(await cached(map, 'model', load), 'loaded');
  assert.equal(await cached(map, 'model', load), 'loaded');
  assert.equal(tries, 2, 'A good load is kept');
});

test('a line longer than Kokoro can read is refused, not cut short', () => {
  const tokenizer = phonemes => ({ input_ids: { dims: [1, [...phonemes].length + 2] } });
  assert.deepEqual(tokenize(tokenizer, 'a'.repeat(510)).dims, [1, 512]);
  assert.throws(() => tokenize(tokenizer, 'a'.repeat(511)), /too long.*shorter/);
});
