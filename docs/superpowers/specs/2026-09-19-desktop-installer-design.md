# Desktop installer design

Date: 2026-09-19. Status: approved in chat, waiting for spec review.

## Goal

An actor downloads one signed file for Mac or Windows, opens it, and rehearses. They do not need git, npm, Node or a terminal. On first launch they choose a paid voice service or their own voice server.

Out of scope: bundling the Chatterbox voice server (it needs Python, PyTorch and several GB, and is fast only with an NVIDIA GPU), bundling FFmpeg (Chromium makes the MP4), a Linux build, and a Dockerfile for the voice server (a separate task).

## Packaging

Electron with electron-builder. Electron brings Chromium, so every feature that needs Chrome or Edge works on every machine, and it brings its own Node.

## Parts

### 1. Data folder: `SCRIPT_GLOW_HOME`

Today `data/` and `.cache/` sit next to the code (`server/app.js:15`, `server/connections.js:45`). An installed app is read-only, so a new environment variable moves them.

- When `SCRIPT_GLOW_HOME` is set, `data/` and `.cache/` live inside it. When it is not set, the paths stay as they are now, so `npm start` users see no change.
- The desktop app sets it to Electron's `app.getPath('userData')`: `~/Library/Application Support/Script Glow` on Mac, `%APPDATA%\Script Glow` on Windows.
- The key file stays where it is now (`secrets.js`, already per user).

### 2. Port error fix

`server/index.js:10` ignores the error that Express 5 passes to the `listen` callback. When the port is taken, the app prints its address and exits with code 0. The fix prints the error and exits with a non-zero code.

### 3. Main process: `desktop/main.js`

- Sets `SCRIPT_GLOW_HOME`, then imports `createApp` and listens on `127.0.0.1` port 0 (a free port chosen by the system, so no port conflict).
- Opens one `BrowserWindow` at that address with `contextIsolation: true`, `nodeIntegration: false` and no preload script.
- Takes the single-instance lock. A second launch focuses the open window, so two copies never write the same projects.
- Links that open a new window (voice credits, help links) go to the default browser through `shell.openExternal`, for `https:` URLs only.
- Allows the camera and microphone permission only for the app's own origin (self-tape and Record my voice). Everything else is denied.
- Checks for updates with `electron-updater` against GitHub Releases.

### 4. PDF import inside Electron

`server/app.js` starts `pdf-worker.js` with `child_process.fork` under plain Node. In the desktop app's main process it uses Electron's `utilityProcess.fork` instead, because the packed app turns off the `RunAsNode` fuse (along with `NODE_OPTIONS` and `--inspect`), so its binary cannot be run as Node by any local program. The worker answers over `process.parentPort` there and over `process.send` under Node. The worker files are listed in `asarUnpack` so they are real files on disk. The heap cap is `--max-old-space-size=256` under Node and `--js-flags=--max-old-space-size=256` for the utility process.

### 5. First-run screen

- `loadConnections` reports whether the profile file existed. `/api/connections` returns `firstRun: true` when it did not.
- The UI then shows a welcome dialog with three choices:
  1. **Use a paid voice service**: pick OpenAI, Gemini or ElevenLabs, paste the key, **Test**, **Save**.
  2. **I have my own voice server**: address (loopback default filled in) and an optional token, **Test**, **Save**.
  3. **Skip for now**: saves the default profile and opens the sample project.
- Every choice writes the profile file, so the dialog shows once. This also applies to `npm start` users who have no profile yet.
- It reuses the existing `/api/connections`, `/api/connections/test` and `/api/secrets` routes and the Settings code that calls them. The server gets no new route.

### 6. Build

`electron-builder` settings in `package.json`:

- Mac: `dmg` and `zip` (the zip is what `electron-updater` downloads), for `arm64` and `x64`. Hardened runtime, with the camera and microphone entitlements and `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` in `Info.plist`.
- Windows: NSIS installer, per-user install (no admin prompt).
- `files` includes `server/`, `dist/`, `public/`, `desktop/` and production dependencies. Tests, verification scripts and `voice-server/` are left out.

### 7. Signing and release

A new workflow, `.github/workflows/release.yml`, runs on a `v*` tag:

- Runs `npm ci`, `npm run build` and `npm test`, then `electron-builder` on `macos-latest` and `windows-latest`.
- Mac: signs with the Developer ID certificate and notarizes with `notarytool`.
- Windows: signs with Azure Trusted Signing.
- Uploads the files to a draft GitHub Release. Mariano publishes it by hand.

GitHub secrets needed: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, plus the Trusted Signing account and profile names.

The release stops with a clear message, before anything is built or uploaded, when:

- the pushed tag is not `v` plus the `package.json` version (electron-builder uploads to the `package.json` version, not to the tag);
- a signing secret is missing, so the workflow never makes an unsigned release;
- the tag's release is already published (a draft is updated).

Unsigned test builds come from the `desktop` job in `.github/workflows/test.yml`, which packs the app and runs the Electron smoke test on every push and pull request.

## Tests

- Unit test: `SCRIPT_GLOW_HOME` set and not set gives the right projects, cache and profile paths.
- Unit test: `loadConnections` reports a missing profile, and `/api/connections` returns `firstRun`.
- Unit test: the port error exits non-zero.
- Browser check `verification/first-run.mjs` with fake services: each of the three choices writes the profile, and the dialog does not show again.
- Electron smoke test in CI on Mac and Windows with Playwright's Electron support: the packed app starts, the window loads, and a PDF import succeeds.

## Risks

- Notarization can take from minutes to hours. The release workflow waits for it and has a long timeout.
- Azure Trusted Signing needs an identity check for the account. This can take days, so start it early.
- The download is about 150 MB, mostly Chromium.
