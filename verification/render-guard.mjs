import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { encodeWav } from '../server/audio.js';

// Switching scenes while audio is being made must ask before cancelling. Isolated data, slow fake TTS.
const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-guard-'));
const source = [1, 2].map(scene => `SCENE ${scene}\n\n${Array.from({ length: 6 }, (_, line) => `${line % 2 ? 'ANNA' : 'BEN'}: Scene ${scene}, line ${line + 1}.\n`).join('\n')}`).join('\n');
const preferences = { source, name: 'Guard check', role: 'ANNA', cast: { ANNA: 'Stock-Mica', BEN: 'Stock-Ash' }, guesses: {}, genders: {}, manualVoices: { ANNA: true, BEN: true }, sceneId: 'scene-1', gap: 0, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
const wav = encodeWav(Buffer.alloc(4800, 8));
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'), connections: DEFAULT_CONNECTIONS, serviceFetch: async url => {
  if (url.endsWith('/health')) return Buffer.from('{}');
  if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify(['Stock-Mica', 'Stock-Ash']));
  if (url.endsWith('/v1/tts')) { await new Promise(resolve => setTimeout(resolve, 400)); return wav; }
  throw new Error(`Unexpected service call ${url}`);
} });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  assert.equal((await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences }) })).status, 201);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const dialogs = [];
  let accept = false;
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void (accept ? dialog.accept() : dialog.dismiss()); });
  await page.goto(`${base}/#rehearsal`);
  await page.waitForFunction(() => !document.querySelector('[data-action="render"]')?.disabled);
  await page.locator('[data-action="render"]').click();
  await page.waitForFunction(() => /Making audio/.test(document.querySelector('#player-status')?.textContent || ''));
  const jobs = async () => page.evaluate(() => document.querySelector('#player-status')?.textContent || '');

  // Declining keeps the render running and the scene selected.
  await page.locator('[data-action="scene"][data-id="scene-2"]').click();
  assert.equal(dialogs.length, 1, 'A confirmation must appear before cancelling');
  assert.match(await jobs(), /Making audio/);
  assert.equal(await page.locator('[data-action="scene"].selected').getAttribute('data-id'), 'scene-1');
  await page.locator('#scene-select').selectOption('scene-2');
  assert.equal(dialogs.length, 2);
  assert.equal(await page.locator('#scene-select').inputValue(), 'scene-1');
  assert.match(await jobs(), /Making audio/);

  // Clicking the scene that is already selected never cancels.
  await page.locator('[data-action="scene"][data-id="scene-1"]').click();
  assert.equal(dialogs.length, 2);
  assert.match(await jobs(), /Making audio/);

  // Accepting switches scenes and stops the job.
  accept = true;
  await page.locator('[data-action="scene"][data-id="scene-2"]').click();
  assert.equal(dialogs.length, 3);
  await page.waitForFunction(() => document.querySelector('[data-action="scene"].selected')?.dataset.id === 'scene-2');
  assert.doesNotMatch(await jobs(), /Making audio/);
  console.log('PASS: scene switches during audio ask first; declining keeps the job, accepting cancels it.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
