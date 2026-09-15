import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { job, base } = JSON.parse(await readFile(new URL('../artifacts/live-render.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.goto(`${base}/api/health`);
  const result = await page.evaluate(async ({ url }) => {
    const audio = new Audio(url);
    const ready = new Promise((resolve, reject) => {
      audio.addEventListener('loadedmetadata', resolve, { once: true });
      audio.addEventListener('error', () => reject(new Error('Browser could not decode scene WAV')), { once: true });
      setTimeout(() => reject(new Error('Metadata timeout')), 10000);
    });
    await ready;
    audio.playbackRate = 0.75;
    audio.currentTime = 2.5;
    await audio.play();
    const result = { duration: audio.duration, playing: !audio.paused, time: audio.currentTime, rate: audio.playbackRate };
    audio.pause();
    return result;
  }, { url: `${base}${job.result.practiceUrl}` });
  assert.ok(Math.abs(result.duration - job.result.duration) < 0.01);
  assert.ok(result.playing);
  assert.ok(result.time >= 2.5);
  assert.equal(result.rate, 0.75);
  console.log('PASS: Chrome decodes, seeks, changes speed and plays real exported scene audio.');
} finally { await browser.close(); }
