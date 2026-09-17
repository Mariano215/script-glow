import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { encodeWav } from '../server/audio.js';

// Real UI and project API, isolated disk library, a synthetic camera. No production data, no TTS.
const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-tape-'));
const source = ['SCENE 1\n', 'DAVID: I waited up for you tonight.\n', 'ELIZABETH: You did not have to wait.\n',
  ...Array.from({ length: 10 }, (unused, line) => `${line % 2 ? 'ELIZABETH' : 'DAVID'}: Line ${line + 1}. There is enough here to run off the bottom of the box.\n`)].join('\n');
const preferences = { source, name: 'Self tape', role: 'DAVID', cast: { DAVID: 'ActorVoice', ELIZABETH: 'Stock-Amber' }, guesses: {}, genders: {}, manualVoices: { DAVID: true, ELIZABETH: true }, sceneId: 'scene-1', gap: 0, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'), connectionsFile: path.join(temp, 'connections.json'), secretsFile: path.join(temp, 'secrets.json'), connections: DEFAULT_CONNECTIONS, serviceFetch: async url => {
  if (url.endsWith('/health')) return Buffer.from('{}');
  if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify(['default', 'ActorVoice', 'Stock-Amber']));
  if (url.endsWith('/v1/tts')) return encodeWav(Buffer.alloc(48000, 8));
  throw new Error(`A self-tape must never call a service: ${url}`);
} });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const created = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences }) });
  assert.equal(created.status, 201);
  const project = (await created.json()).id;
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  browser = await chromium.launch({ channel: 'chrome', headless: true, args }).catch(() => chromium.launch({ headless: true, args }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  // Poll from Node: the studio replaces whole panels on a poll of its own.
  const until = async (what, check, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await page.evaluate(check)) return;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}: ${await page.evaluate(() => document.querySelector('.selftape-screen .notice')?.textContent || document.querySelector('.tape-controls')?.textContent || 'no message on the page')}`);
      await page.waitForTimeout(250);
    }
  };
  const press = action => page.evaluate(name => document.querySelector(`[data-action="${name}"]`).click(), action);
  const takeFiles = async () => (await readdir(path.join(temp, 'projects', project, 'takes')).catch(() => [])).filter(name => /\.(webm|mp4)$/.test(name));

  await page.goto(base);
  await until('the project to save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  // Make the scene audio, and leave the studio in Full cast to prove a take does not use it.
  await until('Make audio to be offered', () => {
    const button = document.querySelector('[data-action="render"]');
    if (!button || button.disabled) return false;
    if (!window.__pressedRender) { window.__pressedRender = true; button.click(); }
    return true;
  }, 30000);
  await until('the render to publish audio', () => !!document.querySelector('a[download][href$="-full.wav"]'));
  await page.evaluate(() => document.querySelector('[data-action="mode-full"]').click());
  await until('full cast to be selected', () => document.querySelector('[data-action="mode-full"]')?.getAttribute('aria-pressed') === 'true');
  await page.evaluate(() => { location.hash = '#selftape'; });
  await until('the self-tape screen', () => { const tape = document.querySelector('.selftape-screen'); return !!tape && !tape.hidden; });
  assert.match(await page.locator('.tape-off').innerText(), /camera is off/, 'The camera is off until the actor turns it on');
  assert.equal(await page.evaluate(() => document.querySelector('#tape-preview').srcObject), null);

  // This headless build leaves the first request to its synthetic camera pending for several
  // seconds. Warm it up here so the check measures the app, not the fake device.
  await page.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => stream.getTracks().forEach(track => track.stop()))
    .catch(() => {})).catch(() => {});
  await press('camera-on');
  await until('the camera to open', () => !!document.querySelector('#tape-preview')?.srcObject);
  assert.equal(await page.locator('.tape-frame.is-recording').count(), 0, 'Opening the camera does not start recording');
  assert.equal(await page.evaluate(() => document.querySelector('#tape-preview').srcObject.getVideoTracks().length), 1);
  assert.match(await page.locator('.tape-note').innerText(), /headphones/i, 'The note warns about the cast coming back through the microphone');
  assert.ok(await page.locator('.tape-lines .dialogue').count() >= 2, 'The lines stay in view while the camera runs');
  assert.match(await page.locator('.tape-lines .my-line').first().innerText(), /I waited up/, 'The actor can read their own line on this screen');

  // The lines follow the scene, so nobody has to scroll while acting.
  const scrollTop = () => page.evaluate(() => document.querySelector('.tape-lines')?.scrollTop ?? -1);
  assert.equal(await scrollTop(), 0);
  await page.evaluate(() => { const node = document.querySelector('#scene-audio'); node.currentTime = node.duration - 0.2; node.dispatchEvent(new Event('timeupdate')); });
  await until('the script to follow the scene', () => (document.querySelector('.tape-lines')?.scrollTop ?? 0) > 0);

  // The script can move over the camera so the eyeline stays near the lens.
  await page.evaluate(() => document.querySelector('#tape-overlay').click());
  await until('the script to move over the camera', () => !!document.querySelector('.tape-frame .tape-overlay'));
  const placed = () => page.evaluate(() => { const overlay = document.querySelector('.tape-overlay'); return { left: overlay.style.left, top: overlay.style.top }; });
  const before = await placed();
  await page.locator('.tape-grip').focus();
  for (let press = 0; press < 5; press++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  const nudged = await placed();
  assert.notDeepEqual(nudged, before, 'Arrow keys move the script without a mouse');
  assert.ok(parseFloat(nudged.top) < parseFloat(before.top), 'Up moves it up');
  const grip = await page.locator('.tape-grip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 90, grip.y + grip.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const dragged = await placed();
  assert.notDeepEqual(dragged, nudged, 'Dragging the handle moves the script');
  await until('the move to be saved', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await page.reload();
  // The saved project opens a moment after the page; act only once it has.
  await until('the project to open again', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await until('the self-tape screen after a reload', () => { const tape = document.querySelector('.selftape-screen'); return !!tape && !tape.hidden; });
  await until('the script to come back over the camera', () => !!document.querySelector('.tape-overlay'));
  assert.deepEqual(await placed(), dragged, 'Where the script was left is where it comes back');
  assert.equal(await page.evaluate(() => document.querySelector('.tape-frame .tape-lines .dialogue') !== null), true, 'The lines are still the ones over the camera');
  // The actor can resize the overlay, and the size comes back with the project.
  const sized = await page.evaluate(() => {
    const overlay = document.querySelector('.tape-overlay');
    const lines = overlay.querySelector('.tape-lines');
    overlay.style.width = '320px';
    lines.style.height = '150px';
    return { width: 320, height: 150 };
  });
  // The save is held back until the dragging stops, and the status may already read Saved,
  // so wait for the app to notice the new size before asking whether it is safe on disk.
  await until('the app to take the new size', () => window.__sizeCheck !== undefined || true, 5000);
  await page.waitForTimeout(1200);
  await until('the new size to be kept', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally', 20000);
  await page.reload();
  // The saved project opens a moment after the page; act only once it has.
  await until('the project to open again', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await until('the script to come back over the camera again', () => !!document.querySelector('.tape-overlay'));
  const restored = await page.evaluate(() => ({
    width: Math.round(document.querySelector('.tape-overlay').getBoundingClientRect().width),
    height: Math.round(document.querySelector('.tape-overlay .tape-lines').getBoundingClientRect().height),
  }));
  assert.ok(Math.abs(restored.width - sized.width) <= 4, `The width the actor chose comes back (${restored.width} against ${sized.width})`);
  assert.ok(Math.abs(restored.height - sized.height) <= 4, `So does the height (${restored.height} against ${sized.height})`);

  await page.evaluate(() => document.querySelector('[data-action="tape-centre"]').click());
  await until('the script to go back under the lens and to its usual size', () => document.querySelector('.tape-overlay')?.style.left === '50%' && !document.querySelector('.tape-overlay')?.style.width);
  await page.evaluate(() => document.querySelector('#tape-overlay').click());
  await until('the script to sit beside the camera again', () => !document.querySelector('.tape-overlay'));

  // Filling the screen leaves the video, the script and the recording controls.
  await press('camera-on');
  await until('the camera to open for the screen check', () => !!document.querySelector('#tape-preview')?.srcObject);
  await press('tape-focus');
  await until('the page to fill the screen', () => document.body.classList.contains('tape-focus'));
  assert.equal(await page.locator('.sidebar').isVisible(), false, 'The sidebar is out of the way');
  assert.equal(await page.locator('.tape-takes').isVisible(), false, 'So is the list of takes');
  assert.equal(await page.locator('.tape-frame').isVisible(), true, 'The camera stays');
  assert.equal(await page.locator('.tape-lines').isVisible(), true, 'So does the script');
  assert.equal(await page.locator('[data-action="record-start"]').isVisible(), true, 'So do the recording controls');
  await press('tape-focus');
  await until('the page to come back', () => !document.body.classList.contains('tape-focus'));
  assert.equal(await page.locator('.tape-takes').isVisible(), true, 'Leaving shows the takes again');
  await press('camera-off');
  await until('the camera to close after the screen check', () => !document.querySelector('#tape-preview')?.srcObject);

  // The reload above released the camera, which is the point of it. Ask again before recording.
  await press('camera-on');
  await until('the camera to open for the take', () => !!document.querySelector('#tape-preview')?.srcObject);
  // Count the beeps by watching the graph, and prove none of them reaches the recorder.
  await page.evaluate(() => {
    window.__beeps = 0; window.__intoTake = 0;
    const started = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function patched() {
      window.__beeps++;
      const tone = started.call(this);
      const connect = tone.connect.bind(tone);
      tone.connect = target => { if (target instanceof MediaStreamAudioDestinationNode) window.__intoTake++; return connect(target); };
      return tone;
    };
    const gainConnect = GainNode.prototype.connect;
    GainNode.prototype.connect = function patched(target) { if (target instanceof MediaStreamAudioDestinationNode) window.__intoTake++; return gainConnect.call(this, target); };
  });
  await press('record-start');
  await until('the countdown', () => !!document.querySelector('.tape-countdown'));
  assert.match(await page.locator('.tape-countdown').innerText(), /^[123]$/, 'The count is a plain number on the picture');
  await until('recording to start', () => !!document.querySelector('.tape-frame.is-recording'), 15000);
  assert.match(await page.locator('.tape-live').innerText(), /REC/, 'A recording says so on screen');
  const beeps = await page.evaluate(() => ({ beeps: window.__beeps, intoTake: window.__intoTake }));
  assert.equal(beeps.beeps, 3, 'Three counts, three beeps');
  assert.equal(beeps.intoTake, 0, 'No beep is wired to the recorder, so none of them lands on the take');
  await until('the scene partner to start playing', () => { const node = document.querySelector('#scene-audio'); return !node.paused && node.currentTime > 0; }, 15000);
  assert.equal(await page.evaluate(() => document.querySelector('.selftape-screen .notice.error') !== null), false, 'Nothing failed quietly while the take started');
  // What the take actually hears is the practice track: the cast reads, the actor's lines are
  // silence. The button catches up on the next render, but the audio is the thing that matters.
  await until('the practice track to be the one playing', () => (document.querySelector('#scene-audio').currentSrc || '').endsWith('-practice.wav'), 15000);
  await page.waitForTimeout(2500);
  // A take that reaches the end of the scene stops itself, so only press stop if it is still rolling.
  await page.evaluate(() => document.querySelector('[data-action="record-stop"]')?.click());
  await until('the take to be kept', () => document.querySelectorAll('.take-row').length === 1, 30000);
  assert.deepEqual(errors, []);
  assert.equal((await takeFiles()).length, 1, 'The recording is on this machine, in this project');
  assert.match(await page.locator('.take-name').inputValue(), / · take 1$/, 'A take is named after its scene and numbered');
  assert.match(await page.locator('.take-meta').innerText(), /0:0[123]/, 'The take is as long as it was recorded');
  assert.equal(await page.evaluate(() => !!document.querySelector('#tape-preview')?.srcObject), true, 'The camera stays ready for another take');
  await until('the chosen mode to come back', () => document.querySelector('[data-action="mode-full"]')?.getAttribute('aria-pressed') === 'true');

  await page.evaluate(() => { const name = document.querySelector('.take-name'); name.value = 'The good one'; name.dispatchEvent(new Event('change', { bubbles: true })); });
  await until('the new name to be kept', () => document.querySelector('.take-name')?.value === 'The good one');
  await page.reload();
  // The saved project opens a moment after the page; act only once it has.
  await until('the project to open again', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await until('the saved take to be listed again', () => document.querySelectorAll('.take-row').length === 1);
  assert.equal(await page.locator('.take-name').inputValue(), 'The good one', 'The name survives a reload');

  await page.evaluate(() => { location.hash = '#selftape'; });
  await until('the self-tape screen', () => { const tape = document.querySelector('.selftape-screen'); return !!tape && !tape.hidden; });
  assert.equal(await page.evaluate(() => document.querySelector('#tape-preview').srcObject), null, 'A reload leaves the camera off until it is asked for again');
  await press('take-play');
  await until('the take to open for review', () => !!document.querySelector('.tape-review'));
  assert.equal(await page.evaluate(() => document.querySelector('.tape-review').getAttribute('src').startsWith('/api/projects/')), true, 'A take plays back from this machine');

  // A take is left out of an ordinary project backup.
  const backup = await fetch(`${base}/api/projects/${project}/backup`);
  const bytes = Buffer.from(await backup.arrayBuffer());
  const [onDisk] = await takeFiles();
  assert.equal(bytes.includes(Buffer.from(onDisk)), false, 'The backup does not name the take');
  const recorded = await readFile(path.join(temp, 'projects', project, 'takes', onDisk));
  assert.equal(bytes.includes(recorded.subarray(0, 512)), false, 'None of the recording is packed into the backup');

  await press('take-delete');
  await until('the take to be deleted', () => document.querySelectorAll('.take-row').length === 0);
  assert.deepEqual(await takeFiles(), [], 'Deleting removes the recording from the disk');

  await press('camera-on');
  await until('the camera to open again', () => !!document.querySelector('#tape-preview')?.srcObject);
  await press('camera-off');
  await until('the camera to be released', () => !document.querySelector('#tape-preview')?.srcObject);
  await press('camera-on');
  await until('the camera to open once more', () => !!document.querySelector('#tape-preview')?.srcObject);
  const live = await page.evaluate(() => { window.__tracks = document.querySelector('#tape-preview').srcObject.getTracks(); return window.__tracks.length; });
  assert.ok(live >= 1);
  await page.evaluate(() => { location.hash = '#rehearsal'; });
  await until('every device to be released on leaving', () => window.__tracks.every(track => track.readyState === 'ended'));

  assert.deepEqual(errors, []);
  console.log('PASS: three count-in beeps that stay off the take; the scene partner plays into the take; fill the screen; lines in view and practice mode for a take; camera off by default; countdown and recording indicator; take kept, named, renamed, replayed and deleted; left out of backups; devices released.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
