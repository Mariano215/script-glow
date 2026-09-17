import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { choose, fitsWidth, launch, openStudio, preferences, press, studio, tone, until } from './lib.mjs';

// Deterministic media fixture: tests actual browser audio timing, not voice quality.
const duration = 100;
const wav = tone(duration);
const headings = ['12 INT.REHEARSAL ROOM - DAY 12', '13 EXT. STAGE - NIGHT 13', 'ACT I, SCENE II', 'SCENE: 3', 'SCENE ELEVEN', '.THE GARDEN'];
const source = headings.map((heading, scene) => `${heading}\n\n${Array.from({ length: 8 }, (_, line) => `${line % 2 ? 'JORDAN' : 'PARTNER'}: Scene ${scene + 1}, line ${line + 1}. We will rehearse every moment together.`).join('\n')}`).join('\n\n');
const app = await studio({ projects: [preferences(source, { name: 'Six scenes' })] });
await mkdir(path.join(app.temp, 'cache', 'renders'), { recursive: true });
const browser = await launch();
const saved = page => until(page, 'the project to save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
const PAPER = '.script-panel .script-paper-scroll';
try {
  const page = await openStudio(browser, app.base, { hash: '#rehearsal' });
  await page.route('**/api/casting/guess-genders', route => route.fulfill({ json: { guesses: route.request().postDataJSON().names.map(name => ({ name, gender: 'unknown' })) } }));
  let request;
  let renderCount = 0;
  await page.route('**/api/render', route => { request = route.request().postDataJSON(); renderCount++; return route.fulfill({ status: 202, json: { jobId: 'highlight-fixture' } }); });
  // The fixture is attached to the project the way a real job is, so a reload restores it.
  const attached = new Map();
  await page.route('**/api/jobs/highlight-fixture', async route => {
    if (!attached.has(request.renderKey)) {
      const token = randomUUID();
      for (const mode of ['full', 'practice']) await writeFile(path.join(app.temp, 'cache', 'renders', `${token}-${mode}.wav`), wav);
      const cues = request.scene.lines.filter(line => line.kind === 'dialogue').map((line, index) => ({ lineId: line.id, character: line.character, start: index * 2, end: index * 2 + 1.5 }));
      const response = await fetch(`${app.base}/api/projects/${request.projectId}/renders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: request.renderKey, result: { fullUrl: `/audio/${token}-full.wav`, practiceUrl: `/audio/${token}-practice.wav`, duration, cues } }) });
      assert.equal(response.status, 200, await response.clone().text());
      attached.set(request.renderKey, (await response.json()).result);
    }
    const total = request.scene.lines.length;
    return route.fulfill({ json: { id: 'highlight-fixture', status: 'complete', completed: total, total, result: attached.get(request.renderKey) } });
  });
  const seek = async position => {
    await until(page, 'the audio to be seekable', () => document.querySelector('audio').readyState >= 2 && !document.querySelector('audio').seeking);
    await page.evaluate(at => { document.querySelector('audio').currentTime = at; }, position);
    await until(page, `the audio at ${position}`, at => Math.abs(document.querySelector('audio').currentTime - at) < 0.1 && !document.querySelector('audio').seeking, position);
  };
  const scrollTop = () => page.locator(PAPER).evaluate(node => node.scrollTop);
  const centered = () => {
    const node = document.querySelector('.script-page .dialogue.active');
    if (!node) return false;
    const block = node.getBoundingClientRect(), frame = node.closest('.script-paper-scroll').getBoundingClientRect();
    return Math.abs((block.top + block.bottom) / 2 - (frame.top + frame.bottom) / 2) < 2;
  };
  const makeAudio = async () => {
    const before = renderCount;
    await until(page, 'Make audio to be offered', () => document.querySelector('[data-action="render"]')?.disabled === false);
    await press(page, '[data-action="render"]');
    const gaveUp = Date.now() + 60000;
    while (renderCount === before) {
      if (Date.now() > gaveUp) throw new Error('Timed out waiting for the render request');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await until(page, 'the audio', () => document.querySelectorAll('a[download]').length === 2);
  };

  // Six differently written headings are six scenes, plus the full script.
  await until(page, 'the scene list', () => document.querySelectorAll('#scene-select option').length === 7);
  assert.equal(await page.locator('[data-action="scene"]').count(), 6);
  await choose(page, '#my-role', 'JORDAN');
  for (let index = 1; index <= 6; index++) {
    await choose(page, '#scene-select', `scene-${index}`);
    await until(page, `scene ${index}`, at => document.querySelector('.script-page .dialogue')?.innerText.includes(`Scene ${at}, line 1`), index);
    assert.equal(await page.locator('.script-page .dialogue').count(), 8);
  }
  await saved(page);
  await makeAudio();
  assert.equal(request.scene.id, 'scene-6');
  assert.equal(request.scope, undefined);
  assert.equal(request.scene.lines.filter(line => line.kind === 'dialogue').length, 8);
  await choose(page, '#scene-select', 'full-script');
  await until(page, 'the full script', () => document.querySelectorAll('.script-scene-heading').length === 6);
  await makeAudio();
  assert.equal(request.scope, 'script');
  assert.equal(request.scene.lines.filter(line => line.kind === 'dialogue').length, 48);

  // Seeking highlights the spoken line and follows it inside the paper, centred.
  await until(page, 'audio metadata', () => document.querySelector('audio').readyState >= 1);
  await seek(40.25);
  assert.match(await page.locator('.script-page .dialogue.active').innerText(), /Scene 3, line 5/);
  const colours = await page.evaluate(() => ({
    active: getComputedStyle(document.querySelector('.script-page .dialogue.active > p')).backgroundColor,
    idle: getComputedStyle(document.querySelector('.script-page .dialogue:not(.active):not(.character-highlight) > p')).backgroundColor,
  }));
  assert.notEqual(colours.active, 'rgba(0, 0, 0, 0)', 'The spoken line is highlighted');
  assert.notEqual(colours.active, colours.idle, 'The spoken line stands out from the others');
  assert.equal(await page.locator('.script-page [aria-current="true"]').count(), 1);
  assert.ok(await scrollTop() > 400, 'Seeking a later cue follows within paper');
  await until(page, 'the active line to be centred', centered);
  const documentTop = await page.evaluate(() => scrollY);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator(PAPER).evaluate(node => {
    const original = node.scrollTo.bind(node);
    node.scrollTo = options => { node.dataset.lastScrollBehavior = options.behavior; original(options); };
  });
  await seek(44.25);
  assert.equal(await page.locator(PAPER).getAttribute('data-last-scroll-behavior'), 'smooth');
  await until(page, 'the next line to be centred', centered);
  assert.equal(await page.evaluate(() => scrollY), documentTop, 'Follow must not scroll outer app');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await choose(page, '#follow-playback', false);
  await page.locator(PAPER).evaluate(node => node.scrollTo({ top: 0, behavior: 'instant' }));
  await seek(48.25);
  assert.equal(await scrollTop(), 0, 'Follow off keeps reading position');

  // Practice with hidden lines: the highlight never reveals your line.
  await choose(page, '#hide-lines', true);
  await press(page, '[data-action="mode-practice"]');
  await seek(50.25);
  assert.equal(await page.locator('.script-page .dialogue.active.practice-turn .hidden-line').count(), 1);
  assert.ok(!(await page.locator('.script-page .dialogue.active').innerText()).includes('We will rehearse'), 'Highlight must not reveal hidden dialogue');
  const hiddenActive = await page.locator('.script-page .dialogue.active > .hidden-line').evaluate(node => getComputedStyle(node).backgroundColor);
  assert.notEqual(hiddenActive, 'rgba(0, 0, 0, 0)', 'Your hidden turn is highlighted');
  assert.equal(await scrollTop(), 0, 'UI refresh preserves manual reading position');
  await choose(page, '#follow-playback', true);
  await until(page, 'follow to catch up', () => document.querySelector('.script-panel .script-paper-scroll').scrollTop > 400);
  const countBefore = renderCount;
  await press(page, '[data-action="loop"]');
  assert.ok(await scrollTop() > 400, 'Unrelated toggle preserves scroll');
  assert.equal(renderCount, countBefore, 'Reading controls never make audio again');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator(PAPER).evaluate(node => node.scrollTo({ top: 0, behavior: 'instant' }));
  await press(page, '[data-action="play"]');
  await until(page, 'playback', () => !document.querySelector('audio').paused);
  assert.match(await page.locator('#player-status').innerText(), /Your turn/);
  await until(page, 'playback to follow the line', centered);
  await press(page, '[data-action="play"]');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seek(50.25);

  // Print drops the playback highlight; your character marks stay.
  const idleMine = await page.locator('.script-page .dialogue.my-line:not(.active) > .hidden-line').first().evaluate(node => getComputedStyle(node).backgroundColor);
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => ({
    active: getComputedStyle(document.querySelector('.script-page .dialogue.active > .hidden-line')).backgroundColor,
    mine: getComputedStyle(document.querySelector('.script-page .dialogue.my-line:not(.active) > .hidden-line')).backgroundColor,
  }));
  assert.equal(printed.active, printed.mine, 'Print shows the active line like any other of your lines');
  await page.emulateMedia({ media: 'screen' });
  assert.notEqual(hiddenActive, idleMine, 'On screen the active line differs from your other lines');
  await seek(51.75);
  assert.equal(await page.locator('.script-page [data-line].active').count(), 0, 'Gap clears highlight');
  await saved(page);

  // Reload keeps the scope, follow and audio.
  await page.reload(); await saved(page);
  await until(page, 'restored audio', () => document.querySelectorAll('a[download]').length === 2);
  assert.equal(await page.evaluate(() => document.querySelector('#scene-select').value), 'full-script');
  assert.ok(await page.evaluate(() => document.querySelector('#follow-playback').checked));

  // Phone: the page reflows to the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await choose(page, '#scene-select', 'scene-6');
  await until(page, 'scene 6', () => document.querySelectorAll('.script-page .dialogue').length === 8);
  assert.equal(await page.locator('#scene-select option').count(), 7);
  assert.ok(await fitsWidth(page));
  assert.ok(await page.locator('.script-panel .script-page').evaluate(node => node.getBoundingClientRect().width < 390), 'The page fits the phone');

  // A script with no headings is one scene and says why.
  await saved(page);
  await page.locator('#file-input').setInputFiles({ name: 'No headings.txt', mimeType: 'text/plain', buffer: Buffer.from('JORDAN: Hello.\nPARTNER: Welcome.') });
  await until(page, 'the new project', () => document.querySelectorAll('#scene-select option').length === 2);
  await until(page, 'the heading notice', () => /No scene headings/i.test([...document.querySelectorAll('.notice')].map(node => node.textContent).join(' ')));
  assert.deepEqual(page.errors, []);
  console.log('PASS: six selectable scenes + full scope; timed highlights; seeking/follow on/off; hidden silent practice; scroll preservation; print reset; persistence; phone; missing-heading diagnosis. Audio uses a deterministic fixture.');
} finally { await browser.close(); await app.close(); }
