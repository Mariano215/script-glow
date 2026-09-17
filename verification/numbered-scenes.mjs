import assert from 'node:assert/strict';
import { launch, openStudio, preferences, press, choose, studio, until } from './lib.mjs';

// A draft whose scene headings carry shooting numbers, and whose page header repeats between
// scenes: the numbers stay in the heading, and the header is never a scene or a character.
const header = 'EVELYN SCREENPLAY THE FEATURE FINAL 8.27.26';
const headings = ['5 INT. THORNE RESEARCH LAB – LATER - CONTINUOUS 5', '35 INT. THORNE RESIDENCE – FAMILY ROOM – NIGHT 35'];
const source = `${header}\n\n${headings[0]}\nDavid carefully removes a small vial filled with luminescent,\n\nclear serum from the incubator. His hand trembles slightly.  ${headings[1]}\n${header}\nElizabeth sits on the couch, surrounded by open books and\n\njournals - genetic engineering, CRISPR, fetal gene therapy.`;

const app = await studio({ projects: [preferences(source, { name: 'Evelyn' })] });
const browser = await launch();
try {
  const page = await openStudio(browser, app.base, { hash: '#rehearsal' });
  assert.equal(await page.locator('[data-action="scene"]').count(), 2);
  assert.equal(await page.locator('#scene-select option').count(), 3, 'Two scenes plus the full script');
  for (let i = 0; i < 2; i++) {
    await choose(page, '#scene-select', `scene-${i + 1}`);
    await until(page, `scene ${i + 1}`, heading => document.querySelector('.script-page > h2')?.textContent === heading, headings[i]);
    assert.ok(!(await page.locator('.script-page').innerText()).includes(header), 'The repeated page header is not script text');
  }
  await press(page, '[data-action="scope-script"]');
  await until(page, 'the full script', () => document.querySelectorAll('.script-scene-heading').length === 2);
  assert.deepEqual(await page.locator('.script-scene-heading').allTextContents(), headings);
  assert.equal(await page.locator('[data-cast]').count(), 0, 'An action-only excerpt creates no characters, and the header is not one');
  assert.deepEqual(page.errors, []);
  console.log('PASS: numbered scene headings 5 and 35 become two selectable scenes plus the full script; the repeated draft header is neither text nor a character.');
} finally { await browser.close(); await app.close(); }
