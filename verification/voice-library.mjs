import assert from 'node:assert/strict';
import { voiceCatalog } from '../src/voice-catalog.ts';
import { choose, fitsWidth, launch, openStudio, preferences, press, studio, until } from './lib.mjs';

// The whole catalogue plus one voice it does not describe. Scene audio comes from the fake voice
// service; the preview WAVs are the real files the app ships.
const source = 'SCENE 1\nJORDAN: Hello.\nPARTNER: Welcome.\n\nSCENE 2\nJORDAN: Ready.';
const voices = ['MyVoice', ...Object.keys(voiceCatalog), 'Unknown-Voice'];
const app = await studio({ projects: [preferences(source, { name: 'Voices', role: 'JORDAN' })], voices, lineSeconds: 5 });
const browser = await launch();
const preview = '[data-action="voice-preview"][data-character="PARTNER"]';
const value = (page, selector) => page.evaluate(target => document.querySelector(target)?.value, selector);
const description = page => page.evaluate(() => document.querySelector('[data-cast="PARTNER"]').parentElement.querySelector('.voice-description')?.textContent ?? null);
const fullLink = page => page.evaluate(() => document.querySelector('.downloads a[download]')?.getAttribute('href') ?? null);
const previewing = page => page.evaluate(() => !!document.querySelector('#voice-preview-audio'));
const tts = () => app.calls.filter(call => call.url.endsWith('/v1/tts')).length;
try {
  const page = await openStudio(browser, app.base, { hash: '#cast' });
  await until(page, 'the partner voice', () => !!document.querySelector('[data-cast="PARTNER"]')?.value);
  assert.equal(await value(page, '[data-cast="JORDAN"]'), 'MyVoice');
  const added = Object.keys(voiceCatalog).filter(id => id.startsWith('VoiceZero-') || /Stock-(Slate|Quartz)/.test(id));
  assert.equal(added.length, 12);
  for (const id of Object.keys(voiceCatalog)) {
    const option = await page.evaluate(voice => document.querySelector(`[data-cast="PARTNER"] option[value="${voice}"]`)?.textContent ?? '', id);
    const { label, gender, accent, previewUrl } = voiceCatalog[id];
    assert.ok(option.includes(label) && option.includes(gender) && option.includes(accent), `${id}: listed with label, gender and accent (${option})`);
    assert.ok(previewUrl, `${id}: preview published`);
    const response = await fetch(`${app.base}${previewUrl}`);
    assert.equal(response.status, 200, `${id}: served preview`);
    assert.match(response.headers.get('content-type'), /audio/);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
  }

  await choose(page, '[data-cast="PARTNER"]', 'Stock-Slate');
  await until(page, 'Slate to be cast', () => document.querySelector('[data-cast="PARTNER"]')?.value === 'Stock-Slate');
  assert.match(await description(page), /American|US/i);
  await press(page, '[data-action="render"]');
  await until(page, 'the scene audio', () => !!document.querySelector('.downloads a[download]'));
  const made = tts();
  await press(page, '[data-action="play"]');
  await until(page, 'the scene to play', () => document.querySelector('#scene-audio').currentTime > 0.1);
  const saved = await fullLink(page);
  await press(page, preview);
  await until(page, 'the preview to play', () => document.querySelector('#voice-preview-audio')?.currentTime > 0.1);
  assert.ok(await page.evaluate(() => document.querySelector('#scene-audio').paused), 'Preview pauses the scene');
  assert.equal(await fullLink(page), saved);
  assert.equal(await value(page, '[data-cast="PARTNER"]'), 'Stock-Slate');
  assert.equal(tts(), made, 'Preview must not make scene audio');
  assert.equal(await page.evaluate(selector => document.querySelector(selector).getAttribute('aria-label'), preview), 'Stop voice for PARTNER');
  await press(page, preview);
  assert.equal(await previewing(page), false, 'Stop removes the preview');

  await press(page, preview);
  await press(page, '[data-action="play"]');
  await until(page, 'the scene to resume', () => !document.querySelector('#scene-audio').paused);
  assert.equal(await previewing(page), false, 'Rehearsal stops preview');
  await press(page, '[data-action="play"]');
  await press(page, preview);
  await choose(page, '#scene-select', 'scene-2');
  assert.equal(await previewing(page), false, 'Scene change stops preview');
  await choose(page, '#scene-select', 'scene-1');
  await until(page, 'scene 1 audio again', href => document.querySelector('.downloads a[download]')?.getAttribute('href') === href, saved);

  await choose(page, '[data-cast="PARTNER"]', 'VoiceZero-Alana');
  await until(page, 'Alana to be cast', () => document.querySelector('[data-cast="PARTNER"]')?.value === 'VoiceZero-Alana');
  assert.match(await description(page), /Midwest/i);
  await press(page, preview);
  await until(page, 'the Alana preview', () => document.querySelector('#voice-preview-audio')?.currentTime > 0.1);
  await page.evaluate(() => { const sample = document.querySelector('#voice-preview-audio'); sample.currentTime = sample.duration - 0.05; });
  await until(page, 'the preview to end', () => !document.querySelector('#voice-preview-audio'));
  assert.match(await page.locator('#voice-preview-status').innerText(), /finished/);
  await page.route('**/voice-previews/VoiceZero-Alana.wav', route => route.fulfill({ status: 404 }));
  await press(page, preview);
  await until(page, 'the preview error', () => document.querySelector('#voice-preview-status')?.textContent.includes('unavailable'));
  await page.unroute('**/voice-previews/VoiceZero-Alana.wav');

  await choose(page, '[data-cast="PARTNER"]', 'Unknown-Voice');
  await until(page, 'the unknown voice', () => document.querySelector('[data-cast="PARTNER"]')?.value === 'Unknown-Voice');
  assert.ok(await page.evaluate(selector => document.querySelector(selector).disabled, preview), 'No preview for an undescribed voice');
  assert.equal(await description(page), null);
  await choose(page, '[data-cast="PARTNER"]', 'Stock-Quartz');
  await until(page, 'the project to save', () => document.querySelector('[data-cast="PARTNER"]')?.value === 'Stock-Quartz' && document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await page.reload();
  await until(page, 'the project to open', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await until(page, 'Quartz after a reload', () => document.querySelector('[data-cast="PARTNER"]')?.value === 'Stock-Quartz');
  assert.equal(await value(page, '[data-cast="JORDAN"]'), 'MyVoice');

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await fitsWidth(page));
  assert.deepEqual(await page.locator('.settings-panel h2').allTextContents(), ['Your part', 'Practice', 'Set the pace', 'Mark your script']);

  await page.route('**/api/voices', route => route.fulfill({ status: 503, json: { error: 'Offline' } }));
  await page.reload();
  // The list is empty before the project opens too, so wait for the project and the voice check.
  await until(page, 'the offline project', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally' && !document.querySelector('.local-badge')?.textContent.includes('Checking') && document.querySelector('[data-cast="PARTNER"]')?.textContent.includes('Engine unavailable'));
  await press(page, preview);
  await until(page, 'the offline preview', () => document.querySelector('#voice-preview-audio')?.currentTime > 0.1);
  assert.equal(tts(), made, 'Local preview works even when voice service is offline');
  assert.deepEqual(page.errors, []);
  console.log('PASS: the whole voice catalogue on Cast with labels, genders and accents; 12 added voices with served previews; preview and play stop each other; stop, end and error handling; cast and made audio kept; unknown voice fallback; mobile; actor voice kept; stock previews work offline.');
} finally { await browser.close(); await app.close(); }
