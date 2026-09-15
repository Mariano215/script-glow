import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { encodeWav } from '../server/audio.js';
import { parseScript } from '../src/parser.ts';

// Only this ephemeral server and temporary library are touched. No real GPU calls.
const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-library-browser-'));
const source = 'SCENE 1\nDAVID: The first scene is safe.\nELIZABETH: We can return to it.\n\nSCENE 2\nDAVID: This is the second scene.\nELIZABETH: Keep both recordings.';
const preferences = { source, name: 'Legacy rehearsal', role: 'DAVID', cast: { DAVID: 'MyVoice', ELIZABETH: 'Stock-Amber' }, guesses: { DAVID: 'male', ELIZABETH: 'female' }, genders: {}, manualVoices: { DAVID: true, ELIZABETH: true }, sceneId: 'scene-1', gap: 0.25, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
const pcm = Buffer.alloc(4800);
for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 1000 - 500, i);
const wav = encodeWav(pcm);
let ttsCalls = 0, renderRequests = 0;
const serviceFetch = async (url, options = {}) => {
  if (url.endsWith('/health')) return Buffer.from('{"status":"ok"}');
  if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify({ voices: ['default', 'MyVoice', 'Stock-Amber', 'Stock-Mica', 'Stock-Ash', 'Stock-Granite'] }));
  if (url.endsWith('/v1/tts')) { ttsCalls++; return wav; }
  if (url.endsWith('/api/generate')) {
    const names = JSON.parse(options.body).format.properties.guesses.items.properties.name.enum;
    return Buffer.from(JSON.stringify({ done: true, response: JSON.stringify({ guesses: names.map(name => ({ name, gender: name === 'DAVID' ? 'male' : name === 'ELIZABETH' ? 'female' : 'unknown' })) }) }));
  }
  throw new Error(`Unexpected external service request: ${url}`);
};
const app = createApp({ projectsDir: path.join(temp, 'projects'), cacheDir: path.join(temp, '.cache'), serviceFetch, connections: { ...DEFAULT_CONNECTIONS, ollama: { ...DEFAULT_CONNECTIONS.ollama, model: 'test-model' }, casting: { preferredActorVoice: 'MyVoice', aliases: { default: 'MyVoice' } } } });
const server = createServer((req, res) => { if (req.method === 'POST' && req.url === '/api/render') renderRequests++; app(req, res); });
let browser;
const errors = [];
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (url, body) => {
    const response = await fetch(base + url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); assert.ok(response.ok, `${url}: ${response.status} ${JSON.stringify(value)}`); return value;
  };
  const scene = parseScript(source).scenes[0];
  const legacyInput = { scene, voices: preferences.cast, myCharacter: preferences.role, gapSeconds: preferences.gap, includeDirections: false };
  const legacyJob = await api('/api/render', legacyInput);
  let completed;
  for (let attempt = 0; attempt < 200; attempt++) {
    completed = await api(`/api/jobs/${legacyJob.jobId}`);
    if (completed.status === 'complete') break;
    assert.notEqual(completed.status, 'error', completed.error);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(completed.status, 'complete', 'Legacy render completes');
  const legacyBytes = Buffer.from(await (await fetch(base + completed.result.fullUrl)).arrayBuffer());
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(({ preferences, entry }) => {
    if (!localStorage.getItem('script-glow:v1')) {
      localStorage.setItem('script-glow:v1', JSON.stringify(preferences));
      localStorage.setItem('script-glow:renders:v1', JSON.stringify({ source: preferences.source, entries: [entry] }));
    }
  }, { preferences, entry: [JSON.stringify(legacyInput), completed.result] });
  const watch = page => { page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept()); return page; };
  const page = watch(await context.newPage());
  const saved = async target => target.waitForFunction(() => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  const currentId = target => target.locator('#project-select').inputValue();
  const fullLink = target => target.locator('a[download][href$="-full.wav"]').first();
  const waitAudio = async target => { await fullLink(target).waitFor(); return fullLink(target).getAttribute('href'); };
  const switchScene = async (target, id) => { await target.locator('#scene-select').selectOption(id); await saved(target); };
  const renderScene = async target => { await target.locator('[data-action="render"]').click(); return waitAudio(target); };
  await page.goto(base);
  await saved(page);
  const originalId = await currentId(page);
  const migratedUrl = await waitAudio(page);
  assert.ok(migratedUrl.startsWith(`/api/projects/${originalId}/audio/`), 'Legacy cache migrated to durable project audio');
  assert.deepEqual(Buffer.from(await (await fetch(base + migratedUrl)).arrayBuffer()), legacyBytes);
  assert.equal(renderRequests, 1, 'Migration copies audio without a render request');
  assert.match(await page.locator('[data-action="scene"][data-id="scene-1"] .scene-save-badge').innerText(), /Audio ready/);

  const recoveryContext = await browser.newContext();
  await recoveryContext.addInitScript(({ preferences, id, entry }) => {
    localStorage.setItem('script-glow:v1', JSON.stringify(preferences));
    localStorage.setItem('script-glow:project:v1', JSON.stringify({ id, revision: 0, synced: '', preferences, migrating: true }));
    localStorage.setItem('script-glow:renders:v1', JSON.stringify({ source: preferences.source, entries: [entry] }));
  }, { preferences, id: originalId, entry: [JSON.stringify(legacyInput), completed.result] });
  const migrationRetry = watch(await recoveryContext.newPage());
  let migrationAttempts = 0;
  await migrationRetry.route(`**/api/projects/${originalId}/renders`, route => ++migrationAttempts === 1 ? route.fulfill({ status: 503, json: { error: 'Temporary migration interruption.' } }) : route.continue());
  await migrationRetry.goto(base);
  await migrationRetry.waitForFunction(() => document.querySelector('#project-save-status')?.textContent.includes('unavailable'));
  await migrationRetry.locator('[data-action="retry-save"]').click(); await saved(migrationRetry);
  assert.equal(await currentId(migrationRetry), originalId, 'Interrupted migration resumes its original ID without duplicate project/conflict');
  assert.equal(await waitAudio(migrationRetry), migratedUrl);
  await recoveryContext.close();

  await page.locator('[data-screen="cast"]').click();
  await page.locator('[data-cast="ELIZABETH"]').selectOption('Stock-Mica');
  await page.locator('[data-screen="rehearsal"]').click();
  await page.locator('#hide-lines').check();
  await page.locator('#playback-rate').selectOption('1.25');
  await saved(page);
  let document = await api(`/api/projects/${originalId}`);
  assert.equal(document.preferences.cast.ELIZABETH, 'Stock-Mica');
  assert.equal(document.preferences.hide, true);
  assert.equal(document.preferences.rate, 1.25);
  assert.equal(await fullLink(page).count(), 0, 'Changed voice invalidates old render compatibility, not stored audio');
  const sceneA = await renderScene(page);
  await switchScene(page, 'scene-2');
  const sceneB = await renderScene(page);
  assert.notEqual(sceneA, sceneB);
  const renderedCount = renderRequests, synthesizedCount = ttsCalls;
  await switchScene(page, 'scene-1');
  assert.equal(await waitAudio(page), sceneA);
  await page.reload(); await saved(page);
  assert.equal(await waitAudio(page), sceneA, 'Reload restores exactly the same durable URL');
  assert.equal(renderRequests, renderedCount); assert.equal(ttsCalls, synthesizedCount);

  await page.locator('#file-input').setInputFiles({ name: 'Another script.txt', mimeType: 'text/plain', buffer: Buffer.from('SCENE 1\nDAVID: A separate project.\nELIZABETH: Keep the previous one.') });
  await page.waitForFunction(old => document.querySelector('#project-select')?.value !== old && document.querySelector('#project-save-status')?.textContent === 'Saved locally', originalId);
  const importedId = await currentId(page);
  assert.equal((await api('/api/projects')).projects.length, 2);
  assert.equal((await api(`/api/projects/${originalId}`)).renders.length, 3, 'Import preserves old project and all render variants');
  await page.locator('#project-select').selectOption(originalId); await saved(page);
  assert.equal(await waitAudio(page), sceneA);
  assert.equal(await page.locator('[data-cast="ELIZABETH"]').inputValue(), 'Stock-Mica');

  const clean = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const cleanPage = watch(await clean.newPage()); await cleanPage.goto(base); await saved(cleanPage);
  assert.equal(await cleanPage.locator('#project-select option').count(), 2, 'Clean browser discovers disk library');
  if (await currentId(cleanPage) !== originalId) { await cleanPage.locator('#project-select').selectOption(originalId); await saved(cleanPage); }
  assert.equal(await waitAudio(cleanPage), sceneA, 'No browser cache needed to recover render');
  assert.equal(await cleanPage.locator('[data-cast="ELIZABETH"]').inputValue(), 'Stock-Mica');
  assert.equal(await cleanPage.locator('#playback-rate').inputValue(), '1.25');
  assert.equal(renderRequests, renderedCount);

  const downloadEvent = cleanPage.waitForEvent('download');
  await cleanPage.locator('[data-action="backup-project"]').click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.sgbackup$/);
  const backupPath = path.join(temp, 'roundtrip.sgbackup'); await download.saveAs(backupPath);
  assert.ok((await readFile(backupPath)).length > legacyBytes.length);
  const chooserEvent = cleanPage.waitForEvent('filechooser');
  await cleanPage.locator('[data-action="restore-project"]').click();
  await (await chooserEvent).setFiles(backupPath);
  await cleanPage.waitForFunction(old => document.querySelector('#project-select')?.value !== old && document.querySelector('#project-save-status')?.textContent === 'Saved locally', originalId);
  const restoredId = await currentId(cleanPage);
  assert.notEqual(restoredId, originalId); assert.notEqual(restoredId, importedId);
  const restored = await api(`/api/projects/${restoredId}`);
  document = await api(`/api/projects/${originalId}`);
  assert.equal(restored.renders.length, document.renders.length);
  for (const entry of document.renders) {
    const copied = restored.renders.find(item => item.key === entry.key); assert.ok(copied);
    for (const field of ['fullUrl', 'practiceUrl']) {
      assert.ok(copied.result[field].startsWith(`/api/projects/${restoredId}/audio/`));
      assert.deepEqual(Buffer.from(await (await fetch(base + copied.result[field])).arrayBuffer()), Buffer.from(await (await fetch(base + entry.result[field])).arrayBuffer()));
    }
  }
  assert.equal(renderRequests, renderedCount, 'Backup restore never re-synthesizes');

  let heldSave, releaseObserved;
  const held = new Promise(resolve => { releaseObserved = resolve; });
  await cleanPage.route(`**/api/projects/${restoredId}`, route => {
    if (route.request().method() === 'PUT') { heldSave = route; releaseObserved(); } else return route.continue();
  });
  await cleanPage.locator('#playback-rate').selectOption('1.5');
  await held;
  await cleanPage.locator('#project-select').selectOption(originalId);
  assert.ok(await cleanPage.locator('#project-select').isDisabled(), 'Transition locks before waiting for slow autosave');
  await cleanPage.locator('#project-select').evaluate((select, other) => { select.value = other; select.dispatchEvent(new Event('change', { bubbles: true })); }, importedId);
  await heldSave.continue(); await saved(cleanPage);
  assert.equal(await currentId(cleanPage), originalId, 'Second transition cannot supersede the locked transition');
  await cleanPage.unroute(`**/api/projects/${restoredId}`);
  await cleanPage.locator('#project-select').selectOption(restoredId); await saved(cleanPage);
  await cleanPage.locator('#playback-rate').selectOption('1.25'); await saved(cleanPage);

  await cleanPage.route(`**/api/projects/${restoredId}/backup-info`, route => route.fulfill({ status: 413, json: { error: 'Backup exceeds the 4 GiB limit.' } }));
  let erroneousDownloads = 0; const countDownload = () => erroneousDownloads++;
  cleanPage.on('download', countDownload);
  await cleanPage.locator('[data-action="backup-project"]').click();
  await cleanPage.waitForFunction(() => document.querySelector('.notice.error')?.textContent.includes('4 GiB'));
  assert.equal(erroneousDownloads, 0, 'Failed backup preflight does not download an error document');
  cleanPage.off('download', countDownload); await cleanPage.unroute(`**/api/projects/${restoredId}/backup-info`);

  const projectRoute = `**/api/projects/${restoredId}`;
  await cleanPage.route(projectRoute, route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
  await cleanPage.locator('#playback-rate').selectOption('1.5');
  await cleanPage.waitForFunction(() => document.querySelector('#project-save-status')?.textContent.includes('Save failed'));
  assert.equal((await api(`/api/projects/${restoredId}`)).preferences.rate, 1.25, 'Failed autosave does not claim disk saved');
  assert.equal(await cleanPage.locator('#playback-rate').inputValue(), '1.5', 'Failed autosave keeps editable draft');
  await cleanPage.unroute(projectRoute);
  await cleanPage.locator('[data-action="retry-save"]').click(); await saved(cleanPage);
  assert.equal((await api(`/api/projects/${restoredId}`)).preferences.rate, 1.5);

  const stale = watch(await clean.newPage()); await stale.goto(base); await saved(stale);
  assert.equal(await currentId(stale), restoredId);
  await cleanPage.locator('#playback-rate').selectOption('1'); await saved(cleanPage);
  await stale.locator('#playback-rate').selectOption('0.75');
  await stale.waitForFunction(() => document.querySelector('#project-save-status')?.textContent.includes('Save conflict'));
  assert.equal((await api(`/api/projects/${restoredId}`)).preferences.rate, 1, 'Stale tab cannot overwrite newer settings');
  await stale.locator('[data-action="recover-project"]').click(); await saved(stale);
  const recoveredId = await currentId(stale);
  assert.notEqual(recoveredId, restoredId);
  assert.equal((await api(`/api/projects/${recoveredId}`)).preferences.rate, 0.75);
  assert.equal((await api(`/api/projects/${restoredId}`)).preferences.rate, 1);
  assert.equal((await api('/api/projects')).projects.length, 4);

  await mkdir('artifacts', { recursive: true });
  if (await cleanPage.locator('[data-action="dismiss"]').count()) await cleanPage.locator('[data-action="dismiss"]').click();
  await cleanPage.screenshot({ path: 'artifacts/project-library-desktop.png', fullPage: true });
  await cleanPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(await cleanPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile shell does not overflow');
  await cleanPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await cleanPage.screenshot({ path: 'artifacts/project-library-mobile.png', fullPage: true });
  await cleanPage.setViewportSize({ width: 1440, height: 1000 });
  await cleanPage.route(`**/api/projects/${originalId}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); const document = await response.json();
    await route.fulfill({ response, json: { ...document, warnings: ['Recovered the previous project manifest. Review the latest changes before saving.'] } });
  });
  await cleanPage.locator('#project-select').selectOption(originalId); await saved(cleanPage);
  assert.match(await cleanPage.locator('.notice').innerText(), /Recovered the previous project manifest/, 'Project switch preserves recovery warnings');
  await cleanPage.locator('#scene-audio').evaluate(audio => audio.dispatchEvent(new Event('error')));
  assert.equal(await fullLink(cleanPage).count(), 0);
  assert.match(await cleanPage.locator('[data-id="scene-1"] .scene-save-badge').innerText(), /Audio not made yet/, 'Failed audio cannot retain a ready badge');
  assert.deepEqual(errors, []);
  console.log(`PASS: isolated disk library; legacy script/audio migration; casting/settings autosave; A/B/A + refresh without synthesis; import preservation; clean-browser recovery; binary backup roundtrip with byte-identical full/practice WAVs; save failure/retry; stale-tab conflict/recovery copy; desktop/mobile. ${renderRequests} render requests, ${ttsCalls} deterministic TTS calls; no GPU or production data used.`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  const resolved = path.resolve(temp);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('script-glow-library-browser-'));
  await rm(resolved, { recursive: true, force: true });
}
