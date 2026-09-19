import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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
  serviceFetch: async url => { throw new Error(`nothing is listening on ${url}`); } });
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

  // Own voice server: Settings opens on Chatterbox.
  await rm(file);
  await page.reload();
  await until(page, 'the welcome after the profile is removed', () => !!document.querySelector('dialog.first-run[open]'));
  await page.click('[data-choice="own"]');
  await until(page, 'Settings on Chatterbox', () => location.hash === '#settings' && !!document.querySelector('#service-engine-chatterbox:checked'));
  console.log('PASS: the welcome shows for a new install, leads to Settings, and Skip saves the defaults once.');

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
