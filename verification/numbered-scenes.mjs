import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.route('**/api/casting/guess-genders', route => route.fulfill({ json: { guesses: route.request().postDataJSON().names.map(name => ({ name, gender: 'unknown' })) } }));
await page.route('**/api/health', route => route.fulfill({ json: { tts: { ok: true } } }));
await page.route('**/api/voices', route => route.fulfill({ json: { voices: ['MyVoice', 'Stock-Mica'] } }));
const header = 'EVELYN SCREENPLAY THE FEATURE FINAL 8.27.26';
const headings = ['5 INT. THORNE RESEARCH LAB – LATER - CONTINUOUS 5', '35 INT. THORNE RESIDENCE – FAMILY ROOM – NIGHT 35'];
try {
  await page.goto('http://127.0.0.1:3001');
  // Simulate a saved import from before the parser correction; no reimport needed.
  await page.evaluate(({ header, headings }) => {
    const prefs = JSON.parse(localStorage.getItem('script-glow:v1') || '{}');
    prefs.name = 'EVELYN'; prefs.sceneId = 'scene-1';
    prefs.source = `${header}\n\n${headings[0]}\nDavid carefully removes a small vial filled with luminescent,\n\nclear serum from the incubator. His hand trembles slightly.  ${headings[1]}\n${header}\nElizabeth sits on the couch, surrounded by open books and\n\njournals - genetic engineering, CRISPR, fetal gene therapy.`;
    localStorage.setItem('script-glow:v1', JSON.stringify(prefs));
  }, { header, headings });
  await page.reload();
  assert.equal(await page.locator('[data-action="scene"]').count(), 2);
  assert.equal(await page.locator('#scene-select option').count(), 3);
  for (let i = 0; i < 2; i++) {
    await page.locator('#scene-select').selectOption(`scene-${i + 1}`);
    assert.equal(await page.locator('.script-page > h2').innerText(), headings[i]);
    assert.ok(!(await page.locator('.script-page').innerText()).includes(header));
  }
  await page.locator('#scene-select').selectOption('full-script');
  assert.deepEqual(await page.locator('.script-scene-heading').allTextContents(), headings);
  assert.equal(await page.locator('.cast-row').count(), 0, 'Action-only excerpt must not create a header character');
  console.log('PASS: saved Evelyn source reparses into separate scenes 5 and 35; both selectable plus full script; repeated draft header excluded.');
} finally { await browser.close(); }
