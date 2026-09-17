import assert from 'node:assert/strict';
import { launch, MEDIA_ARGS, openStudio, preferences, press, choose, studio, until } from './lib.mjs';

// Finish the tape: reader volume, a slate on its own, the casting-site check, the file name, and
// trim to MP4 both with FFmpeg and without it. Isolated app, synthetic camera, no real data.
// FFmpeg must be installed for the first conversion (SCRIPT_GLOW_FFMPEG or ffmpeg on the PATH).
const source = 'INT. KITCHEN - NIGHT\n\nDAVID: I waited up for you tonight.\n\nELIZABETH: You did not have to wait.\n\nDAVID: I know.\n';
const app = await studio({ projects: [preferences(source, { name: 'Evelyn', role: 'DAVID', cast: { DAVID: 'MyVoice', ELIZABETH: 'Stock-Amber' }, manualVoices: { DAVID: true, ELIZABETH: true } })], lineSeconds: 1 });
const project = app.projects[0].id;
const api = async route => (await fetch(`${app.base}${route}`)).json();
const takes = async () => (await api(`/api/projects/${project}/takes`)).takes;
const browser = await launch(MEDIA_ARGS);
try {
  const page = await openStudio(browser, app.base, { hash: '#rehearsal' });
  // Record every gain node the page makes, to read the reader level off the real audio graph.
  await page.evaluate(() => {
    window.__gains = [];
    const make = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function (...args) { const node = make.apply(this, args); window.__gains.push(node); return node; };
  });
  const notice = () => page.evaluate(() => document.querySelector('.selftape-screen .notice')?.textContent ?? '');

  // Scene audio first, so a scene take has a reader.
  await until(page, 'Make audio', () => !document.querySelector('[data-action="render"]')?.disabled);
  await press(page, '[data-action="render"]');
  await until(page, 'the scene audio', () => !!document.querySelector('a[download][href$="-full.wav"]'), undefined, 120000);
  await page.evaluate(() => { location.hash = '#selftape'; });
  await until(page, 'the self-tape screen', () => !document.querySelector('.selftape-screen')?.hidden);
  assert.equal(await page.locator('#reader-level').inputValue(), '1', 'The reader starts at full volume');

  // The first request to the synthetic camera stalls in this headless build; warm it up.
  await page.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => stream.getTracks().forEach(track => track.stop())).catch(() => {}));
  await press(page, '[data-action="camera-on"]');
  await until(page, 'the camera', () => !!document.querySelector('#tape-preview')?.srcObject, undefined, 30000);

  // Reader volume: saved with the project and applied to the recording path only.
  await choose(page, '#reader-level', '0.4');
  await until(page, 'the reader volume to be saved', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  assert.equal((await api(`/api/projects/${project}`)).preferences.readerLevel, 0.4);
  assert.equal(await page.locator('output[for="reader-level"]').innerText(), '40%');
  assert.ok(await page.evaluate(() => window.__gains.some(node => Math.abs(node.gain.value - 0.4) < 0.01 || Math.abs(node.gain.targetValue ?? 0) > 0)), 'The reader gain node exists in the recording graph');

  // A scene take.
  await press(page, '[data-action="record-start"]');
  await until(page, 'recording', () => !!document.querySelector('.tape-live'), undefined, 20000);
  await page.waitForTimeout(3000);
  await press(page, '[data-action="record-stop"]');
  await until(page, 'the take to be kept', () => /Kept as/.test(document.querySelector('.selftape-screen .notice')?.textContent ?? ''), undefined, 30000);
  let listed = await takes();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].kind, 'scene');

  // A slate: its own file, no reader, no script over the camera, a prompt instead.
  await press(page, '[data-action="record-slate"]');
  await until(page, 'the slate prompt', () => /Say your name, your height/.test(document.querySelector('.slate-card')?.textContent ?? ''), undefined, 20000);
  assert.equal(await page.locator('.tape-overlay').count(), 0, 'No script over the camera during a slate');
  await until(page, 'slate recording', () => !!document.querySelector('.tape-live'), undefined, 20000);
  assert.match(await notice(), /Recording your slate/);
  assert.equal(await page.evaluate(() => document.querySelector('#scene-audio')?.paused ?? true), true, 'The reader stays silent during a slate');
  await page.waitForTimeout(2000);
  await press(page, '[data-action="record-stop"]');
  await until(page, 'the slate to be kept', () => /Kept as Slate 1/.test(document.querySelector('.selftape-screen .notice')?.textContent ?? ''), undefined, 30000);
  listed = await takes();
  const slate = listed.find(take => take.kind === 'slate');
  assert.ok(slate, 'The slate is saved as a slate');
  assert.equal(slate.sceneId, '', 'A slate belongs to no scene');
  assert.equal(await page.locator('.take-row.is-slate .take-tag').innerText(), 'SLATE');

  // The casting-site check and the file name.
  const sceneTake = listed.find(take => take.kind === 'scene');
  const row = page.locator('.take-row').first();
  const fit = await row.locator('.take-fit').innerText();
  if (sceneTake.file.endsWith('.webm')) assert.match(fit, /Casting Networks · needs MP4/, 'A WebM take is flagged for Casting Networks');
  else assert.match(fit, /✓ Casting Networks/);
  assert.match(fit, /✓ Spotlight/);
  await choose(page, '#actor-name', 'Jane Doe');
  await until(page, 'the name in the file name', () => /Jane_Doe_Evelyn_Kitchen_Night/.test(document.querySelector('.take-row a[download]')?.getAttribute('href') ? decodeURIComponent(document.querySelector('.take-row a[download]').getAttribute('href')) : ''));
  const href = await row.locator('a[download]').getAttribute('href');
  const saved = await fetch(app.base + href);
  assert.match(saved.headers.get('content-disposition'), /filename="Jane_Doe_Evelyn_Kitchen_Night\.(webm|mp4)"/, 'The saved file carries performer, project and scene');
  assert.match(decodeURIComponent((await page.locator('.take-row.is-slate a[download]').getAttribute('href'))), /name=Jane_Doe_Evelyn_Slate/);

  // Trim to MP4 with FFmpeg.
  const tools = await api('/api/tools');
  assert.equal(tools.ffmpeg, true, 'FFmpeg must be installed for this check (set SCRIPT_GLOW_FFMPEG)');
  await page.evaluate(file => document.querySelector(`[data-action="take-trim"][data-file="${file}"]`).click(), sceneTake.file);
  await until(page, 'the trim panel and the take player', () => !!document.querySelector('.trim-panel') && document.querySelector('.tape-review')?.readyState >= 1, undefined, 30000);
  await page.evaluate(() => { const video = document.querySelector('.tape-review'); video.pause(); video.currentTime = 0.5; });
  await until(page, 'the player at 0.5 s', () => Math.abs(document.querySelector('.tape-review').currentTime - 0.5) < 0.05);
  await press(page, '[data-action="trim-start"]');
  await page.evaluate(() => { document.querySelector('.tape-review').currentTime = 2; });
  await until(page, 'the player at 2 s', () => Math.abs(document.querySelector('.tape-review').currentTime - 2) < 0.05);
  await press(page, '[data-action="trim-end"]');
  await until(page, 'the trim points', () => /From 0\.5 s to 2\.0 s/.test(document.querySelector('.trim-points')?.textContent ?? ''));
  await press(page, '[data-action="trim-make"]');
  await until(page, 'the MP4', () => /ready to send/.test(document.querySelector('.selftape-screen .notice')?.textContent ?? ''), undefined, 180000);
  listed = await takes();
  const made = listed.find(take => take.from === sceneTake.file);
  assert.ok(made && made.file.endsWith('.mp4'), 'An MP4 is made beside the original');
  assert.equal(made.ms, 1500);
  assert.ok(listed.some(take => take.file === sceneTake.file), 'The original is kept');
  const bytes = Buffer.from(await (await fetch(`${app.base}/api/projects/${project}/takes/${made.file}`)).arrayBuffer());
  assert.equal(bytes.subarray(4, 8).toString(), 'ftyp', 'It is a real MP4');
  await until(page, 'the MP4 in the list', file => !!document.querySelector(`[data-action="take-play"][data-file="${file}"]`), made.file);
  assert.match(await page.evaluate(file => document.querySelector(`[data-action="take-play"][data-file="${file}"]`).closest('.take-row').querySelector('.take-fit').textContent, made.file), /✓ Casting Networks/, 'The MP4 fits Casting Networks');

  // Without FFmpeg the browser makes the MP4 by playing the take through once.
  await page.route('**/api/tools', route => route.fulfill({ json: { ffmpeg: false, ffmpegVersion: '' } }));
  await page.reload();
  await until(page, 'the project after reload', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await until(page, 'the takes after reload', () => document.querySelectorAll('.take-row').length === 3);
  const canRecordMp4 = await page.evaluate(() => ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'].some(type => MediaRecorder.isTypeSupported(type)));
  await page.evaluate(file => document.querySelector(`[data-action="take-trim"][data-file="${file}"]`).click(), slate.file);
  await until(page, 'the trim panel again', () => !!document.querySelector('.trim-panel'));
  if (!canRecordMp4) {
    assert.equal(await page.evaluate(() => document.querySelector('[data-action="trim-make"]').disabled), true);
    assert.match(await page.locator('.trim-panel').innerText(), /cannot make MP4 files/);
  } else {
    assert.match(await page.locator('.trim-panel').innerText(), /browser makes the MP4/);
    await press(page, '[data-action="trim-make"]');
    await until(page, 'the browser MP4', () => /ready to send/.test(document.querySelector('.selftape-screen .notice')?.textContent ?? ''), undefined, 120000);
    listed = await takes();
    const browserMade = listed.find(take => take.kind === 'slate' && take.file !== slate.file);
    assert.ok(browserMade, 'The browser made an MP4 slate');
    assert.equal(browserMade.label, 'Slate 1 MP4');
  }
  // The reload above already released the camera; nothing is left recording.
  assert.equal(await page.locator('.tape-live').count(), 0);
  assert.deepEqual(page.errors, []);
  console.log(`PASS: reader volume saved and in the recording graph; slate recorded alone with a prompt; casting-site check; Name_Project_Scene file names; trim to MP4 with FFmpeg keeps the original; ${canRecordMp4 ? 'browser MP4 without FFmpeg' : 'no-FFmpeg browser explained'}.`);
} finally { await browser.close(); await app.close(); }
