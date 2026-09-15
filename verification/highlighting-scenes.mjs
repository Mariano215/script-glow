import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Deterministic media fixture: tests actual browser audio timing, not TTS quality.
const duration = 100;
const pcmLength = 8000 * 2 * duration;
const wav = Buffer.alloc(44 + pcmLength);
wav.write('RIFF'); wav.writeUInt32LE(36 + pcmLength, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcmLength, 40);
const headings = ['12 INT.REHEARSAL ROOM - DAY 12', '13 EXT. STAGE - NIGHT 13', 'ACT I, SCENE II', 'SCENE: 3', 'SCENE ELEVEN', '.THE GARDEN'];
const source = headings.map((heading, scene) => `${heading}\n\n${Array.from({ length: 8 }, (_, line) => `${line % 2 ? 'JORDAN' : 'PARTNER'}: Scene ${scene + 1}, line ${line + 1}. We will rehearse every moment together.`).join('\n')}`).join('\n\n');
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
await page.route('**/api/casting/guess-genders', route => route.fulfill({ json: { guesses: route.request().postDataJSON().names.map(name => ({ name, gender: 'unknown' })) } }));
const errors = []; page.on('pageerror', error => errors.push(error.message));
let request;
let renderCount = 0;
await page.route('**/api/health', route => route.fulfill({ json: { tts: { ok: true }, stt: { ok: true } } }));
await page.route('**/api/voices', route => route.fulfill({ json: { voices: ['MyVoice', 'Stock-Mica', 'Stock-Granite'] } }));
await page.route('**/api/render', route => { request = route.request().postDataJSON(); renderCount++; return route.fulfill({ status: 202, json: { jobId: 'highlight-fixture' } }); });
await page.route('**/api/jobs/highlight-fixture', route => route.fulfill({ json: {
  id: 'highlight-fixture', status: 'complete', completed: request.scene.lines.length, total: request.scene.lines.length,
  result: { fullUrl: '/audio/highlight-fixture-full.wav', practiceUrl: '/audio/highlight-fixture-practice.wav', duration,
    cues: request.scene.lines.filter(line => line.kind === 'dialogue').map((line, index) => ({ lineId: line.id, character: line.character, start: index * 2, end: index * 2 + 1.5 })) },
} }));
await page.route('**/audio/highlight-fixture-*.wav', route => {
  const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!range) return route.fulfill({ contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: wav });
  const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
  return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wav.length}` }, body: wav.subarray(start, end + 1) });
});
const seek = async position => {
  await page.waitForFunction(() => document.querySelector('audio').readyState >= 2 && !document.querySelector('audio').seeking);
  await page.locator('audio').evaluate((audio, position) => { audio.currentTime = position; }, position);
  await page.waitForFunction(position => Math.abs(document.querySelector('audio').currentTime - position) < 0.1 && !document.querySelector('audio').seeking, position);
};
try {
  await page.goto('http://127.0.0.1:3001');
  await page.locator('#file-input').setInputFiles({ name: 'Six scenes.fountain', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.waitForFunction(() => document.querySelectorAll('#scene-select option').length === 7);
  assert.equal(await page.locator('[data-action="scene"]').count(), 6);
  await page.locator('#my-role').selectOption('JORDAN');
  for (let index = 1; index <= 6; index++) {
    await page.locator('#scene-select').selectOption(`scene-${index}`);
    assert.equal(await page.locator('.dialogue').count(), 8);
    assert.match(await page.locator('.dialogue').first().innerText(), new RegExp(`Scene ${index}, line 1`));
  }
  await page.locator('[data-action="render"]').click();
  await page.locator('a[download]').first().waitFor();
  assert.equal(request.scene.id, 'scene-6');
  assert.equal(request.scope, undefined);
  assert.equal(request.scene.lines.filter(line => line.kind === 'dialogue').length, 8);
  await page.locator('#scene-select').selectOption('full-script');
  assert.equal(await page.locator('.script-scene-heading').count(), 6);
  await page.locator('[data-action="render"]').click();
  await page.locator('a[download]').first().waitFor();
  assert.equal(request.scope, 'script');
  assert.equal(request.scene.lines.filter(line => line.kind === 'dialogue').length, 48);
  await page.locator('audio').evaluate(audio => new Promise(resolve => { if (audio.readyState >= 1) resolve(); else audio.addEventListener('loadedmetadata', resolve, { once: true }); }));
  await seek(40.25);
  assert.match(await page.locator('.dialogue.active').innerText(), /Scene 3, line 5/);
  assert.equal(await page.locator('.dialogue.active > p').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 228, 163)');
  assert.equal(await page.locator('[aria-current="true"]').count(), 1);
  const scrollPosition = await page.locator('.script-paper-scroll').evaluate(node => node.scrollTop);
  assert.ok(scrollPosition > 400, 'Seeking a later cue follows within paper');
  const bounds = await page.locator('.dialogue.active').evaluate(node => {
    const block = node.getBoundingClientRect(), frame = node.closest('.script-paper-scroll').getBoundingClientRect();
    return block.top >= frame.top && block.bottom <= frame.bottom;
  });
  assert.ok(bounds, 'Active block visible vertically');
  const centered = () => page.locator('.dialogue.active').evaluate(node => {
    const block = node.getBoundingClientRect(), frame = node.closest('.script-paper-scroll').getBoundingClientRect();
    return Math.abs((block.top + block.bottom) / 2 - (frame.top + frame.bottom) / 2);
  });
  assert.ok(await centered() < 2, 'Highlighted dialogue should be centered in the paper pane');
  const documentTop = await page.evaluate(() => scrollY);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.script-paper-scroll').evaluate(node => {
    const original = node.scrollTo.bind(node);
    node.scrollTo = options => { node.dataset.lastScrollBehavior = options.behavior; original(options); };
  });
  await seek(44.25);
  assert.equal(await page.locator('.script-paper-scroll').getAttribute('data-last-scroll-behavior'), 'smooth');
  await page.waitForFunction(() => {
    const node = document.querySelector('.dialogue.active');
    const block = node.getBoundingClientRect(), frame = node.closest('.script-paper-scroll').getBoundingClientRect();
    return Math.abs((block.top + block.bottom) / 2 - (frame.top + frame.bottom) / 2) < 2;
  });
  assert.equal(await page.evaluate(() => scrollY), documentTop, 'Follow must not scroll outer app');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#follow-playback').uncheck();
  await page.locator('.script-paper-scroll').evaluate(node => node.scrollTo({ top: 0, behavior: 'instant' }));
  await seek(48.25);
  assert.equal(await page.locator('.script-paper-scroll').evaluate(node => node.scrollTop), 0, 'Follow off keeps reading position');
  await page.locator('#hide-lines').check();
  await page.locator('[data-action="mode-practice"]').click();
  await seek(50.25);
  assert.equal(await page.locator('.dialogue.active.practice-turn .hidden-line').count(), 1);
  assert.ok(!(await page.locator('.dialogue.active').innerText()).includes('We will rehearse'), 'Highlight must not reveal hidden dialogue');
  assert.equal(await page.locator('.dialogue.active > .hidden-line').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(213, 233, 201)');
  assert.equal(await page.locator('.script-paper-scroll').evaluate(node => node.scrollTop), 0, 'UI refresh preserves manual reading position');
  await page.locator('#follow-playback').check();
  assert.ok(await page.locator('.script-paper-scroll').evaluate(node => node.scrollTop > 400));
  const countBefore = renderCount;
  await page.locator('[data-action="loop"]').click();
  assert.ok(await page.locator('.script-paper-scroll').evaluate(node => node.scrollTop > 400), 'Unrelated toggle preserves scroll');
  assert.equal(renderCount, countBefore, 'Reading controls never regenerate audio');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.script-paper-scroll').evaluate(node => node.scrollTo({ top: 0, behavior: 'instant' }));
  await page.locator('[data-action="play"]').click();
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  assert.match(await page.locator('#player-status').innerText(), /Your turn/);
  await page.waitForFunction(() => {
    const node = document.querySelector('.dialogue.active');
    if (!node) return false;
    const block = node.getBoundingClientRect(), frame = node.closest('.script-paper-scroll').getBoundingClientRect();
    return Math.abs((block.top + block.bottom) / 2 - (frame.top + frame.bottom) / 2) < 2;
  });
  await page.locator('[data-action="play"]').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seek(50.25);
  await page.screenshot({ path: 'artifacts/highlight-scenes-desktop.png', fullPage: true });
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.dialogue.active > .hidden-line').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.emulateMedia({ media: 'screen' });
  await seek(51.75);
  assert.equal(await page.locator('[data-line].active').count(), 0, 'Gap clears highlight');
  await page.reload();
  await page.locator('a[download]').first().waitFor();
  assert.equal(await page.locator('#scene-select').inputValue(), 'full-script');
  assert.ok(await page.locator('#follow-playback').isChecked());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#scene-select').selectOption('scene-6');
  assert.equal(await page.locator('.dialogue').count(), 8);
  assert.equal(await page.locator('#scene-select option').count(), 7);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await page.locator('.script-page').evaluate(node => node.getBoundingClientRect().width), 816);
  await page.screenshot({ path: 'artifacts/highlight-scenes-mobile.png', fullPage: true });
  await page.locator('#file-input').setInputFiles({ name: 'No headings.txt', mimeType: 'text/plain', buffer: Buffer.from('JORDAN: Hello.\nPARTNER: Welcome.') });
  await page.waitForFunction(() => document.querySelectorAll('#scene-select option').length === 2);
  assert.match(await page.locator('.notice').allTextContents().then(items => items.join(' ')), /No scene headings/i);
  assert.deepEqual(errors, []);
  console.log('PASS: six selectable scenes + full scope; timed highlights; seeking/follow on/off; hidden silent practice; scroll preservation; print reset; persistence; mobile; missing-heading diagnosis. Audio uses a deterministic fixture.');
} finally { await browser.close(); }
