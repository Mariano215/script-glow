// Browser check for the built-in voices: the welcome's first choice, the download progress in
// Settings, Ready, the voices in the cast, Remove, and Try again after a failed download. The model
// files and the worker are fakes, so nothing is downloaded from the internet and no model runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { launch, press, until } from './lib.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-builtin-'));
const file = path.join(temp, 'connections.json');
const voiceBytes = Buffer.alloc(1000, 1);
// The real Kokoro model ships as fp32 (kokoro/onnx/model.onnx); fp16 gives NaN audio on CPU.
const files = { 'kokoro/onnx/model.onnx': Buffer.alloc(3_000_000, 7), 'kokoro/voices/af_heart.bin': voiceBytes, 'kokoro/voices/bm_george.bin': voiceBytes };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = { version: 1, tag: 'check', base: 'https://example.invalid/kokoro', files: Object.entries(files).map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: sha(bytes) })) };
let offline = false;
// Each file arrives in small pieces with pauses, so there is progress to show.
const kokoroFetch = async url => {
  if (offline) throw new TypeError('fetch failed');
  const bytes = Object.entries(files).find(([name]) => url.endsWith(`/${name.replaceAll('/', '--')}`))?.[1];
  if (!bytes) return new Response('missing', { status: 404 });
  return new Response(new ReadableStream({ async start(controller) {
    for (let at = 0; at < bytes.length; at += 200_000) { controller.enqueue(bytes.subarray(at, at + 200_000)); await new Promise(resolve => setTimeout(resolve, 150)); }
    controller.close();
  } }));
};
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'), connectionsFile: file, secretsFile: path.join(temp, 'secrets.json'), modelsDir: path.join(temp, 'models'), connections: DEFAULT_CONNECTIONS, firstRunScreen: true,
  serviceFetch: async url => { throw new Error(`nothing is listening on ${url}`); },
  kokoro: { available: true, manifest, fetch: kokoroFetch, workerFile: fileURLToPath(new URL('../tests/fixtures/fake-kokoro-worker.js', import.meta.url)) } });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const ready = async () => (await (await fetch(`${base}/api/kokoro`)).json()).ready;
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${base}/#rehearsal`);
  await until(page, 'the welcome', () => !!document.querySelector('dialog.first-run[open]'));
  assert.equal(await page.locator('dialog.first-run [data-choice]').first().getAttribute('data-choice'), 'builtin', 'Built-in voices come first');
  assert.match(await page.locator('[data-choice="builtin"]').innerText(), /Recommended[\s\S]*Downloads about 3 MB once/);

  // Choosing it saves the engine at once and starts the download.
  await page.click('[data-choice="builtin"]');
  for (let i = 0; i < 100 && !await stat(file).catch(() => null); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).voice.engine, 'kokoro', 'The choice is saved without a Save button');
  await page.goto(`${base}/#settings`);
  await until(page, 'the download progress', () => !!document.querySelector('progress[data-kokoro-progress]'));
  await until(page, 'Ready', () => document.querySelector('label.engine-card:has(#service-engine-kokoro)')?.textContent.includes('Ready'));
  assert.equal(await ready(), true);

  // The cast offers the built-in voices.
  await page.goto(`${base}/#cast`);
  await until(page, 'built-in voices in the cast', () => [...document.querySelectorAll('select[data-cast] option')].some(option => option.value === 'kokoro:af_heart'));

  // Remove frees the space.
  await page.goto(`${base}/#settings`);
  await until(page, 'the Remove link', () => !!document.querySelector('[data-action="kokoro-remove"]'));
  await press(page, '[data-action="kokoro-remove"]');
  await until(page, 'Not downloaded', () => document.querySelector('label.engine-card:has(#service-engine-kokoro)')?.textContent.includes('Not downloaded'));
  assert.equal(await ready(), false);

  // A failed download says what happened and offers Try again, which then works.
  offline = true;
  await press(page, '[data-action="kokoro-download"]');
  await until(page, 'the failure message', () => /internet connection/.test(document.querySelector('.kokoro-panel [role="alert"]')?.textContent ?? ''));
  assert.equal((await page.locator('.kokoro-panel [data-action="kokoro-download"]').innerText()).trim(), 'Try again');
  offline = false;
  await press(page, '.kokoro-panel [data-action="kokoro-download"]');
  await until(page, 'Ready again', () => document.querySelector('label.engine-card:has(#service-engine-kokoro)')?.textContent.includes('Ready'));
  console.log('PASS: the welcome offers built-in voices first, Settings shows the download and Ready, and Remove and Try again work.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

// The release switch off: the routes do not exist, and the page never offers or calls them.
{
  const offTemp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-builtin-off-'));
  const offApp = createApp({ cacheDir: path.join(offTemp, 'cache'), projectsDir: path.join(offTemp, 'projects'), previewDir: path.join(offTemp, 'previews'), connectionsFile: path.join(offTemp, 'connections.json'), secretsFile: path.join(offTemp, 'secrets.json'), modelsDir: path.join(offTemp, 'models'), connections: DEFAULT_CONNECTIONS, firstRunScreen: true,
    serviceFetch: async url => { throw new Error(`nothing is listening on ${url}`); },
    kokoro: { available: false, manifest, fetch: kokoroFetch, workerFile: fileURLToPath(new URL('../tests/fixtures/fake-kokoro-worker.js', import.meta.url)) } });
  const offServer = offApp.listen(0, '127.0.0.1');
  await new Promise(resolve => offServer.once('listening', resolve));
  const offBase = `http://127.0.0.1:${offServer.address().port}`;
  const offBrowser = await launch();
  try {
    assert.equal((await fetch(`${offBase}/api/kokoro`)).status, 404, 'The Kokoro routes do not exist when the switch is off');
    const page = await offBrowser.newPage();
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`${offBase}/#rehearsal`);
    await until(page, 'the welcome without built-in voices', () => !!document.querySelector('dialog.first-run[open]'));
    assert.equal(await page.locator('dialog.first-run [data-choice]').count(), 3, 'No built-in voices choice when the switch is off');
    assert.equal(await page.locator('[data-choice="builtin"]').count(), 0);
    await page.click('[data-choice="skip"]');
    await page.goto(`${offBase}/#settings`);
    await until(page, 'the engine cards', () => !!document.querySelector('.engine-card'));
    assert.equal(await page.locator('#service-engine-kokoro').count(), 0, 'No Built-in voices card when the switch is off');
    console.log('PASS: with the release switch off, the welcome and Settings hide the built-in voices and /api/kokoro is not reachable.');
  } finally {
    await offBrowser.close();
    await new Promise(resolve => offServer.close(resolve));
    await rm(offTemp, { recursive: true, force: true });
  }
}
