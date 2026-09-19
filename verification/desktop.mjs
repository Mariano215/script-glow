// Starts the packed desktop app and checks the window, the first-run screen, PDF import and
// where the data goes. Build first: npm run dist:dir
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const candidates = process.platform === 'win32'
  ? ['release/win-unpacked/Script Glow.exe']
  : ['release/mac-arm64/Script Glow.app/Contents/MacOS/Script Glow', 'release/mac/Script Glow.app/Contents/MacOS/Script Glow'];
const executablePath = candidates.find(file => existsSync(file));
assert.ok(executablePath, 'No packed app found. Run: npm run dist:dir');
// Built-in voices: the worker and every package it imports sit outside app.asar, sharp is the empty
// stub, the LGPL image library is absent, and the license notices sit next to the app.
const resources = process.platform === 'darwin' ? path.join(path.dirname(executablePath), '..', 'Resources') : path.join(path.dirname(executablePath), 'resources');
for (const file of ['app.asar.unpacked/server/kokoro/worker.js', 'app.asar.unpacked/server/kokoro/g2p.js', 'app.asar.unpacked/node_modules/@huggingface/transformers/package.json', 'app.asar.unpacked/node_modules/onnxruntime-node/package.json', 'app.asar.unpacked/node_modules/number-to-words/package.json', 'app.asar.unpacked/node_modules/sharp/index.js', 'THIRD_PARTY_NOTICES.md'])
  assert.ok(existsSync(path.join(resources, file)), `${file} is in the packed app`);
assert.equal(existsSync(path.join(resources, 'app.asar.unpacked', 'node_modules', '@img')), false, 'No sharp image library is packed');
const home = mkdtempSync(path.join(os.tmpdir(), 'script-glow-desktop-'));
const app = await electron.launch({ executablePath, env: { ...process.env, SCRIPT_GLOW_HOME: home } });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  assert.match(await page.title(), /^Script Glow/);
  const base = new URL(page.url()).origin;
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/, 'The window shows the app on a loopback port');
  await page.waitForSelector('dialog.first-run[open]');
  execFileSync(process.execPath, ['verification/pdf-import.mjs'], { env: { ...process.env, APP_URL: base }, stdio: 'inherit' });
  await page.waitForFunction(() => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  assert.ok(existsSync(path.join(home, 'data', 'projects')), 'Projects are kept in the user folder');
  console.log('PASS: the packed app starts, shows the welcome, its PDF worker extracts text, it honors SCRIPT_GLOW_HOME, and the built-in voice runtime and notices are packed.');
} finally {
  await app.close();
  rmSync(home, { recursive: true, force: true });
}
