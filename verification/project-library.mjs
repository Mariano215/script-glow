import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseScript } from '../src/parser.ts';
import { choose, fitsWidth, launch, openStudio, preferences, press, studio, until } from './lib.mjs';

// Only this throwaway app and its temporary library are touched. No real voice or AI calls.
const source = 'SCENE 1\nDAVID: The first scene is safe.\nELIZABETH: We can return to it.\n\nSCENE 2\nDAVID: This is the second scene.\nELIZABETH: Keep both recordings.';
const services = (url, options) => {
  if (!url.endsWith('/api/generate')) return undefined;
  const names = JSON.parse(options.body).format.properties.guesses.items.properties.name.enum;
  return Buffer.from(JSON.stringify({ done: true, response: JSON.stringify({ guesses: names.map(name => ({ name, gender: name === 'DAVID' ? 'male' : name === 'ELIZABETH' ? 'female' : 'unknown' })) }) }));
};
// The first project is an old browser draft with audio made before the library existed.
const legacy = preferences(source, { name: 'First rehearsal', role: 'DAVID', cast: { DAVID: 'MyVoice', ELIZABETH: 'Stock-Amber' }, guesses: { DAVID: 'male', ELIZABETH: 'female' }, manualVoices: { DAVID: true, ELIZABETH: true }, gap: 0.25 });
const app = await studio({
  voices: ['default', 'MyVoice', 'Stock-Amber', 'Stock-Mica', 'Stock-Ash', 'Stock-Granite'],
  connections: { ollama: { url: 'http://127.0.0.1:11434', model: 'test-model' }, casting: { preferredActorVoice: 'MyVoice', aliases: { default: 'MyVoice' } } },
  services, lineSeconds: 0.1,
});
const browser = await launch();
const errors = [];
let renderRequests = 0;
const tts = () => app.calls.filter(call => call.url.endsWith('/v1/tts')).length;
const api = async (url, body) => { const response = await fetch(app.base + url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const value = await response.json(); assert.ok(response.ok, `${url}: ${response.status} ${JSON.stringify(value)}`); return value; };
const bytes = async url => Buffer.from(await (await fetch(app.base + url)).arrayBuffer());
const watch = page => { page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/render')) renderRequests++; }); return page; };
const open = async hash => watch(await openStudio(browser, app.base, { hash }));
// Opens a browser that still holds an old draft, the way the app stored it before the library.
const legacyPage = async (storage, always = false) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(([items, every]) => {
    if (!every && localStorage.getItem('script-glow:v1')) return;
    for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value));
  }, [storage, always]);
  const page = watch(await context.newPage());
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  return page;
};
const saved = page => until(page, 'the project to save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
// The library lists every project; the open one is the row without an Open button.
const currentId = async page => {
  const others = await page.evaluate(() => [...document.querySelectorAll('[data-action="open-project"]')].map(button => button.dataset.id));
  const current = (await api('/api/projects')).projects.map(item => item.id).filter(id => !others.includes(id));
  assert.equal(current.length, 1, `exactly one open project (${current})`);
  return current[0];
};
const switchTo = async (page, id) => { await press(page, `[data-action="open-project"][data-id="${id}"]`); await until(page, 'the project to open', target => !document.querySelector(`[data-action="open-project"][data-id="${target}"]`) && document.querySelector('#project-save-status')?.textContent === 'Saved locally', id); };
const fullLink = page => page.evaluate(() => document.querySelector('.downloads a[download$="-full.wav"]')?.getAttribute('href') ?? null);
const waitAudio = async page => { await until(page, 'the scene audio', () => !!document.querySelector('.downloads a[download$="-full.wav"]')); return fullLink(page); };
const switchScene = async (page, id) => { await choose(page, '#scene-select', id); await saved(page); };
const renderScene = async page => { const before = await fullLink(page); await press(page, '[data-action="render"]'); await until(page, 'new scene audio', old => { const href = document.querySelector('.downloads a[download$="-full.wav"]')?.getAttribute('href'); return !!href && href !== old; }, before); return fullLink(page); };
const status = page => page.evaluate(() => document.querySelector('#project-save-status')?.textContent ?? '');
try {
  const legacyInput = { scene: parseScript(source).scenes[0], voices: legacy.cast, myCharacter: legacy.role, gapSeconds: legacy.gap, includeDirections: false };
  const legacyJob = await api('/api/render', legacyInput);
  let completed;
  for (let attempt = 0; attempt < 200; attempt++) {
    completed = await api(`/api/jobs/${legacyJob.jobId}`);
    if (completed.status === 'complete') break;
    assert.notEqual(completed.status, 'error', completed.error);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(completed.status, 'complete', 'Legacy render completes');
  const legacyBytes = await bytes(completed.result.fullUrl);
  const legacyRenders = { source, entries: [[JSON.stringify(legacyInput), completed.result]] };
  const legacyTts = tts();

  const page = await legacyPage({ 'script-glow:v1': legacy, 'script-glow:renders:v1': legacyRenders });
  await page.goto(`${app.base}/#rehearsal`);
  await saved(page);
  const originalId = await currentId(page);
  assert.equal((await api(`/api/projects/${originalId}`)).preferences.name, 'First rehearsal', 'The old draft becomes a library project');
  const migratedUrl = await waitAudio(page);
  assert.ok(migratedUrl.startsWith(`/api/projects/${originalId}/audio/`), 'Legacy cache migrated to durable project audio');
  assert.deepEqual(await bytes(migratedUrl), legacyBytes);
  assert.equal(renderRequests, 0, 'Migration copies audio without a render request');
  assert.equal(tts(), legacyTts);
  assert.match(await page.locator('[data-action="scene"][data-id="scene-1"] .scene-save-badge').innerText(), /Audio ready/);

  // A migration cut off part way resumes into the same project instead of making a second one.
  const migrationRetry = await legacyPage({ 'script-glow:v1': legacy, 'script-glow:project:v1': { id: originalId, revision: 0, synced: '', preferences: legacy, migrating: true }, 'script-glow:renders:v1': legacyRenders }, true);
  let migrationAttempts = 0;
  await migrationRetry.route(`**/api/projects/${originalId}/renders`, route => ++migrationAttempts === 1 ? route.fulfill({ status: 503, json: { error: 'Temporary migration interruption.' } }) : route.continue());
  await migrationRetry.goto(`${app.base}/#rehearsal`);
  await until(migrationRetry, 'the interrupted migration', () => document.querySelector('#project-save-status')?.textContent.includes('unavailable'));
  await press(migrationRetry, '[data-action="retry-save"]'); await saved(migrationRetry);
  assert.equal(await currentId(migrationRetry), originalId, 'Interrupted migration resumes its original ID without duplicate project/conflict');
  assert.equal(await waitAudio(migrationRetry), migratedUrl);
  assert.equal((await api('/api/projects')).projects.length, 1);
  errors.push(...migrationRetry.errors);
  await migrationRetry.context().close();

  await choose(page, '[data-cast="ELIZABETH"]', 'Stock-Mica');
  await choose(page, '#hide-lines', true);
  await choose(page, '#playback-rate', '1.25');
  await saved(page);
  let document = await api(`/api/projects/${originalId}`);
  assert.equal(document.preferences.cast.ELIZABETH, 'Stock-Mica');
  assert.equal(document.preferences.hide, true);
  assert.equal(document.preferences.rate, 1.25);
  assert.equal(await fullLink(page), null, 'Changed voice invalidates old render compatibility, not stored audio');
  assert.equal(document.renders.length, 1);
  const sceneA = await renderScene(page);
  await switchScene(page, 'scene-2');
  const sceneB = await renderScene(page);
  assert.notEqual(sceneA, sceneB);
  const renderedCount = renderRequests, synthesizedCount = tts();
  await switchScene(page, 'scene-1');
  assert.equal(await waitAudio(page), sceneA);
  await page.reload(); await saved(page);
  assert.equal(await waitAudio(page), sceneA, 'Reload restores exactly the same durable URL');
  assert.equal(renderRequests, renderedCount); assert.equal(tts(), synthesizedCount);

  // A new project from a script is added beside the first one.
  await page.locator('#file-input').setInputFiles({ name: 'Another script.txt', mimeType: 'text/plain', buffer: Buffer.from('SCENE 1\nDAVID: A separate project.\nELIZABETH: Keep the previous one.') });
  await until(page, 'the imported project', () => document.querySelector('#project-name')?.value === 'Another script' && document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  const importedId = await currentId(page);
  assert.notEqual(importedId, originalId);
  assert.equal((await api('/api/projects')).projects.length, 2);
  assert.equal((await api(`/api/projects/${originalId}`)).renders.length, 3, 'Import preserves old project and all render variants');
  await switchTo(page, originalId);
  assert.equal(await waitAudio(page), sceneA);
  assert.equal(await page.locator('[data-cast="ELIZABETH"]').inputValue(), 'Stock-Mica');
  await choose(page, '#project-name', 'First rehearsal, renamed'); await saved(page);
  assert.equal((await api(`/api/projects/${originalId}`)).preferences.name, 'First rehearsal, renamed');

  // A browser with nothing stored finds the same library on disk.
  const cleanPage = await open('#projects');
  assert.equal(await cleanPage.locator('.project-list > .project-row').count(), 2, 'Clean browser discovers disk library');
  assert.equal(await cleanPage.locator('.project-row.is-current #project-name').count(), 1);
  if (await currentId(cleanPage) !== originalId) await switchTo(cleanPage, originalId);
  assert.equal(await waitAudio(cleanPage), sceneA, 'No browser cache needed to recover render');
  assert.equal(await cleanPage.locator('[data-cast="ELIZABETH"]').inputValue(), 'Stock-Mica');
  assert.equal(await cleanPage.locator('#playback-rate').inputValue(), '1.25');
  assert.equal(renderRequests, renderedCount);

  const downloadEvent = cleanPage.waitForEvent('download');
  await press(cleanPage, '[data-action="backup-project"]');
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.sgbackup$/);
  const backupPath = path.join(app.temp, 'roundtrip.sgbackup'); await download.saveAs(backupPath);
  assert.ok((await readFile(backupPath)).length > legacyBytes.length);
  const chooserEvent = cleanPage.waitForEvent('filechooser');
  await press(cleanPage, '[data-action="restore-project"]');
  await (await chooserEvent).setFiles(backupPath);
  await until(cleanPage, 'the restored project', ids => document.querySelectorAll('.project-row').length === 3 && ids.every(id => document.querySelector(`[data-action="open-project"][data-id="${id}"]`)) && document.querySelector('#project-save-status')?.textContent === 'Saved locally', [originalId, importedId]);
  const restoredId = await currentId(cleanPage);
  const restored = await api(`/api/projects/${restoredId}`);
  document = await api(`/api/projects/${originalId}`);
  assert.equal(restored.renders.length, document.renders.length);
  for (const entry of document.renders) {
    const copied = restored.renders.find(item => item.key === entry.key); assert.ok(copied);
    for (const field of ['fullUrl', 'practiceUrl']) {
      assert.ok(copied.result[field].startsWith(`/api/projects/${restoredId}/audio/`));
      assert.deepEqual(await bytes(copied.result[field]), await bytes(entry.result[field]));
    }
  }
  assert.equal(renderRequests, renderedCount, 'Backup restore never re-synthesizes');

  // A slow save holds the switch, and a second switch cannot jump the queue.
  let heldSave, releaseObserved;
  const held = new Promise(resolve => { releaseObserved = resolve; });
  await cleanPage.route(`**/api/projects/${restoredId}`, route => {
    if (route.request().method() === 'PUT') { heldSave = route; releaseObserved(); } else return route.continue();
  });
  await choose(cleanPage, '#playback-rate', '1.5');
  await held;
  await press(cleanPage, `[data-action="open-project"][data-id="${originalId}"]`);
  await until(cleanPage, 'the library to lock', () => [...document.querySelectorAll('[data-action="open-project"]')].every(button => button.disabled));
  await press(cleanPage, `[data-action="open-project"][data-id="${importedId}"]`);
  await heldSave.continue();
  await until(cleanPage, 'the first switch', id => !document.querySelector(`[data-action="open-project"][data-id="${id}"]`) && document.querySelector('#project-save-status')?.textContent === 'Saved locally', originalId);
  assert.equal(await currentId(cleanPage), originalId, 'Second transition cannot supersede the locked transition');
  await cleanPage.unroute(`**/api/projects/${restoredId}`);
  await switchTo(cleanPage, restoredId);
  await choose(cleanPage, '#playback-rate', '1.25'); await saved(cleanPage);

  await cleanPage.route(`**/api/projects/${restoredId}/backup-info`, route => route.fulfill({ status: 413, json: { error: 'Backup exceeds the 4 GiB limit.' } }));
  let erroneousDownloads = 0; const countDownload = () => erroneousDownloads++;
  cleanPage.on('download', countDownload);
  await press(cleanPage, '[data-action="backup-project"]');
  await until(cleanPage, 'the backup error', () => document.querySelector('.notice.error')?.textContent.includes('4 GiB'));
  assert.equal(erroneousDownloads, 0, 'Failed backup preflight does not download an error document');
  cleanPage.off('download', countDownload); await cleanPage.unroute(`**/api/projects/${restoredId}/backup-info`);

  // A failed save keeps the draft and can be retried.
  const projectRoute = `**/api/projects/${restoredId}`;
  await cleanPage.route(projectRoute, route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
  await choose(cleanPage, '#playback-rate', '1.5');
  await until(cleanPage, 'the save failure', () => document.querySelector('#project-save-status')?.textContent.includes('Save failed'));
  assert.ok(!(await cleanPage.locator('[data-action="retry-save"]').isHidden()), 'Retry is offered');
  assert.equal((await api(`/api/projects/${restoredId}`)).preferences.rate, 1.25, 'Failed autosave does not claim disk saved');
  assert.equal(await cleanPage.locator('#playback-rate').inputValue(), '1.5', 'Failed autosave keeps editable draft');
  await cleanPage.unroute(projectRoute);
  await press(cleanPage, '[data-action="retry-save"]'); await saved(cleanPage);
  assert.equal((await api(`/api/projects/${restoredId}`)).preferences.rate, 1.5);

  // A second tab with an older copy cannot overwrite newer work; it saves its draft separately.
  const stale = watch(await cleanPage.context().newPage());
  stale.on('pageerror', error => errors.push(error.message));
  stale.on('dialog', dialog => dialog.accept());
  await stale.goto(`${app.base}/#projects`); await saved(stale);
  assert.equal(await currentId(stale), restoredId);
  await choose(cleanPage, '#playback-rate', '1'); await saved(cleanPage);
  await choose(stale, '#playback-rate', '0.75');
  await until(stale, 'the save conflict', () => document.querySelector('#project-save-status')?.textContent.includes('Save conflict'));
  assert.equal((await api(`/api/projects/${restoredId}`)).preferences.rate, 1, 'Stale tab cannot overwrite newer settings');
  assert.ok(!(await stale.locator('[data-action="recover-project"]').isHidden()), 'Recovery is offered');
  await press(stale, '[data-action="recover-project"]');
  await until(stale, 'the recovery copy', () => document.querySelectorAll('.project-row').length === 4 && document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  const recoveredId = await currentId(stale);
  assert.notEqual(recoveredId, restoredId);
  assert.equal((await api(`/api/projects/${recoveredId}`)).preferences.rate, 0.75);
  assert.equal((await api(`/api/projects/${restoredId}`)).preferences.rate, 1);
  assert.equal((await api('/api/projects')).projects.length, 4);
  await stale.close();

  // Deleting a project that is not open moves it to the trash folder.
  // The other tab left its recovery copy as this browser's open project.
  await cleanPage.reload(); await saved(cleanPage);
  if (await currentId(cleanPage) !== restoredId) await switchTo(cleanPage, restoredId);
  await press(cleanPage, `[data-action="delete-project"][data-id="${recoveredId}"]`);
  await until(cleanPage, 'the deleted project to leave the list', id => !document.querySelector(`[data-action="delete-project"][data-id="${id}"]`), recoveredId);
  assert.equal((await api('/api/projects')).projects.length, 3);
  assert.ok((await readdir(path.join(app.temp, 'projects', '.trash'))).some(name => name.startsWith(recoveredId)), 'Deleted project is kept in .trash');

  await cleanPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(await fitsWidth(cleanPage), 'Mobile projects screen does not overflow');
  await cleanPage.setViewportSize({ width: 1440, height: 1000 });

  await cleanPage.route(`**/api/projects/${originalId}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ response, json: { ...body, warnings: ['Recovered the previous project manifest. Review the latest changes before saving.'] } });
  });
  await switchTo(cleanPage, originalId);
  assert.match(await cleanPage.locator('.notice').first().innerText(), /Recovered the previous project manifest/, 'Project switch preserves recovery warnings');
  await waitAudio(cleanPage);
  await cleanPage.evaluate(() => document.querySelector('#scene-audio').dispatchEvent(new Event('error')));
  assert.equal(await fullLink(cleanPage), null);
  assert.match(await cleanPage.locator('[data-id="scene-1"] .scene-save-badge').innerText(), /Audio not made yet/, 'Failed audio cannot retain a ready badge');
  assert.ok(!(await status(cleanPage)).includes('Save failed'));
  errors.push(...page.errors, ...cleanPage.errors);
  assert.deepEqual(errors, []);
  console.log(`PASS: isolated disk library; legacy script/audio migration and its interrupted retry; casting/settings autosave; A/B/A + refresh without synthesis; import as a new project; rename; clean-browser discovery; binary backup roundtrip with byte-identical full/practice WAVs; locked switching during a slow save; save failure/retry; stale-tab conflict/recovery copy; delete to trash; mobile. ${renderRequests} render requests, ${tts()} fake voice calls.`);
} finally { await browser.close(); await app.close(); }
