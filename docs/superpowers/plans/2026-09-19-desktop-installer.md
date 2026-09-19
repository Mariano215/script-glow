# Desktop Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Script Glow as a signed Mac and Windows app that an actor installs and opens without git, npm or a terminal.

**Architecture:** An Electron main process (`desktop/main.js`) runs the existing Express server on a free loopback port and shows it in one window. A new `SCRIPT_GLOW_HOME` setting moves projects, cache and the profile to the user's folder. A first-run dialog sends new users to a paid voice service, their own voice server, or the sample script. electron-builder packs, signs and publishes the app from GitHub Actions.

**Tech Stack:** Node 24, Express 5, Vite, TypeScript, Electron, electron-builder, electron-updater, Playwright (browser and Electron checks), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-19-desktop-installer-design.md`

## Global Constraints

- Work on branch `feature/desktop-installer`.
- `npm start` with no `SCRIPT_GLOW_HOME` must keep today's paths: `data/` and `.cache/` next to the code.
- The Electron build must bundle Node 24 or newer (the app's `engines` floor is `>=24`).
- Out of scope: bundling Chatterbox, bundling FFmpeg, a Linux build, a voice-server Dockerfile.
- The server gets no new route. The first-run screen uses `/api/connections`, `/api/connections/test` and `/api/secrets`.
- Only the app's own origin may use the camera and microphone. New windows open in the default browser for `https:` URLs only.
- Releases upload as a **draft**. Mariano publishes by hand.
- All text (code comments, UI copy, commit messages): American English, no em-dashes or en-dashes.
- Run `npm test` and `npm run build` before every commit. Both must pass.

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `server/app.js` | Modify | `HOME` for data paths, `firstRunScreen` option, `firstRun` in `/api/connections`, PDF worker env |
| `server/connections.js` | Modify | `CONNECTIONS_FILE` follows `SCRIPT_GLOW_HOME` |
| `server/index.js` | Modify | Port error exits non-zero, turns on the first-run screen |
| `src/main.ts` | Modify | First-run dialog |
| `src/style.css` | Modify | First-run dialog styles |
| `desktop/main.js` | Create | Electron main process |
| `desktop/builder.cjs` | Create | electron-builder settings |
| `desktop/entitlements.mac.plist` | Create | Mac hardened-runtime entitlements |
| `tests/home.test.js` | Create | `SCRIPT_GLOW_HOME` paths |
| `tests/index.test.js` | Create | Port error |
| `tests/connections.test.js` | Modify | `firstRun` flag |
| `verification/first-run.mjs` | Create | Browser check for the dialog |
| `verification/desktop.mjs` | Create | Packed-app smoke test |
| `verification/pdf-import.mjs` | Modify | Reads `APP_URL` |
| `.github/workflows/test.yml` | Modify | Desktop smoke job |
| `.github/workflows/release.yml` | Create | Signed release on `v*` tags |
| `package.json`, `.gitignore`, `README.md` | Modify | Dependencies, scripts, `release/`, docs |

---

### Task 1: `SCRIPT_GLOW_HOME` moves the data folder

**Files:**
- Modify: `server/app.js:15` and `server/app.js:72`
- Modify: `server/connections.js:45`
- Modify: `server/secrets.js:15`
- Test: `tests/home.test.js` (create)

**Interfaces:**
- Produces: environment variable `SCRIPT_GLOW_HOME`. When set, `CONNECTIONS_FILE` is `<home>/data/connections.json`, and `createApp()` defaults are `<home>/.cache`, `<home>/data/projects` and `<home>/data/voice-previews`. The server reads it once, at import time.

- [ ] **Step 1: Write the failing test**

Create `tests/home.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const preferences = { source: 'SCENE 1\n\nDAVID: Hello.\n', name: 'Home', role: 'DAVID', cast: {}, guesses: {}, genders: {}, manualVoices: {}, sceneId: 'scene-1', gap: 0, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
// The server reads SCRIPT_GLOW_HOME at import time, so each case runs in its own Node process.
const probe = `
  const { CONNECTIONS_FILE } = await import('./server/connections.js');
  const { createApp } = await import('./server/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: ${JSON.stringify(preferences)} }) });
  console.log(JSON.stringify({ file: CONNECTIONS_FILE, status: response.status }));
  process.exit(0);`;
const run = env => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, env }).toString());

test('SCRIPT_GLOW_HOME moves the profile and projects out of the code folder', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'script-glow-home-'));
  try {
    const { file, status } = run({ ...process.env, SCRIPT_GLOW_HOME: home });
    assert.equal(file, path.join(home, 'data', 'connections.json'));
    assert.equal(status, 201);
    assert.equal((await readdir(path.join(home, 'data', 'projects'))).length > 0, true);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('without SCRIPT_GLOW_HOME the profile stays next to the code', () => {
  const { SCRIPT_GLOW_HOME, ...env } = process.env;
  const script = "const { CONNECTIONS_FILE } = await import('./server/connections.js'); console.log(CONNECTIONS_FILE);";
  const file = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env }).toString().trim();
  assert.equal(file, path.join(root, 'data', 'connections.json'));
});
```

The second case does not start a server, so it never writes to the real `data/` folder.

- [ ] **Step 2: Run the test and see it fail**

Run: `node --test tests/home.test.js`
Expected: FAIL in the first case. `file` is `<repo>/data/connections.json`, not the temporary folder.

- [ ] **Step 3: Implement**

In `server/connections.js`, replace line 45:

```js
// The desktop app keeps the profile in the user's folder, because it cannot write next to its code.
export const CONNECTIONS_FILE = process.env.SCRIPT_GLOW_HOME ? path.join(path.resolve(process.env.SCRIPT_GLOW_HOME), 'data', 'connections.json') : fileURLToPath(new URL('../data/connections.json', import.meta.url));
```

In `server/app.js`, after line 15 (`const ROOT = ...`), add:

```js
// Projects, cache and voice samples. The desktop app points this at the user's own folder,
// because an installed app cannot write next to its code. The built page is always read from ROOT.
const HOME = process.env.SCRIPT_GLOW_HOME ? path.resolve(process.env.SCRIPT_GLOW_HOME) : ROOT;
```

In the `createApp` signature on line 72, change the three defaults from `ROOT` to `HOME`:

```js
export function createApp({ cacheDir = path.join(HOME, '.cache'), projectsDir = path.resolve(cacheDir) === path.join(HOME, '.cache') ? path.join(HOME, 'data', 'projects') : path.join(cacheDir, 'projects'), previewDir = path.join(HOME, 'data', 'voice-previews'), connections = DEFAULT_CONNECTIONS, connectionsFile = CONNECTIONS_FILE, secretsFile = SECRETS_FILE, serviceFetch = fetchBounded } = {}) {
```

Leave `express.static(path.join(ROOT, 'dist'))` as it is.

In `server/secrets.js`, replace line 15 so the old key file is looked for in the same folder as the rest of the data. Without this, a run with `SCRIPT_GLOW_HOME` set to a temporary folder moves a developer's old `data/secrets.json` into it, and the test deletes it with the folder:

```js
// Keys were once kept in data/. The move looks there, in the same folder as the rest of the data.
const OLD_SECRETS_FILE = process.env.SCRIPT_GLOW_HOME ? path.join(path.resolve(process.env.SCRIPT_GLOW_HOME), 'data', 'secrets.json') : fileURLToPath(new URL('../data/secrets.json', import.meta.url));
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/home.test.js && npm test`
Expected: PASS, and `ℹ fail 0` for the full suite.

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/connections.js server/secrets.js tests/home.test.js
git commit -m "feat: SCRIPT_GLOW_HOME keeps projects and settings in a chosen folder"
```

---

### Task 2: A taken port stops startup with an error

**Files:**
- Modify: `server/index.js:10`
- Test: `tests/index.test.js` (create)

**Interfaces:**
- Consumes: `SCRIPT_GLOW_HOME` from Task 1 (keeps the test out of the real `data/` folder).
- Produces: `server/index.js` exits with code 1 and prints `Script Glow could not start on port <n>: <reason>` to stderr when `listen` fails.

- [ ] **Step 1: Write the failing test**

Create `tests/index.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('a taken port stops startup with an error and a non-zero exit', async () => {
  const blocker = http.createServer().listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const home = await mkdtemp(path.join(os.tmpdir(), 'script-glow-port-'));
  try {
    const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(blocker.address().port), SCRIPT_GLOW_HOME: home, SCRIPT_GLOW_SECRETS: path.join(home, 'secrets.json') } });
    let stderr = '', stdout = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => { stdout += chunk; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(stderr, /could not start on port/);
    assert.doesNotMatch(stdout, /Script Glow: http/, 'No address is printed for a server that is not running');
  } finally { blocker.close(); await rm(home, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --test tests/index.test.js`
Expected: FAIL with `actual: 0, expected: 1`.

- [ ] **Step 3: Implement**

In `server/index.js`, replace the last line:

```js
// Express 5 passes a listen failure (such as a port in use) to this callback instead of throwing.
createApp({ connections, connectionsFile, firstRunScreen: true }).listen(port, '127.0.0.1', error => {
  if (error) { console.error(`Script Glow could not start on port ${port}: ${error.message}`); process.exit(1); }
  console.log(`Script Glow: http://127.0.0.1:${port} · ${connections.name}`);
});
```

`firstRunScreen` does nothing until Task 3, and `createApp` ignores options it does not know.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/index.test.js && npm test`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/index.js tests/index.test.js
git commit -m "fix: a taken port stops Script Glow with an error instead of a false address"
```

---

### Task 3: First-run screen

**Files:**
- Modify: `server/app.js` (`createApp` options and `GET /api/connections`, lines 72 and 126-129)
- Modify: `src/main.ts` (`connect()` near line 1319, new `showFirstRun()`)
- Modify: `src/style.css` (append)
- Test: `tests/connections.test.js` (append), `verification/first-run.mjs` (create)

**Interfaces:**
- Consumes: `firstRunScreen: true` passed by `server/index.js` (Task 2) and `desktop/main.js` (Task 4).
- Produces: `createApp({ firstRunScreen = false })`. `GET /api/connections` returns `firstRun: boolean`, which is true only when `firstRunScreen` is on and `connectionsFile` does not exist. The dialog is `dialog.first-run` with buttons `[data-choice="hosted"]`, `[data-choice="own"]` and `[data-choice="skip"]`.

The option defaults to false so that the tests and browser checks, which build their own app, do not get a dialog over the page.

- [ ] **Step 1: Write the failing server test**

Append to `tests/connections.test.js` (it already imports `temporary`, `withServer`, `path` and `profile`):

```js
test('the first-run flag is on only for a new install, and a save turns it off', () => temporary(async dir => {
  const connectionsFile = path.join(dir, 'connections.json');
  const options = { connectionsFile, secretsFile: path.join(dir, 'secrets.json'), cacheDir: path.join(dir, 'cache') };
  await withServer(options, async base => {
    assert.equal((await (await fetch(`${base}/api/connections`)).json()).firstRun, false, 'Off unless the app asks for it');
  });
  await withServer({ ...options, firstRunScreen: true }, async base => {
    assert.equal((await (await fetch(`${base}/api/connections`)).json()).firstRun, true);
    const saved = await fetch(`${base}/api/connections`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile()) });
    assert.equal(saved.status, 200);
    assert.equal((await (await fetch(`${base}/api/connections`)).json()).firstRun, false);
  });
}));
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/connections.test.js`
Expected: FAIL. `firstRun` is `undefined`, not `false`.

- [ ] **Step 3: Implement the server flag**

In `server/app.js`, add `firstRunScreen = false` to the `createApp` options, after `serviceFetch = fetchBounded`:

```js
..., serviceFetch = fetchBounded, firstRunScreen = false } = {}) {
```

In `GET /api/connections`, add the flag as the first property of the reply:

```js
  app.get('/api/connections', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // A new install has no profile file yet. Any save writes one, so the welcome shows until then.
    const firstRun = firstRunScreen && !(await stat(connectionsFile).then(() => true, () => false));
    res.json({ firstRun, ...profile, casting: /* unchanged from here */
```

Keep the rest of that `res.json({...})` exactly as it is. `stat` is already imported on line 3.

- [ ] **Step 4: Run it and see it pass**

Run: `node --test tests/connections.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing browser check**

Create `verification/first-run.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { launch, until } from './lib.mjs';

// A new install: no profile file. Nothing here reaches a real service.
const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-first-run-'));
const file = path.join(temp, 'connections.json');
const exists = target => stat(target).then(() => true, () => false);
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'), connectionsFile: file, secretsFile: path.join(temp, 'secrets.json'), connections: DEFAULT_CONNECTIONS, firstRunScreen: true,
  serviceFetch: async url => { throw new Error(`nothing is listening on ${url}`); } });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
try {
  const page = await browser.newPage();
  const welcome = () => page.evaluate(() => !!document.querySelector('dialog.first-run[open]'));

  await page.goto(`${base}/#rehearsal`);
  await until(page, 'the welcome', () => !!document.querySelector('dialog.first-run[open]'));
  assert.equal(await page.locator('dialog.first-run [data-choice]').count(), 3);

  // A paid service: Settings opens with OpenAI chosen, and nothing is saved until the actor saves.
  await page.click('[data-choice="hosted"]');
  await until(page, 'the Settings screen', () => location.hash === '#settings' && !!document.querySelector('#service-engine-openai:checked'));
  assert.equal(await exists(file), false, 'Choosing a paid service does not save by itself');

  // Next launch still shows the welcome, because nothing was saved. Skip saves the defaults.
  await page.goto(`${base}/#rehearsal`); await page.reload();
  await until(page, 'the welcome again', () => !!document.querySelector('dialog.first-run[open]'));
  await page.click('[data-choice="skip"]');
  for (let i = 0; i < 100 && !await exists(file); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await exists(file), true, 'Skip writes the profile');
  await page.reload();
  await page.waitForSelector('.topbar');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await welcome(), false, 'The welcome shows once');

  // Own voice server: Settings opens on Chatterbox.
  await rm(file);
  await page.reload();
  await until(page, 'the welcome after the profile is removed', () => !!document.querySelector('dialog.first-run[open]'));
  await page.click('[data-choice="own"]');
  await until(page, 'Settings on Chatterbox', () => location.hash === '#settings' && !!document.querySelector('#service-engine-chatterbox:checked'));
  console.log('PASS: the welcome shows for a new install, leads to Settings, and Skip saves the defaults once.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
```

- [ ] **Step 6: Build and see the check fail**

Run: `npm run build && node verification/first-run.mjs`
Expected: FAIL with `Timed out waiting for the welcome`.

- [ ] **Step 7: Implement the dialog**

In `src/main.ts`, add this function directly after `saveServices()` (near line 700):

```ts
// A new install has no settings file. Skip saves the defaults. The other two choices open Settings,
// where Save writes the file, so the welcome comes back at the next launch until voices are set up.
let firstRunShown = false;
function showFirstRun() {
  if (firstRunShown) return;
  firstRunShown = true;
  const dialog = document.createElement('dialog');
  dialog.className = 'first-run';
  dialog.setAttribute('aria-labelledby', 'first-run-title');
  dialog.innerHTML = `<h2 id="first-run-title">Welcome to Script Glow</h2>
    <p>Choose who reads the other parts. You can change this at any time in Settings.</p>
    <div class="first-run-choices">
      <button type="button" data-choice="hosted"><strong>Use a paid voice service</strong><span>OpenAI, Google Gemini or ElevenLabs. Works on any laptop. You need an API key from the service.</span></button>
      <button type="button" data-choice="own"><strong>I have my own voice server</strong><span>Chatterbox on this computer or another one. Free and private.</span></button>
      <button type="button" data-choice="skip"><strong>Skip for now</strong><span>Look around with the sample script. The cast cannot read until you choose a voice service.</span></button>
    </div>`;
  dialog.addEventListener('click', async event => {
    const choice = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-choice]')?.dataset.choice;
    if (!choice) return;
    dialog.close();
    await loadSettings(true);
    if (choice === 'skip') { await saveServices(); return; }
    if (settingsDraft) settingsDraft.voice.engine = choice === 'hosted' ? 'openai' : 'chatterbox';
    if (location.hash === '#settings') render(); else location.hash = '#settings';
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
```

In `connect()`, widen the `/api/connections` type and call the dialog. Change:

```ts
api<{ casting: typeof castingConfig; voice?: { engine: string } }>('/api/connections')
```

to:

```ts
api<{ casting: typeof castingConfig; voice?: { engine: string }; firstRun?: boolean }>('/api/connections')
```

and, as the last line of `connect()` (after `persist(); render(); void guessNames();`), add:

```ts
  if (responses[2].status === 'fulfilled' && responses[2].value.firstRun) showFirstRun();
```

Append to `src/style.css`:

```css
.first-run{width:min(560px,calc(100vw - 30px))}.first-run h2{margin:0 0 8px;font-size:24px;font-weight:500}.first-run>p{margin:0 0 20px;color:#5b645d}.first-run-choices{display:grid;gap:10px}.first-run-choices button{display:grid;gap:4px;text-align:left;padding:14px 16px;border:1px solid var(--border);border-radius:9px;background:#fff}.first-run-choices button:hover{border-color:#cf923f;background:#fffaf0}.first-run-choices strong{font-weight:600}.first-run-choices span{font-size:13px;color:#5b645d}
```

- [ ] **Step 8: Run the checks and see them pass**

Run: `npm run build && node verification/first-run.mjs && node verification/settings.mjs && node verification/studio-workspace.mjs && npm test`
Expected: `PASS: the welcome shows ...`, the two older checks still pass, and `ℹ fail 0`.

- [ ] **Step 9: Commit**

```bash
git add server/app.js src/main.ts src/style.css tests/connections.test.js verification/first-run.mjs
git commit -m "feat: a new install opens with a welcome that sets up the voices"
```

---

### Task 4: Electron app

**Files:**
- Create: `desktop/main.js`, `desktop/builder.cjs`, `desktop/entitlements.mac.plist`, `verification/desktop.mjs`
- Modify: `server/app.js` (PDF `fork`, near line 292), `verification/pdf-import.mjs` (URL line), `package.json`, `.gitignore`

**Interfaces:**
- Consumes: `SCRIPT_GLOW_HOME` (Task 1), `firstRunScreen` (Task 3), `dialog.first-run` (Task 3).
- Produces: `npm run desktop` (dev window), `npm run dist` (packed app in `release/`), `desktop/builder.cjs` (used by Task 5), `verification/desktop.mjs` (used by Task 5).

- [ ] **Step 1: Install and check the bundled Node version**

```bash
npm install --save-dev electron electron-builder
npm install electron-updater
npm install-scripts approve electron
npm rebuild electron
ELECTRON_RUN_AS_NODE=1 npx electron -p process.versions.node
```

Expected: a version of `24.0.0` or newer. If it is older, install the newest Electron major whose Node is 24 or newer (`npm view electron versions`, then check each major's release notes on electronjs.org), and pin it. The npm 12 install-scripts block would otherwise skip the Electron download. Commit any `allowScripts` change npm makes to `package.json`.

- [ ] **Step 2: Point the PDF check at any address**

In `verification/pdf-import.mjs`, change the `fetch` URL:

```js
const response = await fetch(`${process.env.APP_URL || 'http://127.0.0.1:3001'}/api/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'screenplay.pdf', data: Buffer.from(pdf).toString('base64') }) });
```

- [ ] **Step 3: Write the failing smoke test**

Create `verification/desktop.mjs`:

```js
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
```

- [ ] **Step 4: Add scripts, ignore the output folder, and see the smoke test fail**

In `package.json`, add `"main": "desktop/main.js"` after `"type": "module"`, and add these scripts:

```json
"desktop": "npm run build && electron .",
"dist": "npm run build && electron-builder --config desktop/builder.cjs --publish never",
"dist:dir": "npm run build && electron-builder --config desktop/builder.cjs --dir --publish never"
```

Append `release/` to `.gitignore`.

Run: `node verification/desktop.mjs`
Expected: FAIL with `No packed app found. Run: npm run dist:dir`.

- [ ] **Step 5: Write the main process**

Create `desktop/main.js`:

```js
// Desktop shell: runs the same server inside Electron and shows it in one window.
import { app, BrowserWindow, session, shell } from 'electron';
import updater from 'electron-updater';

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // The server reads this at import time, so it is set before the server is imported.
  process.env.SCRIPT_GLOW_HOME ??= app.getPath('userData');
  let window;
  // A second launch shows the open window, so two copies never write the same projects.
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  await app.whenReady();
  const { createApp } = await import('../server/app.js');
  const { CONNECTIONS_FILE, loadConnections } = await import('../server/connections.js');
  const connections = await loadConnections(CONNECTIONS_FILE);
  // Port 0: the system picks a free port, so another program on 3001 is never a problem.
  const server = createApp({ connections, connectionsFile: CONNECTIONS_FILE, firstRunScreen: true }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Camera and microphone for self-tape and Record my voice, for this app's page only.
  session.defaultSession.setPermissionRequestHandler((contents, permission, done, details) => done(permission === 'media' && new URL(details.requestingUrl).origin === origin));
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => permission === 'media' && requestingOrigin === origin);
  window = new BrowserWindow({ width: 1440, height: 960, title: 'Script Glow', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  // Voice credits and help links open in the default browser. Nothing else opens a window.
  window.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  await window.loadURL(origin);
  // Updates come from the GitHub Release. A failed check must never stop the app.
  if (app.isPackaged) updater.autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}
```

- [ ] **Step 6: Let the PDF worker run inside Electron**

In `server/app.js`, replace the `fork(...)` call in `/api/import`:

```js
      // Inside the desktop app process.execPath is Electron, which runs as plain Node only with
      // ELECTRON_RUN_AS_NODE. The worker is unpacked from the app archive, so it is read from there.
      const workerFile = fileURLToPath(new URL('./pdf-worker.js', import.meta.url)).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      const worker = fork(workerFile, [], {
        execArgv: ['--max-old-space-size=256'], serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
```

Outside Electron the `replace` finds nothing and the variable is ignored, so `npm start` behaves as before.

- [ ] **Step 7: Write the build settings**

Create `desktop/builder.cjs`:

```js
// electron-builder settings. Windows signing turns on only when its settings are present, so the
// same file makes unsigned test builds. Mac signing and notarization follow the CSC_* and APPLE_*
// environment variables, which electron-builder reads by itself.
const azure = process.env.AZURE_SIGNING_ACCOUNT;
module.exports = {
  appId: 'io.github.mariano215.scriptglow',
  productName: 'Script Glow',
  directories: { output: 'release' },
  files: ['desktop/**', 'server/**', 'dist/**', 'package.json'],
  asarUnpack: ['server/pdf-worker.js', 'node_modules/pdfjs-dist/**'],
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }, { target: 'zip', arch: ['arm64', 'x64'] }],
    icon: 'public/brand/script-glow-mark-v2.png',
    category: 'public.app-category.entertainment',
    hardenedRuntime: true,
    entitlements: 'desktop/entitlements.mac.plist',
    entitlementsInherit: 'desktop/entitlements.mac.plist',
    extendInfo: {
      NSCameraUsageDescription: 'Script Glow uses the camera to record your self-tapes.',
      NSMicrophoneUsageDescription: 'Script Glow uses the microphone to record your self-tapes and your own voice.',
    },
  },
  win: {
    target: 'nsis',
    icon: 'public/brand/script-glow-mark-v2.png',
    ...(azure ? { azureSignOptions: { endpoint: process.env.AZURE_SIGNING_ENDPOINT, codeSigningAccountName: azure, certificateProfileName: process.env.AZURE_CERT_PROFILE, publisherName: process.env.AZURE_PUBLISHER_NAME } } : {}),
  },
  nsis: { oneClick: true, perMachine: false },
  publish: { provider: 'github', owner: 'Mariano215', repo: 'script-glow', releaseType: 'draft' },
};
```

Create `desktop/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.device.camera</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
</dict>
</plist>
```

- [ ] **Step 8: Pack and run the smoke test**

Run: `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:dir && node verification/desktop.mjs`
Expected: `PASS: real screenplay PDF ...` then `PASS: the packed app starts, shows the welcome, imports a PDF and keeps data in the user folder.`

Then run `npm run desktop` once by hand. Open **Self-tape** and confirm that the camera prompt appears and the preview shows. Record the result in the task report. No automated check covers the camera prompt.

- [ ] **Step 9: Run the full suite and commit**

Run: `npm test`
Expected: `ℹ fail 0`. PDF import was already checked against the packed app in Step 8.

```bash
git add desktop server/app.js verification/desktop.mjs verification/pdf-import.mjs package.json package-lock.json .gitignore
git commit -m "feat: Script Glow runs as a desktop app for Mac and Windows"
```

---

### Task 5: CI smoke job and signed release workflow

**Files:**
- Modify: `.github/workflows/test.yml`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `npm run dist:dir`, `desktop/builder.cjs` and `verification/desktop.mjs` (Task 4).
- Produces: a `desktop` CI job on every push, and a draft GitHub Release with signed files on each `v*` tag.

- [ ] **Step 1: Add the desktop job to `test.yml`**

Append under `jobs:` in `.github/workflows/test.yml`, using the same pinned action SHAs as the `app` job:

```yaml
  desktop:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    env:
      # Unsigned test build: signing belongs to the release workflow.
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run dist:dir
      - run: node verification/desktop.mjs
```

- [ ] **Step 2: Create `release.yml`**

```yaml
name: release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  desktop:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 120
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      # Mac: Developer ID certificate and notarization.
      CSC_LINK: ${{ secrets.CSC_LINK }}
      CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
      APPLE_ID: ${{ secrets.APPLE_ID }}
      APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
      APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      # Windows: Azure Trusted Signing.
      AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
      AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
      AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
      AZURE_SIGNING_ENDPOINT: ${{ vars.AZURE_SIGNING_ENDPOINT }}
      AZURE_SIGNING_ACCOUNT: ${{ vars.AZURE_SIGNING_ACCOUNT }}
      AZURE_CERT_PROFILE: ${{ vars.AZURE_CERT_PROFILE }}
      AZURE_PUBLISHER_NAME: ${{ vars.AZURE_PUBLISHER_NAME }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      # Uploads to a draft release. Mariano checks the files and publishes it by hand.
      - run: npx electron-builder --config desktop/builder.cjs --publish always
```

- [ ] **Step 3: Check the workflow files**

Run: `npx --yes action-validator .github/workflows/test.yml .github/workflows/release.yml`
Expected: no output and exit code 0. If `action-validator` cannot be installed, run `node -e "for (const f of ['test','release']) require('js-yaml').load(require('fs').readFileSync('.github/workflows/'+f+'.yml','utf8'))"` after `npm i --no-save js-yaml`, and expect no error.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/test.yml .github/workflows/release.yml
git commit -m "ci: desktop smoke test on Mac and Windows, and a signed draft release on tags"
```

The first real release run needs the GitHub secrets and variables listed in the spec. The CI smoke job needs none.

---

### Task 6: Documentation

**Files:**
- Modify: `README.md` (Install section, environment variable table)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Update the README**

At the top of the `## Install` section, add:

~~~markdown
### Download (Mac and Windows)

Download Script Glow for your computer from the [latest release](https://github.com/Mariano215/script-glow/releases/latest): the `.dmg` for a Mac, or the `.exe` for Windows. Open it and follow the welcome screen. You do not need Node or a terminal.

The app keeps your projects and settings in your user folder: `~/Library/Application Support/Script Glow` on a Mac, `%APPDATA%\Script Glow` on Windows.

### From source
~~~

Keep the existing `git clone` block under **From source**.

Add this row to the environment variable table:

```markdown
| `SCRIPT_GLOW_HOME` | Folder for `data/` and `.cache/` (default: the code folder). The desktop app sets it to your user folder. |
```

Add under `## Run`:

~~~markdown
Desktop window (development):

```sh
npm run desktop
```
~~~

- [ ] **Step 2: Check the text and commit**

Run: `grep -nP "[\x{2013}\x{2014}]" README.md docs/superpowers/plans/2026-09-19-desktop-installer.md`. Lines that were already in `README.md` before this task may match; new lines must not.

```bash
git add README.md
git commit -m "docs: download and desktop instructions"
```

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| 1. `SCRIPT_GLOW_HOME` | 1 |
| 2. Port error fix | 2 |
| 3. Main process (port 0, window, single instance, links, permissions, updates) | 4 |
| 4. PDF import inside Electron | 4 |
| 5. First-run screen | 3 |
| 6. Build (dmg and zip, NSIS per-user, entitlements, files) | 4 |
| 7. Signing and release (draft) | 5 |
| Tests (paths, flag, port, first-run check, Electron smoke in CI) | 1, 2, 3, 4, 5 |

Two deviations from the spec, both smaller:
- The spec says `loadConnections` reports a missing file. The plan checks the file in `GET /api/connections` instead. The result is the same, and `loadConnections` does not change.
- The paid-service and own-server choices open the existing Settings screen with the engine chosen, instead of repeating the key and address fields in the dialog. This reuses the Settings code, as the spec asks.
