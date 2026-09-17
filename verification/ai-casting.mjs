import assert from 'node:assert/strict';
import { choose, fitsWidth, launch, openStudio, preferences, press, studio, until } from './lib.mjs';

// Name guesses come from a fake Ollama behind the real server. Each request waits until the
// check answers it, so the check decides when a guess arrives and what it says.
const voices = ['default', 'MyVoice', 'Stock-Amber', 'Stock-Mica', 'Stock-Quartz', 'Stock-Ash', 'Stock-Granite', 'Stock-Slate'];
function guessing(projects) {
  const requests = [];
  const services = (url, options) => {
    if (!url.endsWith('/api/generate')) return undefined;
    const names = JSON.parse(options.body).format.properties.guesses.items.properties.name.enum;
    return new Promise((resolve, reject) => requests.push({
      names,
      reply: guesses => resolve(Buffer.from(JSON.stringify({ done: true, response: JSON.stringify({ guesses }) }))),
      fail: () => reject(new Error('Ollama is offline')),
    }));
  };
  const connections = { ollama: { url: 'http://127.0.0.1:11434', model: 'gemma:2b' }, casting: { preferredActorVoice: 'MyVoice', aliases: { default: 'MyVoice' } } };
  return studio({ projects, voices, connections, services }).then(app => Object.assign(app, { requests }));
}
const value = (page, selector) => page.evaluate(target => document.querySelector(target)?.value, selector);
const optionText = (page, selector) => page.evaluate(target => document.querySelector(target)?.selectedOptions[0]?.textContent ?? '', selector);
const optionDisabled = (page, selector) => page.evaluate(target => document.querySelector(target).disabled, selector);
const status = page => page.evaluate(() => document.querySelector('#ai-casting-status')?.textContent ?? '');
const guessingNow = page => until(page, 'the AI to start guessing', () => document.querySelector('#ai-casting-status')?.textContent.includes('is guessing'));
const waitDone = page => until(page, 'the AI to finish', () => !document.querySelector('#ai-casting-status')?.textContent.includes('is guessing'));
const waitRequest = async (app, count) => { const end = Date.now() + 60000; while (app.requests.length < count) { if (Date.now() > end) throw new Error(`Timed out waiting for name-guess request ${count}`); await new Promise(resolve => setTimeout(resolve, 100)); } return app.requests[count - 1]; };
const savedOnServer = async (app, check) => {
  const end = Date.now() + 60000;
  for (;;) {
    const listing = await (await fetch(`${app.base}/api/projects`)).json();
    for (const { id } of listing.projects) if (check(await (await fetch(`${app.base}/api/projects/${id}`)).json())) return;
    if (Date.now() > end) throw new Error('Timed out waiting for the project to save');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
};
const downloads = page => page.locator('.downloads a[download]').count();

const browser = await launch();
const errors = [];
const apps = [];
try {
  // Pending guesses never overwrite choices made while they are on the way.
  const source = 'CAST\nJORDAN (male)\nTAYLOR (female)\nSAM (male)\nSAM (female)\n\nSCENE 1\nJORDAN: Hello.\nDAVID: Ready.\nELIZABETH: Yes.\nALEX: Welcome.\nTAYLOR: Fine.\nSAM: Okay.';
  const first = await guessing([preferences(source, { role: 'JORDAN' })]); apps.push(first);
  const page = await openStudio(browser, first.base, { hash: '#cast' });
  await guessingNow(page);
  const pending = await waitRequest(first, 1);
  assert.deepEqual(pending.names, ['DAVID', 'ELIZABETH', 'ALEX']);
  await choose(page, '[data-cast="ELIZABETH"]', 'Stock-Ash');
  await choose(page, '[data-gender="ALEX"]', 'female');
  pending.reply([{ name: 'DAVID', gender: 'male' }, { name: 'ELIZABETH', gender: 'female' }, { name: 'ALEX', gender: 'unknown' }]);
  await waitDone(page);
  assert.equal(await value(page, '[data-cast="ELIZABETH"]'), 'Stock-Ash', 'Pending AI preserves manual voice');
  assert.equal(await value(page, '[data-gender="ALEX"]'), 'female', 'Pending AI preserves manual gender');
  assert.match(await optionText(page, '[data-gender="DAVID"]'), /AI name guess: male/);
  assert.match(await optionText(page, '[data-gender="TAYLOR"]'), /From script: female/);
  assert.match(await optionText(page, '[data-gender="SAM"]'), /From script: unspecified/);
  assert.match(await status(page), /suggestions, not facts/, 'Guesses are labelled as suggestions');
  assert.equal(await value(page, '[data-cast="JORDAN"]'), 'MyVoice');
  assert.ok(await optionDisabled(page, '[data-cast="DAVID"] option[value="Stock-Ash"]'));
  assert.match(await page.locator('[data-cast="DAVID"] option[value="Stock-Ash"]').innerText(), /Assigned to Elizabeth/);
  assert.ok(await optionDisabled(page, '[data-cast="DAVID"] option[value="default"]'), 'actor alias is reserved');
  assert.ok(!(await optionDisabled(page, '[data-cast="ELIZABETH"] option[value="Stock-Ash"]')));
  const asked = first.requests.length;
  await savedOnServer(first, doc => doc.preferences.guesses.DAVID === 'male');
  await page.reload();
  await until(page, 'the project to open', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await until(page, 'saved guesses after a reload', () => document.querySelector('[data-gender="DAVID"]')?.selectedOptions[0]?.textContent.includes('AI name guess'));
  assert.equal(first.requests.length, asked, 'Saved guesses survive refresh without inference');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await fitsWidth(page));
  errors.push(...page.errors);
  await page.context().close();

  // A voice already shared by two characters stays selectable until one of them moves.
  const sharedApp = await guessing([preferences('SCENE 1\nJORDAN: Hi.\nDAVID: Hello.', { role: 'JORDAN', cast: { JORDAN: 'MyVoice', DAVID: 'default' }, manualVoices: { JORDAN: true, DAVID: true }, guesses: { JORDAN: 'male', DAVID: 'male' } })]); apps.push(sharedApp);
  const shared = await openStudio(browser, sharedApp.base, { hash: '#cast' });
  await until(shared, 'the shared voice', () => document.querySelector('[data-cast="DAVID"]')?.value === 'default');
  const sharedNotes = () => shared.locator('.casting-conflict', { hasText: 'Shared with' }).count();
  assert.equal(await sharedNotes(), 2);
  assert.ok(!(await optionDisabled(shared, '[data-cast="DAVID"] option[value="default"]')), 'Existing duplicated current selection remains enabled');
  await choose(shared, '[data-cast="DAVID"]', 'Stock-Ash');
  await until(shared, 'the shared-voice notes to clear', () => ![...document.querySelectorAll('.casting-conflict')].some(note => note.textContent.includes('Shared with')));
  assert.ok(await optionDisabled(shared, '[data-cast="JORDAN"] option[value="Stock-Ash"]'));
  assert.equal(sharedApp.requests.length, 0, 'Saved guesses need no inference');
  errors.push(...shared.errors);
  await shared.context().close();

  // Malformed saved guesses never reach the library. An old browser draft is the only way they
  // could still arrive, and that draft should open with its names guessed afresh.
  const malformedSource = 'CAST\nJORDAN (male)\nSCENE 1\nJORDAN: Hi.\nDAVID: Saved project.';
  const malformedApp = await guessing([]); apps.push(malformedApp);
  const refused = await fetch(`${malformedApp.base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: preferences(malformedSource, { guesses: { DAVID: { toString: 'male' } } }) }) });
  assert.equal(refused.status, 400, 'The library refuses malformed guesses');
  const legacy = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await legacy.addInitScript(saved => { if (!localStorage.getItem('script-glow:project:v1')) localStorage.setItem('script-glow:v1', JSON.stringify(saved)); }, preferences(malformedSource, { role: 'JORDAN', guesses: { DAVID: { toString: 'male' }, JORDAN: ['male'] } }));
  const malformed = await legacy.newPage();
  malformed.on('pageerror', error => errors.push(error.message));
  await malformed.goto(`${malformedApp.base}/#cast`);
  (await waitRequest(malformedApp, 1)).reply([{ name: 'DAVID', gender: 'male' }]);
  await until(malformed, 'the guess for the old draft', () => document.querySelector('[data-gender="DAVID"]')?.selectedOptions[0]?.textContent.includes('AI name guess'));
  assert.match(await malformed.locator('.script-page').innerText(), /Saved project/);
  await legacy.close();

  // A reply for a project that is no longer open never enters the new one.
  const staleApp = await guessing([preferences('CAST\nJORDAN (male)\nSCENE 1\nJORDAN: Hi.\nDAVID: Hello.', { role: 'JORDAN', name: 'First' })]); apps.push(staleApp);
  const stale = await openStudio(browser, staleApp.base, { hash: '#cast' });
  await guessingNow(stale);
  const old = await waitRequest(staleApp, 1);
  await stale.locator('#file-input').setInputFiles({ name: 'New.txt', mimeType: 'text/plain', buffer: Buffer.from('CAST\nJORDAN (male)\nSCENE 1\nJORDAN: Hi.\nELIZABETH: Welcome.') });
  await until(stale, 'the imported project', () => !!document.querySelector('[data-cast="ELIZABETH"]'));
  assert.equal(staleApp.requests.length, 1, 'The next request waits for the stale batch to settle');
  old.reply([{ name: 'DAVID', gender: 'male' }]);
  const next = await waitRequest(staleApp, 2);
  await guessingNow(stale);
  assert.deepEqual(next.names, ['ELIZABETH']);
  next.fail();
  await waitDone(stale);
  assert.match(await status(stale), /unavailable/);
  assert.ok(!(await optionDisabled(stale, '[data-action="guess-names"]')));
  assert.ok(!(await optionDisabled(stale, '[data-action="render"]')), 'AI failure does not prevent making audio');
  const imported = (await (await fetch(`${staleApp.base}/api/projects`)).json()).projects.find(item => item.id !== staleApp.projects[0].id);
  await until(stale, 'the new project to save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  const stored = await (await fetch(`${staleApp.base}/api/projects/${imported.id}`)).json();
  assert.ok(!stored.preferences.guesses.DAVID, 'Stale result never enters new project');
  errors.push(...stale.errors);
  await stale.context().close();

  // Guesses that arrive after audio was made wait for the actor to apply them.
  const deferredApp = await guessing([preferences('CAST\nJORDAN (male)\nSCENE 1\nJORDAN: Hi.\nELIZABETH: Welcome.', { role: 'JORDAN' })]); apps.push(deferredApp);
  const deferred = await openStudio(browser, deferredApp.base, { hash: '#cast' });
  (await waitRequest(deferredApp, 1)).fail();
  await until(deferred, 'the offline message', () => document.querySelector('#ai-casting-status')?.textContent.includes('unavailable'));
  await press(deferred, '[data-action="render"]');
  await until(deferred, 'the audio', () => !!document.querySelector('.downloads a[download]'));
  const original = await value(deferred, '[data-cast="ELIZABETH"]');
  const desiredGender = ['Stock-Amber', 'Stock-Mica', 'Stock-Quartz'].includes(original) ? 'male' : 'female';
  await press(deferred, '[data-action="guess-names"]');
  await guessingNow(deferred);
  (await waitRequest(deferredApp, 2)).reply([{ name: 'ELIZABETH', gender: desiredGender }]);
  await waitDone(deferred);
  assert.equal(await value(deferred, '[data-cast="ELIZABETH"]'), original);
  assert.ok(await downloads(deferred) > 0, 'AI reply preserves made audio');
  await press(deferred, '[data-action="apply-guesses"]');
  assert.notEqual(await value(deferred, '[data-cast="ELIZABETH"]'), original);
  assert.equal(await downloads(deferred), 0, 'Explicit application invalidates changed audio');
  errors.push(...deferred.errors);
  await deferred.context().close();

  // With no model chosen, the Cast screen sends the actor to Settings instead of retrying.
  const offApp = await studio({ projects: [preferences('SCENE 1\nJORDAN: Hi.\nELIZABETH: Welcome.', { role: 'JORDAN' })], voices }); apps.push(offApp);
  const off = await openStudio(browser, offApp.base, { hash: '#cast' });
  await until(off, 'the name-guessing-off message', () => document.querySelector('#ai-casting-status')?.textContent.includes('Name guessing is off'));
  assert.equal(await off.locator('.ai-casting a[href="#settings"]').count(), 1);
  assert.equal(await off.locator('[data-action="guess-names"]').count(), 0);
  errors.push(...off.errors);

  assert.deepEqual(errors, []);
  console.log('PASS: AI casting: pending guesses keep manual choices, labelled suggestions, reserved voices and aliases, saved guesses without inference, malformed guesses refused by the library and dropped from an old browser draft, stale replies, offline fallback, deferred apply that keeps made audio until applied, settings link when off, mobile.');
} finally {
  await browser.close();
  for (const app of apps) await app.close();
}
