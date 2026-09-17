import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';

// Real UI and settings API, isolated disk library and profile. No production data.
const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-settings-'));
const file = path.join(temp, 'connections.json');
const source = 'SCENE 1\n\nDAVID: I waited up for you.\n\nELIZABETH: You did not have to.\n';
const preferences = { source, name: 'Settings', role: 'DAVID', cast: {}, guesses: {}, genders: {}, manualVoices: {}, sceneId: 'scene-1', gap: 0, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
const seen = [];
// A registered personal voice makes the profile reply carry a preview URL that is not part of the
// profile itself. Sending it back used to be refused as an unknown key, so it is reproduced here.
const previews = path.join(temp, 'previews');
await mkdir(previews, { recursive: true });
await writeFile(path.join(previews, 'actor-preview.wav'), Buffer.alloc(64));
const withVoice = { ...DEFAULT_CONNECTIONS, casting: { preferredActorVoice: 'MyVoice', aliases: {} } };
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: previews, connectionsFile: file, secretsFile: path.join(temp, 'secrets.json'), connections: withVoice, serviceFetch: async url => {
  seen.push(url);
  if (url.startsWith('http://127.0.0.1:9100') && url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify(['Stock-Amber', 'Stock-Ash', 'MyVoice']));
  // A fake OpenAI and Claude. Nothing reaches the internet.
  if (url === 'https://api.anthropic.com/v1/models') return Buffer.from('{"data":[]}');
  if (url === 'https://api.openai.com/v1/models') return Buffer.from(JSON.stringify({ data: [{ id: 'gpt-4o-mini-tts' }] }));
  if (url === 'https://api.openai.com/v1/audio/speech') return Buffer.alloc(4800, 1);
  if (url.endsWith('/api/tags')) return Buffer.from(JSON.stringify({ models: [{ name: 'gemma:2b' }] }));
  // Port 9999 stands for an address with nothing behind it.
  if (url.endsWith('/health') && !url.includes(':9999')) return Buffer.from('{}');
  throw new Error(`nothing is listening on ${url}`);
} });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  assert.equal((await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences }) })).status, 201);
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })).newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const until = async (what, check, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await page.evaluate(check)) return;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}: ${await page.evaluate(() => document.querySelector('.settings-screen .savebar-message')?.textContent || 'no message on the page')}`);
      await page.waitForTimeout(250);
    }
  };
  const type = (id, value) => page.evaluate(([selector, text]) => {
    // The voice engine is a set of choice cards: choosing one is clicking it.
    if (selector === '#service-engine') { document.querySelector(`#service-engine-${text}`).click(); return; }
    const input = document.querySelector(selector);
    input.value = text;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, value]);
  const press = action => page.evaluate(name => document.querySelector(`[data-action="${name}"]`).click(), action);
  const check = service => page.evaluate(name => document.querySelector(`[data-action="test-service"][data-service="${name}"]`).click(), service);
  const keyStatus = provider => page.evaluate(name => document.querySelector(`[data-provider="${name}"]`)?.closest('.key-item')?.textContent ?? '', provider);
  const addKey = provider => page.evaluate(name => document.querySelector(`[data-action="edit-key"][data-provider="${name}"]`).click(), provider);
  const resultFor = service => page.evaluate(name => {
    const button = document.querySelector(`[data-action="test-service"][data-service="${name}"]`);
    return button?.closest('.service-check')?.querySelector('.service-result')?.textContent ?? '';
  }, service);

  await page.goto(base);
  await until('the project to save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await page.evaluate(() => { location.hash = '#settings'; });
  await until('the settings screen', () => { const screen = document.querySelector('.settings-screen'); return !!screen && !screen.hidden; });
  assert.equal(await page.locator('#service-chatterbox').inputValue(), DEFAULT_CONNECTIONS.chatterbox.url, 'It opens showing the addresses in use');
  assert.equal(await page.locator('[data-action="edit"]').isVisible(), false, 'Settings is settings: Edit script is not offered here');

  // Testing says which server answered and which did not, and never asks for speech.
  await type('#service-chatterbox', 'http://127.0.0.1:9100');
  assert.equal(await page.locator('[data-action="test-service"]').count(), 3, 'Every server can be checked on its own');
  await check('chatterbox');
  await until('the voice check to finish', () => !!document.querySelector('[data-service="chatterbox"]')?.closest('.service-check')?.querySelector('.service-result'));
  assert.match(await resultFor('chatterbox'), /3 voices/, 'The voice server says how many voices it already has');
  assert.ok((await page.evaluate(() => document.querySelector('[data-service="chatterbox"]')?.className)).includes('is-ok'), 'The button turns green when the server answers');
  assert.equal(await resultFor('names'), '', 'Checking one card leaves the others alone');
  await check('names');
  await until('the AI check to finish', () => !!document.querySelector('[data-service="names"]')?.closest('.service-check')?.querySelector('.service-result'));
  assert.match(await resultFor('names'), /1 models installed: gemma:2b/, 'The AI server lists what is installed');
  assert.match(await resultFor('chatterbox'), /3 voices/, 'The first result is still there');
  // Point transcription at an address with nothing behind it, to see a failure reported in place.
  await type('#service-whisperx', 'http://127.0.0.1:9999');
  await check('whisperx');
  await until('the transcription check to finish', () => !!document.querySelector('[data-service="whisperx"]')?.closest('.service-check')?.querySelector('.service-result'));
  assert.ok((await page.evaluate(() => document.querySelector('[data-service="whisperx"]')?.className)).includes('is-bad'), 'The button turns red when nothing answers');
  await type('#service-whisperx', DEFAULT_CONNECTIONS.whisperx.url);
  assert.equal(seen.some(url => url.includes('/v1/tts')), false, 'Testing never makes speech');
  assert.equal(seen.some(url => url.includes('/api/pull')), false, 'Testing never downloads a model');
  
  // Nothing is written until Save is pressed.
  await assert.rejects(() => readFile(file, 'utf8'), /ENOENT/, 'A test alone writes no profile');
  // The page counts as changed while you type, before you leave the field.
  await page.evaluate(() => document.querySelector('[data-action="settings-jump"][data-target="set-advanced"]').click());
  // Advanced is short and last: the menu still marks it once the page has gone as far as it can.
  await until('Advanced to be marked', () => document.querySelector('[data-target="set-advanced"]')?.hasAttribute('aria-current'));
  assert.equal(await page.locator('#set-advanced details').getAttribute('open'), '', 'Choosing Advanced opens it');
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.querySelector('[data-target="set-advanced"]').hasAttribute('aria-current')), true, 'At the bottom of the page the last section stays marked');
  await page.locator('#service-name').fill('Friend laptop');
  assert.equal(await page.locator('.settings-savebar').isVisible(), true, 'The save bar appears as you type');
  assert.equal(await page.evaluate(() => document.querySelector('[data-screen="settings"]').classList.contains('has-unsaved')), true, 'The Settings tab shows unsaved changes');
  await type('#service-name', 'Friend laptop');
  await press('save-services');
  await until('the save to land', () => /Saved\./.test(document.querySelector('.settings-screen .savebar-message')?.textContent ?? ''));
  await until('the saved message to fade', () => document.querySelector('.settings-savebar')?.hidden === true, 15000);
  const written = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(written.name, 'Friend laptop');
  assert.equal(written.chatterbox.url, 'http://127.0.0.1:9100');
  assert.equal(Object.hasOwn(written, 'apiKey'), false, 'The profile has nowhere to put a key');

  // The app is now using the saved server, so its voices are the ones offered.
  await until('the new voices to be read', () => !!document.querySelector('.local-badge')?.textContent?.includes('Voices connected'));
  await page.evaluate(() => { location.hash = '#cast'; });
  await until('the cast screen', () => { const screen = document.querySelector('.cast-screen'); return !!screen && !screen.hidden; });
  assert.ok((await page.locator('[data-cast] option').allInnerTexts()).some(text => /Amber|Ash|MyVoice/i.test(text)), 'Casting offers the voices from the server just saved');

  // A refused address keeps the working profile and says why.
  await page.evaluate(() => { location.hash = '#settings'; });
  await until('the settings screen again', () => { const screen = document.querySelector('.settings-screen'); return !!screen && !screen.hidden; });
  await type('#service-chatterbox', 'http://user:secret@127.0.0.1:9100');
  await press('save-services');
  await until('the refusal', () => /credentials/i.test(document.querySelector('.settings-screen .savebar-message')?.textContent ?? ''));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).chatterbox.url, 'http://127.0.0.1:9100', 'The profile on disk is the one that worked');
  await press('reset-services');
  await until('the form to go back to what is saved', () => document.querySelector('#service-chatterbox')?.value === 'http://127.0.0.1:9100');

  // A key is saved on its own, shown only as a hint, and never lands in the profile or the page.
  const key = 'sk-verify-0123456789abcdef4f2a';
  assert.equal(await page.locator('#key-openai').count(), 0, 'The key box opens only when asked');
  await addKey('openai');
  await type('#key-openai', key);
  await press('save-key');
  await until('the key to save', () => /key saved/.test(document.querySelector('.settings-screen .savebar-message')?.textContent ?? ''));
  assert.match(await keyStatus('openai'), /✓ sk-…4f2a/);
  assert.equal(await page.locator('#key-openai').count(), 0, 'The typed key is gone once saved');
  assert.equal((await page.content()).includes(key), false, 'The key is not anywhere in the page');
  assert.equal(JSON.parse(await readFile(path.join(temp, 'secrets.json'), 'utf8')).openai, key);
  assert.equal((await readFile(file, 'utf8')).includes(key), false, 'The profile never holds the key');
  await page.reload();
  await until('the settings screen after reload', () => /✓ sk-…4f2a/.test(document.querySelector('[data-provider="openai"]')?.closest('.key-item')?.textContent ?? ''));

  // Hosted voices: pick OpenAI, see the warning, test the key, save, and the cast uses its voices.
  await type('#service-engine', 'openai');
  await until('the hosted warning', () => /sent to OpenAI/.test(document.querySelector('#set-voices .callout')?.textContent ?? ''));
  assert.match(await page.locator('.engine-card.is-selected').innerText(), /Key saved/);
  assert.match(await page.locator('.settings-savebar').innerText(), /unsaved changes/, 'The save bar says something changed');
  await check('voice');
  await until('the key check', () => !!document.querySelector('[data-service="voice"]')?.closest('.service-check')?.querySelector('.service-result'));
  assert.match(await resultFor('voice'), /Key accepted\. 13 voices\./);
  await press('save-services');
  await until('the engine save', () => /Saved\./.test(document.querySelector('.settings-screen .savebar-message')?.textContent ?? ''));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).voice.engine, 'openai');
  await until('the hosted pill', () => /HOSTED VOICES · OPENAI/.test(document.querySelector('.private-pill')?.textContent ?? ''));
  assert.match(await page.locator('.sidebar-bottom').innerText(), /Script lines go to OpenAI/);
  await page.evaluate(() => { location.hash = '#cast'; });
  await until('hosted voices on the cast screen', () => [...document.querySelectorAll('[data-cast] option')].some(option => /Coral · female/.test(option.textContent ?? '')));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-cast]')].every(select => select.value.startsWith('openai:'))), true, 'Every part is recast with OpenAI voices');
  assert.equal(await page.evaluate(() => document.querySelector('[data-action="voice-preview"]')?.disabled), false, 'A hosted voice can be previewed');
  await page.evaluate(() => { location.hash = '#rehearsal'; });
  await until('the cost note', () => /characters to OpenAI, which charges/.test(document.querySelector('.render-hint')?.textContent ?? ''));
  await page.evaluate(() => { location.hash = '#settings'; });
  // Name guesses from Claude: pick it, see what is sent, test the key.
  await type('#service-names-engine', 'anthropic');
  await until('the names note', () => /Anthropic \(Claude\) charges a very small amount/.test(document.querySelector('#set-names')?.textContent ?? ''));
  assert.match(await page.locator('#set-names .callout').innerText(), /No Anthropic \(Claude\) key yet/);
  assert.equal(await page.locator('#service-ollama').count(), 0, 'The Ollama address is not asked for when Claude guesses');
  assert.equal(await page.locator('#service-names-model').getAttribute('placeholder'), 'claude-opus-5 (recommended)');
  await addKey('anthropic');
  await type('#key-anthropic', 'sk-ant-verify-0123456789abcd');
  await page.evaluate(() => document.querySelector('[data-action="save-key"][data-provider="anthropic"]').click());
  await until('the Claude key', () => /✓ sk-…abcd/.test(document.querySelector('[data-provider="anthropic"]')?.closest('.key-item')?.textContent ?? ''));
  await check('names');
  await until('the names check', () => /Key accepted/.test(document.querySelector('[data-service="names"]')?.closest('.service-check')?.querySelector('.service-result')?.textContent ?? ''));
  await type('#service-names-engine', 'ollama');
  await type('#service-engine', 'chatterbox');
  await press('save-services');
  await until('the switch back', () => /PRIVATE STUDIO/.test(document.querySelector('.private-pill')?.textContent ?? ''));

  await page.evaluate(() => { location.hash = '#settings'; document.querySelector('[data-action="remove-key"][data-provider="openai"]').click(); });
  await until('the key to be removed', () => /No key/.test(document.querySelector('[data-provider="openai"]')?.closest('.key-item')?.textContent ?? ''));

  assert.deepEqual(errors, []);
  console.log('PASS: settings read, each card tested on its own without making speech, saved atomically, voices refreshed; a bad address is refused and the working profile stands; a key is stored apart, shown only as a hint, and removed; OpenAI voices are chosen, warned about, tested, used for casting and priced before a render; Claude can guess names instead of Ollama.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
