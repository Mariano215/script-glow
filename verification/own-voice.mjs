import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { decodeWav, encodeWav } from '../server/audio.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';

// Record your own voice from Settings with a fake microphone, listen back, save it, and check that
// Chatterbox got a WAV, the sample is kept, and the microphone is let go. No production data.
const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-own-voice-'));
const file = path.join(temp, 'connections.json');
const previews = path.join(temp, 'previews');
const source = 'SCENE 1\n\nDAVID: I waited up for you.\n\nELIZABETH: You did not have to.\n';
const preferences = { source, name: 'Own voice', role: 'DAVID', cast: {}, guesses: {}, genders: {}, manualVoices: {}, sceneId: 'scene-1', gap: 0, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
const uploads = [];
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: previews, connectionsFile: file, secretsFile: path.join(temp, 'secrets.json'), connections: DEFAULT_CONNECTIONS, serviceFetch: async (url, options = {}) => {
  if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify({ voices: ['default', 'Stock-Amber', ...uploads.map(item => item.name)] }));
  if (url.includes('/v1/voices/')) { uploads.push({ name: url.split('/v1/voices/')[1].split('?')[0], body: options.body }); return Buffer.from('{}'); }
  if (url.endsWith('/health')) return Buffer.from('{}');
  if (url.endsWith('/v1/tts')) return encodeWav(Buffer.alloc(4800));
  throw new Error(`nothing is listening on ${url}`);
} });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  assert.equal((await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences }) })).status, 201);
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  browser = await chromium.launch({ channel: 'chrome', headless: true, args }).catch(() => chromium.launch({ headless: true, args }));
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })).newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const until = async (what, check, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await page.evaluate(check)) return;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}: ${await page.evaluate(() => document.querySelector('.settings-screen .settings-status')?.textContent || 'no message on the page')}`);
      await page.waitForTimeout(250);
    }
  };
  const press = action => page.evaluate(name => document.querySelector(`[data-action="${name}"]`).click(), action);
  // Count live microphone tracks, so the check can prove the microphone is released.
  await page.addInitScript(() => {
    window.liveMics = 0;
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await open(constraints);
      for (const track of stream.getAudioTracks()) { window.liveMics++; track.addEventListener('ended', () => window.liveMics--); const stop = track.stop.bind(track); track.stop = () => { if (track.readyState === 'live') window.liveMics--; stop(); }; }
      return stream;
    };
  });

  await page.goto(`${base}/#settings`);
  await until('the settings screen', () => !!document.querySelector('[data-action="voice-record"]'));
  // This headless build stalls on its first microphone request, so warm the fake device first.
  await page.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => stream.getTracks().forEach(track => track.stop())));
  assert.equal(await page.evaluate(() => window.liveMics), 0, 'The microphone is closed until Record is pressed');

  await press('voice-record');
  await until('recording to start', () => !!document.querySelector('.voice-live'));
  assert.equal(await page.evaluate(() => window.liveMics), 1);
  assert.match(await page.locator('.voice-script').innerText(), /scene partner can sound like me/, 'There is something to read');
  assert.equal(await page.evaluate(() => document.querySelector('[data-action="voice-stop"]').disabled), true, 'Stop waits for enough speech');
  await until('stop to become available', () => document.querySelector('[data-action="voice-stop"]')?.disabled === false, 20000);
  await page.waitForTimeout(1000);
  await press('voice-stop');
  await until('the recording to be ready', () => !!document.querySelector('[data-action="voice-save"]'));
  assert.equal(await page.evaluate(() => window.liveMics), 0, 'Stopping gives the microphone back');
  assert.match(await page.locator('.voice-recorder .field-label').innerText(), /NEW RECORDING · \d+\.\d SECONDS/);
  assert.equal(uploads.length, 0, 'Nothing is sent until you choose to use it');

  await press('voice-save');
  await until('the save', () => /Saved as MyVoice/.test(document.querySelector('#set-mine .callout')?.textContent ?? ''));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].name, 'MyVoice');
  const seconds = decodeWav(Buffer.from(uploads[0].body)).length / 2 / 24000;
  assert.ok(seconds >= 5 && seconds <= 30, `Chatterbox got ${seconds} seconds of WAV`);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).casting.preferredActorVoice, 'MyVoice', 'Your role now uses your voice');
  assert.ok((await stat(path.join(previews, 'actor-preview.wav'))).size > 44, 'Your sample is kept');
  await until('your sample player', () => !!document.querySelector('.personal-sample[src="/private-voice-preview.wav"]'));

  // Leaving the screen in the middle of a recording lets go of the microphone and keeps nothing.
  await press('voice-record');
  await until('a second recording', () => !!document.querySelector('.voice-live'));
  await page.evaluate(() => { location.hash = '#rehearsal'; });
  await until('the microphone to close', () => window.liveMics === 0);
  await page.evaluate(() => { location.hash = '#settings'; });
  await until('the settings screen again', () => !!document.querySelector('[data-action="voice-record"]'));
  assert.equal(uploads.length, 1);

  assert.deepEqual(errors, []);
  console.log('PASS: own voice recorded only on request, listened back, sent to Chatterbox as WAV, kept as your sample, chosen for your role; the microphone is released on stop and on leaving the screen.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
