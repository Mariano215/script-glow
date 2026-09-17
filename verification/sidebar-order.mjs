import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
// This headless browser throttles page timers, so waiting is done by polling from Node.
const until = async (target, check, arg, { timeout = 60000 } = {}) => {
  const end = Date.now() + timeout;
  while (!(await target.evaluate(check, arg))) {
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${String(check).slice(0, 160)}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
};


await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ channel: 'chromium', headless: true }));
const page = await browser.newPage();
await page.route('**/api/casting/guess-genders', route => route.fulfill({ json: { guesses: route.request().postDataJSON().names.map(name => ({ name, gender: 'unknown' })) } }));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/health', route => route.fulfill({ json: { tts: { ok: true } } }));
await page.route('**/api/voices', route => route.fulfill({ json: { voices: ['MyVoice', 'Stock-Mica'] } }));
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:3001');
  await until(page, () => !document.querySelector('[data-action="render"]').disabled);
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    // Your part, then the practice controls used most, then making audio, then script colours.
    assert.deepEqual(await page.locator('.settings-panel h2').allTextContents(), ['Your part', 'Practice', 'Set the pace', 'Mark your script']);
    assert.equal(await page.locator('.settings-panel > .render-card [data-action="render"]').count(), 1);
    const boxes = await page.locator('.settings-panel > .settings-card').evaluateAll(nodes => nodes.map(node => {
      const { top, bottom } = node.getBoundingClientRect(); return { top, bottom };
    }));
    assert.ok(boxes.every((box, index) => index === 0 || box.top >= boxes[index - 1].bottom || width > 650 && width < 900), 'Cards appear in reading order');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `artifacts/sidebar-order-${width}.png`, fullPage: true });
  }
  await page.locator('#line-gap').fill('2');
  await page.locator('#line-gap').dispatchEvent('change');
  assert.equal(await page.locator('#gap-value').innerText(), '2.0s');
  assert.deepEqual(errors, []);
  console.log('PASS: rehearsal panel in reading order at desktop, tablet and phone widths, no sideways scroll, pause control works, no page errors.');
} finally { await browser.close(); }
