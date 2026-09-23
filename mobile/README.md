# Script Glow companion (iPhone and Android)

A rehearsal-only phone app. The Mac does the script, the cast and the voices. The phone plays the scenes the Mac already rendered.

## How a project gets to the phone

1. On the Mac, open the project and choose **Back up**. This writes a `.sgbackup` file.
2. AirDrop it to the phone, or save it to Files. Tap it and iOS opens it in Script Glow. **Add from Files** in the app does the same.
3. Send it again to update it. The phone keeps its own rehearsal settings (mode, hint, speed, wait) and replaces the rest.

Only scenes that have audio on the Mac come across. Nothing goes back to the Mac.

## What it reuses

- `../src/parser.ts`: turns the script text into lines.
- `../src/playback.ts`: cue timing, wait for me, speed and first-letter hints.
- `../src/listening.ts`: the microphone-level check that ends the wait.
- `src/backup.ts` reads the file that `server/projects.js` (`backup`) writes. The test is `../tests/mobile-backup.test.ts`, which `npm test` at the repo root runs.

Projects and audio are stored in the web view's IndexedDB.

## Build

```sh
cd mobile
npm install
npm run ios       # builds, syncs and opens Xcode
npm run android   # needs Android Studio and its SDK
```

`npm run dev` serves the app in a browser at phone width, for quick UI work.

## Not in this version

Build up line by line, A/B loop, self-tape and line check are desktop only for now. Android has no "Open in" file handler yet, so on Android use **Add from Files**. Tested on an Android 16 emulator: launch and import.
