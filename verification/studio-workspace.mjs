import assert from 'node:assert/strict';
import { choose, launch, openStudio, preferences, press, studio, until } from './lib.mjs';

// Real UI and project API, isolated disk library, fake voice service. No production data.
const names = ['DAVID', 'ELIZABETH', 'ROBERT'];
const source = [1, 2].map(scene => `SCENE ${scene}\n\n${Array.from({ length: 18 }, (_, line) => `${names[line % 3]}: Scene ${scene}, line ${line + 1}. A little practice brings the words to life.\n`).join('\n')}`).join('\n');
const app = await studio({
  projects: [preferences(source, { name: 'Studio acceptance', role: 'DAVID', cast: { DAVID: 'ActorVoice', ELIZABETH: 'Stock-Amber', ROBERT: 'Stock-Ash' }, guesses: { DAVID: 'male', ELIZABETH: 'female', ROBERT: 'male' }, manualVoices: { DAVID: true, ELIZABETH: true, ROBERT: true } })],
  voices: ['default', 'ActorVoice', 'Stock-Amber', 'Stock-Mica', 'Stock-Ash', 'Stock-Granite'],
  connections: { casting: { preferredActorVoice: 'ActorVoice', aliases: { default: 'ActorVoice' } } },
});
const [project] = app.projects;
const browser = await launch();
const tts = () => app.calls.filter(call => call.url.endsWith('/v1/tts')).length;
const saved = page => until(page, 'the project to save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
const shown = (page, selector) => page.evaluate(target => { const node = document.querySelector(target); return !!node && !node.closest('[hidden]') && node.getClientRects().length > 0; }, selector);
const go = async (page, screen) => { await page.evaluate(name => { location.hash = `#${name}`; }, screen); await until(page, `the ${screen} screen`, name => document.querySelector(`[data-screen="${name}"]`)?.getAttribute('aria-current') === 'page', screen); };
const fullLink = page => page.evaluate(() => document.querySelector('.downloads a[download$="-full.wav"]')?.getAttribute('href') ?? null);
const audioState = page => page.evaluate(() => { const audio = document.querySelector('#scene-audio'); return { src: audio.currentSrc, time: audio.currentTime, paused: audio.paused }; });
const getProject = async id => (await fetch(`${app.base}/api/projects/${id}`)).json();
try {
  const page = await openStudio(browser, app.base, { hash: '#rehearsal' });
  await until(page, 'the voice list', () => document.querySelector('[data-cast]')?.options.length > 1);
  assert.ok(await shown(page, '.workspace-grid'));
  assert.ok(!(await shown(page, '.cast-screen')));
  assert.equal(await page.locator('.settings-panel .cast-row').count(), 0);
  assert.equal(await page.locator('.script-page .character-highlight').count(), 6);
  assert.deepEqual(await page.locator('.settings-panel h2').allTextContents(), ['Your part', 'Practice', 'Set the pace', 'Mark your script']);
  assert.deepEqual(await page.locator('.studio-menu [data-screen]').evaluateAll(links => links.map(link => link.dataset.screen)), ['rehearsal', 'cast', 'selftape', 'projects', 'settings']);
  assert.equal(await page.locator('.project-library [data-action="import"]').count(), 1);
  assert.equal(await page.locator('.brand-mark').evaluate(img => img.complete && img.naturalWidth > 0), true);

  await go(page, 'cast');
  assert.ok(await shown(page, '.cast-screen'));
  assert.ok(!(await shown(page, '.workspace-grid')));
  assert.equal(await page.locator('.cast-screen .cast-row').count(), 3);
  assert.equal(await page.locator('[data-cast="ELIZABETH"] option[value="ActorVoice"]').isDisabled(), true);
  assert.equal(await page.locator('[data-cast="ELIZABETH"] option[value="default"]').isDisabled(), true);
  await page.evaluate(() => { const button = document.querySelector('[data-action="highlight-character"][data-character="ELIZABETH"]'); button.focus(); button.click(); });
  await saved(page);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-character')), 'ELIZABETH', 'Keyboard focus stays on the edited card');
  assert.equal(await page.locator('#my-role').inputValue(), 'DAVID');

  await go(page, 'rehearsal');
  assert.equal(await page.locator('#highlight-character').inputValue(), 'ELIZABETH');
  assert.match(await page.locator('.character-highlight .character-label').first().innerText(), /ELIZABETH/);
  await choose(page, '#character-color', '#22c55e'); await choose(page, '#spoken-color', '#c084fc'); await saved(page);
  await press(page, '[data-action="render"]');
  await until(page, 'the scene audio', () => !!document.querySelector('.downloads a[download$="-full.wav"]'));
  const originalAudio = await fullLink(page);
  const renderedCalls = tts();
  await press(page, '[data-action="play"]');
  await until(page, 'playback', () => !document.querySelector('#scene-audio').paused);
  await page.evaluate(() => { const audio = document.querySelector('#scene-audio'); audio.currentTime = 10.2; audio.dispatchEvent(new Event('timeupdate')); });
  await until(page, 'an active highlighted line', () => !!document.querySelector('.character-highlight.active'));
  const backgrounds = await page.evaluate(() => ({ active: getComputedStyle(document.querySelector('.character-highlight.active > p')).backgroundColor, other: getComputedStyle(document.querySelector('.character-highlight:not(.active) > p')).backgroundColor }));
  assert.notEqual(backgrounds.active, backgrounds.other, 'Spoken highlight differs from persistent marks');
  await go(page, 'cast');
  const duringCast = await audioState(page); assert.equal(duringCast.paused, false);
  await go(page, 'rehearsal');
  assert.equal((await audioState(page)).src, duringCast.src);
  assert.ok((await audioState(page)).time >= duringCast.time);
  await page.evaluate(() => document.querySelector('#scene-audio').pause());
  await choose(page, '#character-color', '#60a5fa'); await saved(page);
  assert.equal((await audioState(page)).src, duringCast.src);
  assert.equal(tts(), renderedCalls, 'Visual settings never call the voice service');
  // Playback ran on while the screens changed, so return to Elizabeth's line before printing.
  await page.evaluate(() => { const audio = document.querySelector('#scene-audio'); audio.currentTime = 10.2; audio.dispatchEvent(new Event('timeupdate')); });
  await until(page, 'the highlighted line to be active again', () => !!document.querySelector('.character-highlight.active'));
  await page.emulateMedia({ media: 'print' });
  assert.notEqual(await page.locator('.character-highlight.active > p').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'Static marks survive print even on the active line');
  await page.emulateMedia({ media: 'screen' });
  await choose(page, '#highlight-character', '@role'); await saved(page);
  await choose(page, '#hide-lines', true); await saved(page);
  assert.equal(await page.locator('.my-line.character-highlight .hidden-line').count(), 6);
  assert.equal(await page.locator('.my-line > p').count(), 0, 'Highlight does not reveal hidden dialogue');
  await choose(page, '#hide-lines', false); await saved(page);
  await choose(page, '#scene-select', 'scene-2'); await saved(page);
  await choose(page, '#scene-select', 'scene-1'); await saved(page);
  assert.equal(await fullLink(page), originalAudio);
  await page.reload(); await saved(page);
  assert.equal(await page.locator('#character-color').inputValue(), '#60a5fa');
  assert.equal(await page.locator('#spoken-color').inputValue(), '#c084fc');
  await until(page, 'the saved audio after a reload', href => document.querySelector('.downloads a[download$="-full.wav"]')?.getAttribute('href') === href, originalAudio);
  assert.equal(tts(), renderedCalls);

  await page.route('**/api/connections', route => route.fulfill({ status: 503, json: { error: 'Profile unavailable' } }));
  await page.reload(); await saved(page);
  await until(page, 'the profile warning', () => document.querySelector('.notice')?.textContent.includes('profile unavailable'));
  assert.equal(await page.locator('[data-cast="DAVID"]').inputValue(), 'ActorVoice', 'Failed profile fetch never silently recasts');
  assert.equal(await fullLink(page), originalAudio);
  await page.unroute('**/api/connections');
  await page.reload(); await saved(page);
  const doc = await getProject(project.id);
  assert.equal(doc.preferences.spokenColor, '#c084fc');
  assert.equal(doc.renders.length, 1);
  const backup = await (await fetch(`${app.base}/api/projects/${project.id}/backup`)).arrayBuffer();
  const restored = await fetch(`${app.base}/api/projects/restore`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: backup });
  assert.equal(restored.status, 201);
  const restoredDoc = await restored.json();
  assert.equal(restoredDoc.preferences.spokenColor, '#c084fc');
  assert.equal(restoredDoc.renders.length, 1);

  await go(page, 'cast');
  await press(page, '[data-action="choose-role"][data-character="ROBERT"]'); await saved(page);
  assert.equal(await page.locator('#my-role').inputValue(), 'ROBERT');
  await go(page, 'rehearsal');
  assert.match(await page.locator('.character-highlight .character-label').first().innerText(), /ROBERT/);
  await page.goBack();
  await until(page, 'the cast screen from history', () => !document.querySelector('.cast-screen')?.hidden);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(Math.round((await page.locator('.topbar').boundingBox()).y), 0, 'Mobile navigation is at the top');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal document overflow on cast screen');
  await go(page, 'projects');
  await page.evaluate(() => window.scrollTo(0, 0));
  const entry = await page.evaluate(() => { const button = document.querySelector('.project-library [data-action="import"]'); const r = button.getBoundingClientRect(); const player = document.querySelector('.player').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, playerTop: player.height ? player.top : innerHeight, clear: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; });
  assert.ok(entry.top >= 0 && entry.bottom <= entry.playerTop, `New project is above the fold and the player (${JSON.stringify(entry)})`);
  assert.ok(entry.clear, 'New project is not obscured');
  await go(page, 'rehearsal');
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Screenplay scroll stays inside its pane');

  // A new project from a script leaves the earlier one and its audio untouched.
  await go(page, 'projects');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.project-library [data-action="import"]').click();
  await (await chooser).setFiles({ name: 'New project discovery.txt', mimeType: 'text/plain', buffer: Buffer.from('SCENE 1\nDAVID: A new script in its own project.\nELIZABETH: The first one is still saved.') });
  await until(page, 'the new project', () => document.querySelector('#project-name')?.value === 'New project discovery' && document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  const { projects } = await (await fetch(`${app.base}/api/projects`)).json();
  const added = projects.find(item => item.name === 'New project discovery');
  assert.ok(added && added.id !== project.id);
  assert.match((await getProject(added.id)).preferences.source, /A new script in its own project/);
  const preserved = await getProject(project.id);
  assert.equal(preserved.preferences.source, source);
  assert.equal(preserved.renders[0].result.fullUrl, originalAudio, 'New project preserves earlier audio');
  await press(page, `[data-action="open-project"][data-id="${project.id}"]`);
  await until(page, 'the first project', () => document.querySelector('#project-name')?.value === 'Studio acceptance' && document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  assert.equal(tts(), renderedCalls, 'Creating and reopening projects needs no voice service');

  const latest = await getProject(project.id);
  const autoRole = await fetch(`${app.base}/api/projects/${project.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: latest.revision, preferences: { ...latest.preferences, role: 'DAVID', manualVoices: { ...latest.preferences.manualVoices, DAVID: false } } }) });
  assert.equal(autoRole.status, 200);
  await page.route('**/api/connections', async route => {
    const response = await route.fetch(); const profile = await response.json();
    profile.casting.preferredActorVoice = 'Stock-Granite'; profile.casting.aliases = {};
    await route.fulfill({ json: profile });
  });
  await page.reload();
  await until(page, 'the new actor voice', () => document.querySelector('[data-cast="DAVID"]')?.value === 'Stock-Granite'); await saved(page);
  assert.equal(await fullLink(page), null, 'Changed automatic voice never retains mismatched audio');
  assert.equal(tts(), renderedCalls);
  assert.deepEqual(page.errors, []);
  console.log(`PASS: menu screens, cast cards, aliases, independent role and highlight, custom colors, distinct playback, uninterrupted navigation, hidden lines, print, saved scene/refresh/backup audio, role selection, history, mobile, and a new project that leaves the earlier one and its audio intact. ${tts()} fake voice calls.`);
} finally { await browser.close(); await app.close(); }
