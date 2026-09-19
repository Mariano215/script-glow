import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createG2P } from '../server/kokoro/g2p.js';

// A small word list holding only what these tests need, and a fallback that answers like the BART
// model did in the spike (docs/research/2026-09-19-kokoro/twenty-lines.md), so no model is loaded.
const gold = JSON.parse(readFileSync(new URL('./fixtures/g2p-lexicon.json', import.meta.url), 'utf8'));
const lines = JSON.parse(readFileSync(new URL('./fixtures/g2p-lines.json', import.meta.url), 'utf8'));
const SPOKEN_BY_FALLBACK = { Siobhan: 'sˈObhˌɑn', Nguyen: 'əŋɡˈIən', Marcus: 'mˈɑɹkəs', Kavanagh: 'kˈɑvənˌɑ', Elena: 'ˈilənə', Shi: 'ʃˈi', Vawn: 'vˈɔn', constructor: 'kənstɹˈʌktəɹ', Zoe: 'zˈOi' };
function g2p() {
  const asked = [];
  const run = createG2P({ gold, silver: {}, fallback: async word => { asked.push(word); return Object.hasOwn(SPOKEN_BY_FALLBACK, word) ? SPOKEN_BY_FALLBACK[word] : ''; } });
  return Object.assign(run, { asked });
}

test('the 20 actor lines from the spike come out as they did there', async () => {
  const run = g2p();
  for (const { text, phonemes } of lines) assert.equal(await run(text), phonemes, text);
  assert.deepEqual(run.asked, ['Siobhan', 'Nguyen', 'Marcus', 'Kavanagh', 'Elena'], 'Only names reach the fallback');
});

test('stems and clitics: -ed, -s, -ing and I\'d\'ve are built from the word list', async () => {
  const run = g2p();
  assert.equal(await run('asked'), 'ˈæskt');
  assert.equal(await run('turns'), 'tˈɜɹnz');
  assert.equal(await run('going'), 'ɡˈOɪŋ');
  assert.equal(await run('promised'), 'pɹˈɑməst');
  assert.equal(await run("I'd've"), 'ˌIdəv');
  assert.deepEqual(run.asked, []);
});

test('clock times, and hyphenated words read as two words', async () => {
  const run = g2p();
  assert.equal(await run('At 3:05 or 12:00.'), 'æt θɹˈi ˈO fˈIv ɔɹ twˈɛlv əklˈɑk.');
  assert.equal(await run('well-known'), 'wˈɛl nˈOn');
});

test('ALL CAPS: a known word is read, a short unknown one is spelled with the stress last', async () => {
  const run = g2p();
  assert.equal(await run('WHAT DID YOU SAY?'), 'wˌʌt dˈɪd ju sˈA?');
  assert.equal(await run('FBI'), 'ˌɛfbˌiˈI');
  assert.equal(await run('MARCUS!'), 'mˈɑɹkəs!');
});

test('a Say it like respelling is stressed on its capitals', async () => {
  const run = g2p();
  assert.equal(await run('shi-VAWN, please.'), 'ʃivˈɔn, plˈiz.');
  assert.deepEqual(run.asked, ['Shi', 'Vawn']);
});

test('a possessive respelling keeps its stress and takes the possessive like any word', async () => {
  const run = g2p();
  assert.equal(await run("shi-VAWN's keys."), 'ʃivˈɔnz kˈiz.');
  assert.equal(await run("shi-VAWN' key."), 'ʃivˈɔn kˈi.');
  assert.deepEqual(run.asked, ['Shi', 'Vawn', 'Shi', 'Vawn']);
});

test('words spelled alike take their DEFAULT reading', async () => {
  assert.equal(await g2p()('I read it.'), 'ˌI ɹˈid ɪt.');
});

test('odd input: accents are dropped, and a word named like an object property still works', async () => {
  const run = g2p();
  assert.equal(await run('Zoë'), 'zˈOi');
  assert.equal(await run('constructor'), 'kənstɹˈʌktəɹ');
  assert.deepEqual(run.asked, ['Zoe', 'constructor']);
});
