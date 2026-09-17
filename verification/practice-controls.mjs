import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { encodeWav } from '../server/audio.js';

// Real UI and project API, isolated disk library, no TTS call. No production data.
const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-practice-'));
const source = [
  'SCENE 1\n\nThe kitchen is dark and the kettle is cold.\n\nDAVID: I waited up for you tonight.\n\nELIZABETH: You did not have to wait for me.\n\nDAVID: I know that. I wanted to wait.\n',
  'SCENE 2\n\nELIZABETH: The house is quiet without anyone else in it.\n',
  'SCENE 3\n\nDAVID stands at the window and says nothing at all.\n\nELIZABETH: You can come back inside now.\n',
].join('\n');
const preferences = { source, name: 'Listen only', role: 'DAVID', cast: { DAVID: 'ActorVoice', ELIZABETH: 'Stock-Amber' }, guesses: {}, genders: {}, manualVoices: { DAVID: true, ELIZABETH: true }, sceneId: 'scene-1', gap: 0, directions: true, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'), connectionsFile: path.join(temp, 'connections.json'), secretsFile: path.join(temp, 'secrets.json'), connections: DEFAULT_CONNECTIONS, serviceFetch: async url => {
  if (url.endsWith('/health')) return Buffer.from('{}');
  if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify(['default', 'ActorVoice', 'Stock-Amber']));
  if (url.endsWith('/v1/tts')) return encodeWav(Buffer.alloc(48000, 8));
  throw new Error(`Unexpected service call ${url}`);
} });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const created = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences }) });
  assert.equal(created.status, 201);
  // Installed Chrome matches what the actor runs; the bundled build keeps this runnable on a machine without it.
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })).newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Poll from Node on a plain timer. The studio replaces whole panels on a poll of its own, so a
  // condition watched from inside the page can be missed even when the page is in the wanted state.
  const until = async (what, check, timeout = 90000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await page.evaluate(check)) return;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}: ${await page.evaluate(() => JSON.stringify({ save: document.querySelector('#project-save-status')?.textContent, job: document.querySelector('.job-error')?.textContent, notice: document.querySelector('.notice')?.textContent, button: document.querySelector('[data-action="render"]')?.textContent }))}`);
      await page.waitForTimeout(250);
    }
  };
  const saved = () => until('the project to save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  // Toggle in the page: the studio replaces panels on a poll, so a node held by a locator can
  // be gone before the click lands.
  const toggle = (id, on) => page.evaluate(([selector, wanted]) => {
    const box = document.querySelector(selector);
    if (!box) throw new Error(`No control ${selector} on the page`);
    if (box.checked !== wanted) box.click();
    return box.checked;
  }, [id, on]);
  const shown = () => page.locator('.dialogue > p').allInnerTexts();
  const visible = selector => page.locator(selector).first().evaluate(node => getComputedStyle(node).visibility);

  await page.goto(base); await saved();
  const total = await page.locator('.dialogue').count();
  assert.equal(total, 3);
  assert.equal((await shown()).length, 3, 'Dialogue is readable before listen only');

  await toggle('#listen-only', true); await saved();
  assert.deepEqual(await shown(), [], 'Listen only leaves no dialogue text on the page');
  assert.equal(await page.locator('.hidden-line').count(), total, 'Every character is covered, not only the actor');
  assert.equal(await visible('.character-label'), 'hidden', 'Character names cannot be read ahead');
  assert.equal(await visible('.direction'), 'hidden', 'Stage directions are hidden too');
  assert.equal(await page.locator('.direction').evaluate(node => node.getBoundingClientRect().height > 0), true, 'Hidden text keeps its space so the page does not jump');
  assert.equal(await page.evaluate(() => document.querySelector('#hide-lines').disabled), true, 'Hide my lines is included in listen only');

  await page.evaluate(() => document.querySelector('.hidden-line').click());
  assert.deepEqual(await shown(), ['I waited up for you tonight.'], 'One line reveals without leaving listen only');
  assert.equal(await page.locator('.dialogue:not(.listening) .character-label').first().evaluate(node => getComputedStyle(node).visibility), 'visible');

  await page.reload(); await saved();
  assert.equal(await page.evaluate(() => document.querySelector('#listen-only').checked), true, 'Listen only survives a reload');
  assert.deepEqual(await shown(), [], 'A reload re-hides a revealed line');

  await toggle('#listen-only', false); await saved();
  assert.equal((await shown()).length, 3, 'Turning listen only off restores the script');

  // First letters prompt a hidden line without giving it away.
  await toggle('#hide-lines', true); await saved();
  await toggle('#first-letters', true); await saved();
  assert.equal(await page.locator('.my-line .hint-text').first().innerText(), 'I w u f y t.', 'The prompt keeps the shape of the line and none of its words');
  assert.equal(await page.locator('.my-line .hidden-stroke').count(), 0, 'The blank strokes give way to the prompt');
  assert.deepEqual(await shown(), ['You did not have to wait for me.'], 'Only the actor\'s own lines are prompted');
  await toggle('#first-letters', false);
  await toggle('#hide-lines', false); await saved();

  // Scene tabs mark every scene the actor is in, including a silent appearance.
  const marked = await page.locator('.scenes .scene-tab[data-action="scene"]').evaluateAll(tabs => tabs.map(tab => tab.classList.contains('has-role')));
  assert.deepEqual(marked, [true, false, true], 'Speaking and unspoken scenes are marked; a scene without the actor is not');
  assert.match(await page.locator('.scene-tab.has-role small').first().innerText(), /· YOU/, 'The mark is readable, not colour alone');
  await page.locator('#my-role').selectOption('ELIZABETH'); await saved();
  assert.deepEqual(await page.locator('.scenes .scene-tab[data-action="scene"]').evaluateAll(tabs => tabs.map(tab => tab.classList.contains('has-role'))), [true, true, true], 'Changing the actor moves the marks');
  await page.locator('#my-role').selectOption('DAVID'); await saved();

  // Speed must not shorten the silence the actor speaks into.
  // Make audio is disabled while the studio saves, and the panel is re-rendered on a poll, so
  // wait for the button to be offered and press it exactly once. Pressing again restarts the job.
  await until('Make audio to be offered', () => {
    const button = document.querySelector('[data-action="render"]');
    if (!button || button.disabled) return false;
    if (!window.__pressedRender) { window.__pressedRender = true; button.click(); }
    return true;
  }, 30000);
  await until('the render to publish audio', () => !!document.querySelector('a[download][href$="-full.wav"]'));
  // Rendering can leave the studio on the Cast screen; the practice controls live on Rehearsal.
  await page.evaluate(() => { location.hash = '#rehearsal'; });
  await until('the rehearsal screen', () => { const panel = document.querySelector('.settings-panel'); return !!panel && panel.offsetParent !== null; }, 20000);
  await page.evaluate(() => document.querySelector('[data-action="mode-practice"]').click());
  await page.locator('#playback-rate').selectOption('1.5');
  const duration = await page.locator('#scene-audio').evaluate(node => node.duration || 0);
  assert.ok(duration > 0, 'The mocked render produced playable audio');
  let sawTurn = false, sawOther = false;
  for (let at = 0.05; at < duration; at += 0.2) {
    const state = await page.locator('#scene-audio').evaluate((node, time) => {
      node.currentTime = time; node.dispatchEvent(new Event('timeupdate'));
      return { rate: node.playbackRate, turn: !!document.querySelector('.practice-turn'), active: !!document.querySelector('[data-line].active') };
    }, at);
    if (state.turn) { sawTurn = true; assert.equal(state.rate, 1, `The actor's own pause stays at 1x at ${at.toFixed(2)}s`); }
    else if (state.active) { sawOther = true; assert.equal(state.rate, 1.5, `A read line follows the chosen speed at ${at.toFixed(2)}s`); }
  }
  assert.ok(sawTurn && sawOther, 'The sweep covered both the actor\'s turn and a read line');
  await page.evaluate(() => document.querySelector('[data-action="mode-full"]').click());
  const fullRate = await page.locator('#scene-audio').evaluate(node => { node.currentTime = 0.05; node.dispatchEvent(new Event('timeupdate')); return node.playbackRate; });
  assert.equal(fullRate, 1.5, 'Full cast reads the actor aloud, so their line speeds up too');
  await page.locator('#scene-audio').evaluate(node => node.pause());

  // Wait for me stops on the actor's silent turn and Space carries on with the next cue.
  await page.evaluate(() => document.querySelector('[data-action="mode-practice"]').click());
  await toggle('#wait-for-me', true); await saved();
  await page.evaluate(() => document.querySelector('[data-action="play"]').click());
  await until('playback to start', () => !document.querySelector('#scene-audio').paused);
  let waitedAt = null;
  for (let at = 0.05; at < duration && waitedAt === null; at += 0.2) {
    const state = await page.evaluate(time => {
      const node = document.querySelector('#scene-audio');
      node.currentTime = time; node.dispatchEvent(new Event('timeupdate'));
      return { paused: node.paused, at: node.currentTime, status: document.querySelector('#player-status')?.textContent };
    }, at);
    if (state.paused) { waitedAt = state.at; assert.match(state.status, /Your turn/, 'The player says whose turn it is'); }
  }
  assert.notEqual(waitedAt, null, 'Playback stopped on the actor\'s line');
  assert.match(await page.locator('.practice-hint').innerText(), /Press Space/, 'The card says how to carry on');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Space');
  await until('playback to resume past the actor\'s line', () => !document.querySelector('#scene-audio').paused);
  assert.ok(await page.evaluate(time => document.querySelector('#scene-audio').currentTime > time, waitedAt), 'Resuming skips the silence instead of replaying it');
  await page.evaluate(() => document.querySelector('#scene-audio').pause());
  await toggle('#wait-for-me', false); await saved();

  // Arrow keys step whole cues.
  const stepped = await page.evaluate(() => { const node = document.querySelector('#scene-audio'); node.currentTime = 0; return node.currentTime; });
  assert.equal(stepped, 0);
  await page.keyboard.press('ArrowRight');
  const forward = await page.evaluate(() => document.querySelector('#scene-audio').currentTime);
  assert.ok(forward > 0, 'Right steps on to the next cue');
  await page.keyboard.press('ArrowLeft');
  assert.ok(await page.evaluate(time => document.querySelector('#scene-audio').currentTime < time, forward), 'Left steps back');

  // A and B mark an exchange, and the loop button repeats just that span.
  await page.evaluate(() => { const node = document.querySelector('#scene-audio'); node.currentTime = 0.05; node.dispatchEvent(new Event('timeupdate')); });
  await page.evaluate(() => document.querySelector('[data-action="mark-a"]').click()); await saved();
  const markA = await page.evaluate(() => document.querySelector('#scene-audio').currentTime);
  await page.evaluate(time => { const node = document.querySelector('#scene-audio'); node.currentTime = time; node.dispatchEvent(new Event('timeupdate')); }, duration / 2);
  await page.evaluate(() => document.querySelector('[data-action="mark-b"]').click()); await saved();
  assert.match(await page.locator('.practice-hint').innerText(), /loop button/, 'Marking alone does not start repeating');
  await page.evaluate(() => document.querySelector('[data-action="loop"]').click()); await saved();
  assert.equal(await page.evaluate(() => document.querySelector('#scene-audio').loop), false, 'The whole-file loop gives way to the marked span');
  const wrapped = await page.evaluate(() => { const node = document.querySelector('#scene-audio'); node.currentTime = node.duration - 0.01; node.dispatchEvent(new Event('timeupdate')); return node.currentTime; });
  assert.ok(wrapped <= markA + 0.3, `Playing past B returns to A, not to the end of the scene (landed at ${wrapped})`);
  await page.evaluate(() => document.querySelector('[data-action="clear-marks"]').click()); await saved();
  assert.equal(await page.evaluate(() => document.querySelector('#scene-audio').loop), true, 'With no marks the loop button repeats the whole scene again');
  await page.evaluate(() => document.querySelector('[data-action="loop"]').click()); await saved();

  // Clicking a line moves the playhead to it, so play carries on from there.
  await page.evaluate(() => { const node = document.querySelector('#scene-audio'); node.pause(); node.currentTime = 0; });
  const third = await page.evaluate(() => {
    const line = document.querySelectorAll('#script-page .dialogue')[2];
    line.click();
    return { at: document.querySelector('#scene-audio').currentTime, id: line.dataset.line };
  });
  assert.ok(third.at > 0, 'A click on the third line moves the playhead past the first two');
  assert.equal(await page.evaluate(() => document.querySelector('[data-line].active')?.dataset.line), third.id, 'The clicked line becomes the current one');
  assert.equal(await page.evaluate(() => document.querySelector('#scene-audio').paused), true, 'Clicking a line does not start playing on its own');

  // Additive rehearsal: the block repeats, then takes in one more of the actor's lines.
  await page.evaluate(() => { const node = document.querySelector('#scene-audio'); node.currentTime = 0; return node.play(); });
  await toggle('#build-up', true); await saved();
  assert.match(await page.locator('.practice-hint').innerText(), /Learning up to line 1 of \d+, time 1 of 2/, 'It starts on the first line, first time through');
  const runPastBlock = () => page.evaluate(() => { const node = document.querySelector('#scene-audio'); node.currentTime = node.duration - 0.01; node.dispatchEvent(new Event('timeupdate')); return node.currentTime; });
  assert.ok(await runPastBlock() < 0.3, 'Reaching the end of the block goes back to the top');
  await until('the second time through', () => /time 2 of 2/.test(document.querySelector('.practice-hint')?.textContent ?? ''));
  await runPastBlock();
  await until('the block to grow by a line', () => /Learning up to line 2 of/.test(document.querySelector('.practice-hint')?.textContent ?? ''));
  assert.match(await page.locator('.practice-hint').innerText(), /time 1 of 2/, 'A bigger block starts its repeats again');
  await page.evaluate(() => document.querySelector('[data-action="build-restart"]').click());
  await until('the build to start again', () => /Learning up to line 1 of/.test(document.querySelector('.practice-hint')?.textContent ?? ''));
  await toggle('#build-up', false); await saved();
  await page.evaluate(() => document.querySelector('#scene-audio').pause());

  assert.deepEqual(errors, []);
  console.log('PASS: click a line to play from it, additive rehearsal, listen only, first-letter prompts, scene marks, protected pause, wait for me, cue steps, and an A to B repeat.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
