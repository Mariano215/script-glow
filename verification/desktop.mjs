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
  console.log('PASS: the packed app starts, shows the welcome, imports a PDF and keeps data in the user folder.');
} finally {
  await app.close();
  rmSync(home, { recursive: true, force: true });
}
