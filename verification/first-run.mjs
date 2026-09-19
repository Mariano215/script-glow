import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { launch, until } from './lib.mjs';

// A new install: no profile file. Nothing here reaches a real service.
const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-first-run-'));
const file = path.join(temp, 'connections.json');
const exists = target => stat(target).then(() => true, () => false);
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'), connectionsFile: file, secretsFile: path.join(temp, 'secrets.json'), connections: DEFAULT_CONNECTIONS, firstRunScreen: true,
  // Connect tests the address it just filled in; a voice list lets that check show a real result.
  serviceFetch: async url => { if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify(['One', 'Two'])); throw new Error(`nothing is listening on ${url}`); } });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
try {
  const page = await browser.newPage();
  const welcome = () => page.evaluate(() => !!document.querySelector('dialog.first-run[open]'));

  await page.goto(`${base}/#rehearsal`);
  await until(page, 'the welcome', () => !!document.querySelector('dialog.first-run[open]'));
  assert.equal(await page.locator('dialog.first-run [data-choice]').count(), 3);

  // A paid service: Settings opens with OpenAI chosen, and nothing is saved until the actor saves.
  await page.click('[data-choice="hosted"]');
  await until(page, 'the Settings screen', () => location.hash === '#settings' && !!document.querySelector('#service-engine-openai:checked'));
  assert.equal(await exists(file), false, 'Choosing a paid service does not save by itself');

  // Next launch still shows the welcome, because nothing was saved. Skip saves the defaults.
  await page.goto(`${base}/#rehearsal`); await page.reload();
  await until(page, 'the welcome again', () => !!document.querySelector('dialog.first-run[open]'));
  await page.click('[data-choice="skip"]');
  for (let i = 0; i < 100 && !await exists(file); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await exists(file), true, 'Skip writes the profile');
  await page.reload();
  await page.waitForSelector('.topbar');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await welcome(), false, 'The welcome shows once');

  // Own voice server, entered by hand: a middle step asks for the address first; declining it
  // still lands on Settings with Chatterbox chosen, and focus goes straight to the address field.
  await rm(file);
  await page.reload();
  await until(page, 'the welcome after the profile is removed', () => !!document.querySelector('dialog.first-run[open]'));
  await page.click('[data-choice="own"]');
  await until(page, 'the voice server address step', () => !!document.querySelector('#first-run-host'));
  await page.click('[data-action="first-run-manual"]');
  await until(page, 'Settings on Chatterbox', () => location.hash === '#settings' && !!document.querySelector('#service-engine-chatterbox:checked'));
  await until(page, 'focus on the Chatterbox address field', () => document.activeElement?.id === 'service-chatterbox');
  assert.match(await page.locator('label[for="service-chatterbox"]').first().textContent(), /Your Chatterbox server address/);
  console.log('PASS: the welcome shows for a new install, leads to Settings, and Skip saves the defaults once.');

  // Own voice server, worked entirely from the keyboard: focus starts on the address field, an
  // invalid entry shows an error and returns focus there, and Enter submits like clicking Connect.
  await rm(file, { force: true });
  await page.reload();
  await until(page, 'the welcome after the profile is removed again', () => !!document.querySelector('dialog.first-run[open]'));
  await page.click('[data-choice="own"]');
  await until(page, 'the voice server address step again', () => !!document.querySelector('#first-run-host'));
  await until(page, 'focus starting on the voice server address field', () => document.activeElement?.id === 'first-run-host');
  await page.keyboard.type('not a host');
  await page.keyboard.press('Enter');
  await until(page, 'the inline error after an invalid address', () => !document.querySelector('.first-run-error')?.hidden);
  await until(page, 'focus back on the address field after an invalid address', () => document.activeElement?.id === 'first-run-host');
  await page.fill('#first-run-host', '10.0.0.5');
  await page.keyboard.press('Enter');
  await until(page, 'Settings filled in from one address entered by keyboard', () => location.hash === '#settings'
    && document.querySelector('#service-chatterbox')?.value === 'http://10.0.0.5:8095'
    && document.querySelector('#service-ollama')?.value === 'http://10.0.0.5:11434'
    && document.querySelector('#service-whisperx')?.value === 'http://10.0.0.5:8010');
  // Connect saves the three addresses at once, through the same save path Settings now always
  // uses, so the profile exists and the welcome will not show again on the next launch.
  for (let i = 0; i < 100 && !await exists(file); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await exists(file), true, 'Connect saves the profile by itself');
  const connected = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(connected.chatterbox.url, 'http://10.0.0.5:8095');
  assert.equal(connected.ollama.url, 'http://10.0.0.5:11434');
  assert.equal(connected.whisperx.url, 'http://10.0.0.5:8010');
  assert.equal((await (await fetch(`${base}/api/connections`)).json()).firstRun, false, 'firstRun is false once Connect has saved the profile');
  // Connect tests the address it just filled in; the result belongs next to the Chatterbox
  // address it actually tested, not silently attached to a "voice" row nothing displays.
  const chatterboxResult = () => document.querySelector('label[for="service-chatterbox"]')?.closest('.setting-row')?.querySelector('.service-result')?.textContent;
  await until(page, 'the Chatterbox row to show the check it ran on connect', () => !!document.querySelector('label[for="service-chatterbox"]')?.closest('.setting-row')?.querySelector('.service-result')?.textContent);
  assert.match(await page.evaluate(chatterboxResult), /2 voices/);
  console.log('PASS: one voice-server address fills in Chatterbox, Ollama and WhisperX and saves them at once, and Enter works the whole step.');

  // A Skip that cannot save must not vanish silently. The connections file's folder is a plain
  // file here, so the write fails, and the actor should still see an error on screen.
  const blockedDir = path.join(temp, 'blocked');
  await writeFile(blockedDir, '');
  const blockedFile = path.join(blockedDir, 'connections.json');
  const blockedApp = createApp({ cacheDir: path.join(temp, 'blocked-cache'), projectsDir: path.join(temp, 'blocked-projects'), previewDir: path.join(temp, 'blocked-previews'), connectionsFile: blockedFile, secretsFile: path.join(temp, 'blocked-secrets.json'), connections: DEFAULT_CONNECTIONS, firstRunScreen: true,
    serviceFetch: async url => { throw new Error(`nothing is listening on ${url}`); } });
  const blockedServer = blockedApp.listen(0, '127.0.0.1');
  await new Promise(resolve => blockedServer.once('listening', resolve));
  const blockedBase = `http://127.0.0.1:${blockedServer.address().port}`;
  try {
    const blockedPage = await browser.newPage();
    await blockedPage.goto(`${blockedBase}/#rehearsal`);
    await until(blockedPage, 'the welcome on the blocked install', () => !!document.querySelector('dialog.first-run[open]'));
    await blockedPage.click('[data-choice="skip"]');
    // ".voices-offline" is a separate, always-present notice while no voice service answers;
    // excluding it isolates the one flash() puts up for the failed save.
    await until(blockedPage, 'the failed-Skip error', () => !!document.querySelector('.notice.error:not(.voices-offline)'));
    assert.equal(await exists(blockedFile), false, 'The failed save left no file behind');
    console.log('PASS: a failed Skip shows its error instead of vanishing.');
  } finally {
    await new Promise(resolve => blockedServer.close(resolve));
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
