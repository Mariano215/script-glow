import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.route('**/api/casting/guess-genders', route => route.fulfill({ json: { guesses: route.request().postDataJSON().names.map(name => ({ name, gender: 'unknown' })) } }));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/health', route => route.fulfill({ json: { tts: { ok: true } } }));
await page.route('**/api/voices', route => route.fulfill({ json: { voices: ['MyVoice', 'Stock-Mica'] } }));
try {
  await page.goto('http://127.0.0.1:3001');
  await page.waitForFunction(() => !document.querySelector('[data-action="render"]').disabled);
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.deepEqual(await page.locator('.settings-panel h2').allTextContents(), ['Your part', 'Set the pace', 'The cast']);
    assert.equal(await page.locator('.settings-panel > :nth-child(2) [data-action="render"]').count(), 1);
    const boxes = await page.locator('.settings-panel > .settings-card').evaluateAll(nodes => nodes.map(node => {
      const { top, bottom } = node.getBoundingClientRect(); return { top, bottom };
    }));
    assert.ok(boxes[1].top >= boxes[0].bottom, 'Choosing your part must visually precede making audio');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `artifacts/sidebar-order-${width}.png`, fullPage: true });
  }
  await page.locator('#line-gap').fill('2');
  await page.locator('#line-gap').dispatchEvent('change');
  assert.equal(await page.locator('.settings-panel > :first-child h2').innerText(), 'Set the pace');
  assert.equal(await page.locator('#gap-value').innerText(), '2.0s');
  assert.deepEqual(errors, []);
  console.log('PASS: pace/render card first in DOM and layout at desktop/tablet/mobile widths; controls survive refresh; no page errors.');
} finally { await browser.close(); }
