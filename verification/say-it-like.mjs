// Browser check for Say it like: the respelling is what the voice engine is sent (here a fake
// Chatterbox), it is saved with the project, and changing it re-makes only the lines with the name.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { choose, launch, preferences, press, tone, until } from './lib.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-say-it-like-'));
const spoken = [];
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'), connectionsFile: path.join(temp, 'connections.json'), secretsFile: path.join(temp, 'secrets.json'), connections: DEFAULT_CONNECTIONS,
  serviceFetch: async (url, options = {}) => {
    if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify(['Stock-Amber', 'Stock-Ash', 'Stock-Mica']));
    if (url.endsWith('/health')) return Buffer.from('{}');
    if (url.endsWith('/v1/tts')) { spoken.push(JSON.parse(options.body).text); return tone(0.3); }
    throw new Error(`nothing is listening on ${url}`);
  } });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const source = 'SCENE 1\n\nMARCUS: Siobhan, listen to me.\n\nSIOBHAN: No.\n\nMARCUS: Fine. Go.\n';
const browser = await launch();
try {
  assert.equal((await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: preferences(source, { role: 'MARCUS' }) }) })).status, 201);
  const page = await browser.newPage();
  const makeAudio = async () => {
    await page.goto(`${base}/#rehearsal`);
    await until(page, 'the Make audio button', () => document.querySelector('[data-action="render"]') && !document.querySelector('[data-action="render"]').disabled);
    await press(page, '[data-action="render"]');
    await until(page, 'the audio', () => /Both tracks ready/.test(document.body.textContent));
  };
  await page.goto(`${base}/#cast`);
  await until(page, 'the Say it like box', () => !!document.querySelector('[data-say-as="SIOBHAN"]'));
  await choose(page, '[data-say-as="SIOBHAN"]', 'shi-VAWN');
  await makeAudio();
  assert.ok(spoken.includes('shi-VAWN, listen to me.'), spoken.join(' | '));
  assert.equal(spoken.some(text => /siobhan/i.test(text)), false, 'The name as written is never sent');
  const first = spoken.length;

  // Saved with the project: after a reload the box still holds it.
  await until(page, 'the project save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await page.reload();
  await page.goto(`${base}/#cast`);
  await until(page, 'the project to open', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await until(page, 'the saved respelling', () => document.querySelector('[data-say-as="SIOBHAN"]')?.value === 'shi-VAWN');

  // A new respelling re-makes only the line with the name; the others come from the line cache.
  await choose(page, '[data-say-as="SIOBHAN"]', 'shiv-AWN');
  await makeAudio();
  assert.deepEqual(spoken.slice(first), ['shiv-AWN, listen to me.']);
  console.log('PASS: Say it like changes what the engine is sent, is saved with the project, and re-makes only the lines with the name.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
