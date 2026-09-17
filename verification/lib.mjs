// Shared set-up for the browser checks: a throwaway Script Glow with its own project and fake
// voice and AI services, a browser that works with or without Google Chrome, and waiting that
// polls from Node. Nothing here touches the real data folder or a running copy of the app.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { encodeWav } from '../server/audio.js';

export const MEDIA_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

// Real Chrome first; this headless build otherwise stalls on screenshots unless the chromium
// channel is used; the plain bundled browser is the last resort.
export async function launch(args = []) {
  for (const options of [{ channel: 'chrome' }, { channel: 'chromium' }, {}]) {
    try { return await chromium.launch({ headless: true, args, ...options }); } catch { /* try the next one */ }
  }
  throw new Error('No browser could be started. Run: npx playwright install chromium');
}

// This headless browser throttles page timers, so waiting is done by polling from Node.
export async function until(page, what, check, arg, timeout = 60000) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(check, arg)) return;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// Clicks through the page, because panels are redrawn on a poll and a locator can go stale.
export const press = (page, selector) => page.evaluate(target => {
  const element = document.querySelector(target);
  if (!element) throw new Error(`Nothing matches ${target}`);
  element.click();
}, selector);

// Sets a field the way a person does, ending with the change event the app listens for.
export const choose = (page, selector, value) => page.evaluate(([target, text]) => {
  const element = document.querySelector(target);
  if (!element) throw new Error(`Nothing matches ${target}`);
  if (element.type === 'checkbox') element.checked = text; else element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}, [selector, value]);

export const preferences = (source, extra = {}) => ({
  source, name: 'Check script', role: '', cast: {}, guesses: {}, genders: {}, manualVoices: {}, sceneId: 'scene-1',
  gap: 0, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full', ...extra,
});

// A short tone of the given length, so rendered scenes have real, playable audio.
export function tone(seconds = 1) {
  const pcm = Buffer.alloc(Math.round(seconds * 24000) * 2);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 3000), i);
  return encodeWav(pcm);
}

export const STOCK = ['MyVoice', 'Stock-Mica', 'Stock-Amber', 'Stock-Granite', 'Stock-Ash'];

// Starts an isolated app. `services` answers the voice/AI calls; `projects` are created first.
export async function studio({ projects = [], voices = STOCK, connections = {}, services, lineSeconds = 1 } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-check-'));
  const calls = [];
  const fallback = async url => {
    if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify({ voices }));
    if (url.endsWith('/health')) return Buffer.from('{}');
    if (url.endsWith('/v1/tts')) return tone(lineSeconds);
    if (url.endsWith('/api/tags')) return Buffer.from(JSON.stringify({ models: [] }));
    throw new Error(`nothing is listening on ${url}`);
  };
  const serviceFetch = async (url, options = {}) => {
    calls.push({ url, body: typeof options.body === 'string' ? options.body : undefined });
    return (services && await services(url, options)) ?? fallback(url, options);
  };
  const app = createApp({
    cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'),
    connectionsFile: path.join(temp, 'connections.json'), secretsFile: path.join(temp, 'secrets.json'),
    connections: { ...DEFAULT_CONNECTIONS, casting: { preferredActorVoice: 'MyVoice', aliases: {} }, ...connections },
    serviceFetch,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = [];
  for (const project of projects) {
    const response = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: project }) });
    if (response.status !== 201) throw new Error(`Project was not created: ${await response.text()}`);
    created.push(await response.json());
  }
  return {
    base, temp, calls, projects: created,
    close: async () => { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); },
  };
}

// Opens the studio and waits until the project is loaded and saved.
export async function openStudio(browser, base, { viewport = { width: 1440, height: 1000 }, hash = '', reducedMotion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${base}/${hash}`);
  await until(page, 'the project to load', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  return page;
}

export const fitsWidth = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
