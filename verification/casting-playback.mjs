import assert from 'node:assert/strict';
import { choose, fitsWidth, launch, openStudio, preferences, press, studio, until } from './lib.mjs';

// Gender-based casting and overrides, full-script and scene audio, screenplay geometry and phone fit.
const source = 'CAST\nJORDAN - male\nPARTNER - female\nCHRIS - male\n\nACT I\nSCENE ONE\n\nPARTNER\nAre you ready to begin?\n\nJORDAN\n(quietly)\nYes. Let us take it from the top.\n\nSCENE II\n\nPARTNER\nGood. The stage is yours.\n\nCHRIS\nAre you ready to begin?';
const app = await studio({ projects: [preferences(source, { name: 'Casting' })] });
// A project saved before gender matching: no genders, no manual picks, and voices of the wrong type.
const legacyPreferences = preferences(source, { name: 'Legacy', role: 'JORDAN', cast: { JORDAN: 'MyVoice', PARTNER: 'Stock-Granite', CHRIS: 'Stock-Mica' } });
delete legacyPreferences.genders; delete legacyPreferences.manualVoices;
const legacy = await studio({ projects: [legacyPreferences] });
const browser = await launch();
const saved = page => until(page, 'the project to save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
const value = (page, selector) => page.evaluate(target => document.querySelector(target)?.value, selector);
const guessRoute = route => route.fulfill({ json: { guesses: route.request().postDataJSON().names.map(name => ({ name, gender: 'unknown' })) } });
try {
  const page = await openStudio(browser, app.base, { hash: '#cast' });
  await page.route('**/api/casting/guess-genders', guessRoute);
  const requests = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/render')) requests.push(request.postDataJSON()); });
  await until(page, 'the cast', () => document.querySelector('#my-role')?.textContent.includes('Chris') && !!document.querySelector('[data-cast="CHRIS"]')?.value);
  await choose(page, '#my-role', 'JORDAN');
  assert.equal(await value(page, '[data-cast="JORDAN"]'), 'MyVoice');
  assert.match(await value(page, '[data-cast="PARTNER"]'), /Stock-(Mica|Amber)/, 'A female part gets a female voice');
  assert.match(await value(page, '[data-cast="CHRIS"]'), /Stock-(Ash|Granite)/, 'A male part gets a male voice');
  assert.match(await page.locator('[data-gender="PARTNER"] option:checked').innerText(), /female/);
  await choose(page, '[data-cast="PARTNER"]', 'Stock-Mica');

  // Desktop keeps the letter page: Courier 12pt and standard margins, parenthetical under the cue.
  await page.evaluate(() => { location.hash = '#rehearsal'; });
  await press(page, '[data-action="scope-script"]');
  await until(page, 'the full script', () => document.querySelectorAll('.script-scene-heading').length === 2);
  const geometry = await page.locator('.script-page').evaluate(paper => {
    const box = paper.getBoundingClientRect();
    const dialogue = paper.querySelector('.dialogue');
    const parenthetical = paper.querySelector('.parenthetical');
    return { width: box.width, font: getComputedStyle(paper).fontFamily, size: getComputedStyle(paper).fontSize, cue: dialogue.querySelector('.character-label').getBoundingClientRect().left - box.left, dialogue: dialogue.getBoundingClientRect().left - box.left, parenthetical: parenthetical.getBoundingClientRect().left - box.left, parentheticalAfterCue: parenthetical.previousElementSibling?.classList.contains('character-label') };
  });
  assert.equal(geometry.width, 816);
  assert.match(geometry.font, /Courier/);
  assert.equal(geometry.size, '16px');
  assert.ok(Math.abs(geometry.cue - 3.7 * 96) < 1);
  assert.ok(Math.abs(geometry.dialogue - 2.5 * 96) < 1);
  assert.ok(Math.abs(geometry.parenthetical - 3.1 * 96) < 1);
  assert.ok(geometry.parentheticalAfterCue, 'The parenthetical sits inside the speech, under the cue');

  // Play makes audio for the whole script, then for one scene.
  await saved(page);
  await until(page, 'Play to be offered', () => document.querySelector('[data-action="play"]')?.disabled === false);
  assert.match(await page.locator('[data-action="play"]').getAttribute('aria-label'), /Make audio and play full script/);
  await press(page, '[data-action="play"]');
  await until(page, 'full script playback', () => document.querySelector('audio').currentTime > 0.1 && !document.querySelector('audio').paused, undefined, 180000);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].scope, 'script');
  assert.equal(requests[0].scene.lines.filter(line => line.kind === 'dialogue').length, 4);
  await press(page, '[data-action="play"]');
  assert.equal(await page.locator('a[download]').count(), 2);
  await press(page, '[data-action="scene"]');
  await until(page, 'scene 1', () => document.querySelector('#scene-select')?.value === 'scene-1');
  assert.match(await page.locator('[data-action="play"]').getAttribute('aria-label'), /Make audio and play scene/);
  await press(page, '[data-action="play"]');
  await until(page, 'scene playback', () => document.querySelector('audio').currentTime > 0.1 && !document.querySelector('audio').paused, undefined, 180000);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].scope, undefined);
  assert.equal(requests[1].scene.lines.filter(line => line.kind === 'dialogue').length, 2);
  await press(page, '[data-action="play"]');
  await saved(page);
  await page.reload(); await saved(page);
  await until(page, 'restored audio', () => document.querySelectorAll('a[download]').length === 2);
  assert.equal(await value(page, '[data-cast="PARTNER"]'), 'Stock-Mica', 'A manual pick survives a reload');
  await choose(page, '[data-gender="PARTNER"]', 'male');
  assert.match(await value(page, '[data-cast="PARTNER"]'), /Stock-(Ash|Granite)/, 'Changing the voice type recasts the part');
  assert.equal(await page.locator('a[download]').count(), 0, 'A recast invalidates the audio');

  // Phones reflow the page to the screen; nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await fitsWidth(page), 'The app fits a phone');
  assert.ok(await page.locator('.script-panel .script-paper-scroll').evaluate(node => node.scrollWidth <= node.clientWidth), 'The paper does not scroll sideways on a phone');
  assert.ok(await page.locator('.script-page').evaluate(node => node.getBoundingClientRect().width < 390), 'The page reflows to the screen');
  await page.evaluate(() => { location.hash = '#cast'; });
  await until(page, 'the cast screen', () => document.querySelector('.cast-card')?.offsetParent !== null);
  assert.ok(await fitsWidth(page), 'The cast screen fits a phone');
  assert.ok(await page.locator('.cast-card').evaluate(node => node.getBoundingClientRect().width > 300), 'Phone cast controls use the full column');
  assert.deepEqual(page.errors, []);

  // An older project is recast by voice type when it opens.
  const old = await openStudio(browser, legacy.base, { hash: '#cast' });
  await until(old, 'the legacy cast to be corrected', () => ['Stock-Amber', 'Stock-Mica'].includes(document.querySelector('[data-cast="PARTNER"]')?.value));
  assert.match(await value(old, '[data-cast="CHRIS"]'), /Stock-(Ash|Granite)/);
  assert.equal(await value(old, '[data-cast="JORDAN"]'), 'MyVoice');
  assert.deepEqual(old.errors, []);
  console.log('PASS: gender-based casting and overrides; full-script and scene Make audio and play; restored audio; recast invalidates; Courier 12pt with standard margins and parentheticals; phone reflows without sideways scrolling; older projects are recast by voice type.');
} finally { await browser.close(); await app.close(); await legacy.close(); }
