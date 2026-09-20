# Listening mode, phase one

Done. Released in 0.4.0. Phase two followed in 0.5.0.

Spec: `docs/superpowers/specs/2026-09-20-listening-mode-design.md`. Date: 2026-09-20.

Phase one only: the microphone level ends the wait. No transcript, no network, no key, no new server route. Space and **Continue** keep working throughout.

## Steps

Each step is finished when its check passes.

1. **`listenStep` in `src/playback.ts`.** A pure reducer over microphone levels: calibrate the room, hear speech start, end the line on a held silence. Check: `npm test` with the new cases in `tests/playback.test.ts`.
2. **Profile keys in `server/connections.js`.** `autoContinue: { enabled, holdMs }` with strict validation. Check: `npm test` with the new cases in `tests/connections.test.js`, including a profile saved before this change.
3. **`src/listening.ts`.** Opens the microphone once, reads its level through an `AnalyserNode`, drives `listenStep`, calls back when the line ends. Check: it is used by step 4 and proved by step 6.
4. **Wire it into the player in `src/main.ts`.** Start on the wait, stop on release, stop on scene change. Check: `npm run build` and the browser check in step 6.
5. **Settings in `src/main.ts`.** The **Listening** section, the **Continue when I stop** switch, the pause slider, and the `ConnectionProfile` interface. Check: `npm test` (`tests/settings.test.js`) and the browser check.
6. **`verification/listening.mjs`.** Chrome with a fake microphone plays a spoken line into a scene: playback continues with no key press. Silence instead: the wait stays open and Space still works.
7. **Words.** `README.md` feature list, `src/help.ts`, `SECURITY.md` microphone line, `CHANGELOG.md`.

## Not in this phase

The transcript layer, `lineMatch`, `POST /api/listen/transcribe`, the paid streaming engine, and a click on the script background to continue. Everything but the last two landed in 0.5.0.
