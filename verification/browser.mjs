import assert from 'node:assert/strict';
import { choose, fitsWidth, launch, openStudio, press, studio, until } from './lib.mjs';

// The core flow on an isolated app: import, edit, cast, make audio, play, practice, restore,
// invalidate, and an offline voice engine. Voices are the fake services from lib.mjs.
const source = 'INT. REHEARSAL ROOM - DAY\n\nPARTNER: Are you ready to begin?\nJORDAN: Yes. Let us take it from the top.\nPARTNER: Good. The stage is yours.\n\nEXT. STAGE - NIGHT\n\nJORDAN: Yes. Let us take it from the top.';
const app = await studio();
const browser = await launch();
const saved = page => until(page, 'the project to save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
const value = (page, selector) => page.evaluate(target => document.querySelector(target)?.value, selector);
const downloads = page => page.locator('a[download]').count();
try {
  const page = await openStudio(browser, app.base, { hash: '#rehearsal' });
  await page.route('**/api/casting/guess-genders', route => route.fulfill({ json: { guesses: route.request().postDataJSON().names.map(name => ({ name, gender: 'unknown' })) } }));
  const externalRequests = [];
  let renderRequests = 0;
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/render') renderRequests++;
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(url.href);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await fitsWidth(page), 'Phone width fits without sideways scrolling');
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Import makes a new project; the editor shows its source and renames it.
  await page.locator('#file-input').setInputFiles({ name: 'Rehearsal.fountain', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await until(page, 'the imported script', () => document.querySelectorAll('[data-action="scene"]').length === 2 && document.querySelector('#my-role')?.textContent.includes('Jordan'));
  await saved(page);
  await press(page, '[data-action="edit"]');
  await until(page, 'the script editor', () => !!document.querySelector('#script-source'));
  assert.equal(await value(page, '#script-source'), source);
  await choose(page, '#script-name', 'The rehearsal room');
  await press(page, '#save-script');
  await choose(page, '#my-role', 'JORDAN');
  await page.evaluate(() => { location.hash = '#cast'; });
  assert.equal(await value(page, '[data-cast="JORDAN"]'), 'MyVoice', 'Your role gets your own voice');
  await choose(page, '[data-cast="PARTNER"]', 'Stock-Mica');
  await page.evaluate(() => { location.hash = '#rehearsal'; });
  await choose(page, '#line-gap', '0.5');
  await saved(page);
  await page.reload(); await saved(page);
  assert.equal(await value(page, '#my-role'), 'JORDAN');
  assert.equal(await value(page, '[data-cast="PARTNER"]'), 'Stock-Mica');
  assert.equal(await value(page, '#line-gap'), '0.5', 'The pause change survives a reload');
  const { projects } = await (await fetch(`${app.base}/api/projects`)).json();
  const project = projects.find(item => item.name === 'The rehearsal room');
  assert.ok(project, 'The imported project is saved under its new name');

  // Make audio, then play, pause and seek.
  await until(page, 'Make audio to be offered', () => document.querySelector('[data-action="render"]')?.disabled === false);
  await press(page, '[data-action="render"]');
  await until(page, 'the audio to be made', () => document.querySelectorAll('a[download]').length === 2, undefined, 180000);
  await press(page, '[data-action="play"]');
  await until(page, 'playback', () => document.querySelector('audio').currentTime > 0.2);
  await press(page, '[data-action="play"]');
  assert.ok(await page.evaluate(() => document.querySelector('audio').paused));
  assert.equal(await page.locator('#player-status').innerText(), 'Ready to rehearse');
  await choose(page, '#seek', '2.3');
  await press(page, '[data-action="mode-practice"]');
  await until(page, 'the practice track at the same time', () => { const a = document.querySelector('audio'); return a.src.endsWith('-practice.wav') && a.readyState >= 1 && a.currentTime >= 2.29; });
  assert.ok(await page.evaluate(() => { const a = document.querySelector('audio'); return a.currentTime < 2.4 && a.paused; }), 'Switching to practice keeps the position and stays paused');
  await choose(page, '#playback-rate', '0.75');
  // Your own turn in practice keeps its pause at 1x; any other moment follows the chosen speed.
  assert.ok(await page.evaluate(() => document.querySelector('audio').playbackRate === (document.querySelector('.practice-turn') ? 1 : 0.75)));
  assert.equal(await value(page, '#playback-rate'), '0.75');
  await press(page, '[data-action="loop"]');
  assert.ok(await page.evaluate(() => document.querySelector('audio').loop));
  await choose(page, '#hide-lines', true);
  assert.equal(await page.locator('.my-line [data-action="reveal"]').count(), 1);
  assert.equal(await page.locator('.my-line p').count(), 0);
  await press(page, '.my-line [data-action="reveal"]');
  assert.ok((await page.locator('.my-line p').innerText()).includes('take it from the top'));
  const downloadWait = page.waitForEvent('download');
  await press(page, 'a[download$="-practice.wav"]');
  const download = await downloadWait;
  assert.equal(await download.failure(), null, 'The practice WAV downloads');
  assert.ok(await download.path());
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await fitsWidth(page), 'Rehearsal fits a phone');
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Another scene has no audio; returning restores it without making it again.
  await press(page, '[data-action="scene"][data-id="scene-2"]');
  await until(page, 'scene 2', () => document.querySelector('#scene-select')?.value === 'scene-2');
  assert.equal(await downloads(page), 0, 'Scene change invalidates previous export');
  assert.match(await page.locator('[data-action="play"]').getAttribute('aria-label'), /Make audio and play scene/);
  await press(page, '[data-action="scene"][data-id="scene-1"]');
  await until(page, 'scene 1 audio', () => document.querySelectorAll('a[download]').length === 2);
  assert.ok(await page.locator('[data-action="play"]').isEnabled());
  assert.equal(renderRequests, 1, 'Scene revisit uses existing result without making audio again');
  const practiceUrl = await page.locator('a[download$="-practice.wav"]').getAttribute('href');
  await saved(page);
  await page.reload(); await saved(page);
  await until(page, 'restored audio', () => document.querySelectorAll('a[download]').length === 2);
  assert.equal(await page.locator('a[download$="-practice.wav"]').getAttribute('href'), practiceUrl, 'Refresh restores the same tracks');
  assert.ok(await page.locator('[data-action="play"]').isEnabled());
  assert.equal(await page.locator('#player-status').innerText(), 'Ready to rehearse');
  assert.equal(renderRequests, 1, 'Refresh does not make audio again');
  await choose(page, '[data-cast="PARTNER"]', 'Stock-Amber');
  assert.equal(await downloads(page), 0, 'Changed cast cannot use stale audio');
  await saved(page);

  // Offline voices keep the cast, and Check again reconnects.
  await page.route('**/api/health', route => route.fulfill({ json: { tts: { ok: false }, stt: { ok: false } } }));
  await page.route('**/api/voices', route => route.fulfill({ status: 503, json: { error: 'Voice engine unavailable' } }));
  await page.reload(); await saved(page);
  await until(page, 'the offline badge', () => document.querySelector('.local-badge')?.textContent.includes('Voices not connected'));
  const stored = await (await fetch(`${app.base}/api/projects/${project.id}`)).json();
  assert.equal(stored.preferences.cast.PARTNER, 'Stock-Amber', 'Offline engine keeps voice choices');
  await page.unroute('**/api/health');
  await page.unroute('**/api/voices');
  await press(page, '.voices-offline [data-action="reconnect"]');
  await until(page, 'voices to reconnect', () => document.querySelector('[data-action="render"]')?.disabled === false);
  assert.equal(await value(page, '[data-cast="PARTNER"]'), 'Stock-Amber');
  assert.deepEqual(page.errors, [], 'No uncaught browser errors');
  assert.deepEqual(externalRequests, [], 'The app and its fonts need no external requests');
  console.log('PASS: phone fit; import/edit/restore; your voice on your role; pause persists; make audio; play/pause/seek; practice switch keeps time; speed/loop; hide/reveal; WAV download; scene/refresh restore without making audio again; cast invalidation; offline cast retention and reconnect; no external requests.');
} finally { await browser.close(); await app.close(); }
