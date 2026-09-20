// Listening mode, in a real browser with a fake microphone. Speech into the microphone ends
// the wait on the actor's line with no key press. Silence leaves the wait open, and Space
// still works, which is the promise the feature makes.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeWav, SAMPLE_RATE } from '../server/audio.js';
import { choose, launch, MEDIA_ARGS, openStudio, preferences, studio, until } from './lib.mjs';

// Chrome loops this file into getUserMedia. Loud enough to clear the floor the app measures
// from the room, then a silence longer than the hold, so one loop is a finished line.
function microphoneFile(speechSeconds) {
  const total = Math.round(SAMPLE_RATE * (speechSeconds + 2.5));
  const pcm = Buffer.alloc(total * 2);
  for (let i = 0; i < Math.round(SAMPLE_RATE * speechSeconds); i++) pcm.writeInt16LE(Math.round(Math.sin(i / 12) * 16000), i * 2);
  return encodeWav(pcm);
}

const source = 'SCENE 1\n\nELIZABETH: You waited up again.\n\nDAVID: I wanted to wait.\n\nELIZABETH: Then say the rest of it.\n\nDAVID: I am not finished yet.\n';
const project = preferences(source, {
  name: 'Listening', role: 'DAVID', mode: 'practice', wait: true, autoContinue: true, holdMs: 500,
  cast: { DAVID: 'MyVoice', ELIZABETH: 'Stock-Amber' }, manualVoices: { DAVID: true, ELIZABETH: true },
});

const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-mic-'));
const speechFile = path.join(temp, 'speech.wav');
const silentFile = path.join(temp, 'silence.wav');
await writeFile(speechFile, microphoneFile(1.5));
await writeFile(silentFile, microphoneFile(0));

// The same scene twice, once with a microphone that speaks and once with one that does not.
async function rehearse(microphone, extra = {}, services) {
  const app = await studio({ projects: [{ ...project, ...extra }], services });
  const browser = await launch([...MEDIA_ARGS, `--use-file-for-fake-audio-capture=${microphone}`, '--autoplay-policy=no-user-gesture-required']);
  try {
    const page = await openStudio(browser, app.base);
    const wait = (what, check, timeout) => until(page, what, check, undefined, timeout);
    await wait('Make audio to be offered', () => {
      const button = document.querySelector('[data-action="render"]');
      if (!button || button.disabled) return false;
      if (!window.__pressedRender) { window.__pressedRender = true; button.click(); }
      return true;
    }, 30000);
    await wait('the render to publish audio', () => !!document.querySelector('a[download][href$="-full.wav"]'));
    await page.evaluate(() => { location.hash = '#rehearsal'; });
    await wait('the rehearsal screen', () => { const panel = document.querySelector('.settings-panel'); return !!panel && panel.offsetParent !== null; }, 20000);
    await page.evaluate(() => document.querySelector('[data-action="mode-practice"]').click());

    assert.ok(await page.evaluate(() => !!document.querySelector('#auto-continue')?.checked), 'Listening is on for this project');
    assert.equal(await page.evaluate(() => document.querySelector('#hold-ms')?.value), '500', 'The pause the actor is allowed is shown and set');

    await page.evaluate(() => document.querySelector('[data-action="play"]').click());
    await wait('playback to start', () => !document.querySelector('#scene-audio').paused);
    const duration = await page.evaluate(() => document.querySelector('#scene-audio').duration || 0);
    assert.ok(duration > 0, 'The mocked render produced playable audio');
    // Step through the scene until the player stops on the actor's own line.
    let stopped = false;
    for (let at = 0.05; at < duration && !stopped; at += 0.2) {
      stopped = await page.evaluate(time => {
        const node = document.querySelector('#scene-audio');
        node.currentTime = time; node.dispatchEvent(new Event('timeupdate'));
        return node.paused && !!document.querySelector('.play-button.is-waiting');
      }, at);
    }
    assert.ok(stopped, 'The player waits on the actor\'s line');
    const errors = page.errors;
    return { page, browser, app, wait, errors };
  } catch (error) {
    await browser.close(); await app.close();
    throw error;
  }
}

let open = null;
try {
  // A microphone that hears a line: the scene goes on by itself.
  open = await rehearse(speechFile);
  await open.wait('listening to end the wait with no key press', () => !document.querySelector('.play-button.is-waiting'), 30000);
  assert.deepEqual(open.errors, [], 'No page errors while listening');
  await open.browser.close(); await open.app.close(); open = null;

  // A microphone that hears nothing: the wait stays open, and Space still ends it.
  open = await rehearse(silentFile);
  await new Promise(resolve => setTimeout(resolve, 4000));
  assert.ok(await open.page.evaluate(() => !!document.querySelector('.play-button.is-waiting')), 'Silence never counts as a finished line');
  await open.page.keyboard.press(' ');
  await open.wait('Space to end the wait', () => !document.querySelector('.play-button.is-waiting'), 10000);

  // Switching listening off leaves the manual wait exactly as it was.
  await choose(open.page, '#auto-continue', false);
  assert.ok(await open.page.evaluate(() => document.querySelector('#hold-ms') === null), 'The pause slider belongs to listening and goes with it');
  assert.deepEqual(open.errors, [], 'No page errors with listening off');
  await open.browser.close(); await open.app.close(); open = null;

  // Check what I said: the line is marked after the cue has already gone.
  let asked = null;
  open = await rehearse(speechFile, { checkLines: true }, async (url, options) => {
    if (!url.endsWith('/v1/audio/transcriptions')) return null;
    asked = options?.body instanceof FormData ? options.body.get('file')?.size ?? 0 : 0;
    return Buffer.from(JSON.stringify({ text: 'SPEAKER_00: I wanted to wait.' }));
  });
  await open.wait('listening to end the wait', () => !document.querySelector('.play-button.is-waiting'), 30000);
  await open.wait('the line to be marked as said', () => !!document.querySelector('.dialogue.checked-said .line-check.is-said'), 30000);
  assert.ok(asked > 44, 'A real WAV clip reached the transcription server');
  assert.deepEqual(open.errors, [], 'No page errors while checking');
  console.log('Listening mode: speech ends the wait, silence does not, Space always does, and the line is marked.');
} finally {
  if (open) { await open.browser.close(); await open.app.close(); }
  await rm(temp, { recursive: true, force: true });
}
