# Built-in Kokoro voices: design

Updated 2026-09-19 after implementation: fp32 model, release switch.

Date: 2026-09-19. Status: approved and implemented.

## Goal

An actor installs Script Glow and hears the cast read their scene with no voice server, no GPU, no API key and no cost. Kokoro-82M runs on the computer's CPU inside the app, at about 0.46 s per line on an Apple M2 Pro. It becomes the recommended choice for anyone without a voice server. Chatterbox and the paid services stay as they are.

Out of scope: voice cloning with Kokoro (it has none; Record my voice stays a Chatterbox feature), languages other than English, GPU acceleration, and part-of-speech rules for words spelled alike but said differently (read, live, lead).

## Evidence

Two throwaway spikes on 2026-09-19 (`scratchpad/kokoro-spike`, `scratchpad/phonemizer-spike`, with `FINDINGS.md`):

- Kokoro runs through transformers.js and onnxruntime-node under Node, under Electron 44 and in an Electron utility process. No Python.
- fp32 model (`model.onnx`, about 325 MB; the fp16 model gave silent audio on CPU): about 0.46 s per line including our G2P step. Output is 24 kHz mono, the app's own sample rate.
- 28 English voices (US and UK, female and male).
- A GPL-free text-to-phoneme step (G2P) works: Misaki's word lists plus Misaki's small fallback model, ported to JavaScript. It covered 100% of the dialogue words in the sample script. Its only audible differences from espeak were proper names.

## Licensing rules

- Nothing GPL or LGPL ships. `kokoro-js` is not used, because it imports the `phonemizer` package, which contains espeak-ng (GPL-3.0). About 10 lines of transformers.js calls replace it.
- `sharp` (pulled in by transformers.js, with an LGPL-3.0 image library) is replaced with an empty stub through npm `overrides`. The voice engine never uses it.
- A `THIRD_PARTY_NOTICES.md` in the app lists every shipped or downloaded component with its license text: Kokoro-82M and its voices (Apache-2.0), transformers.js (Apache-2.0), onnxruntime (MIT), the Misaki G2P port and data (Apache-2.0, noted as modified), the fallback G2P weights (Apache-2.0), number-to-words (MIT), and their small dependencies.
- **Release switch:** Misaki's word lists have no statement of where their data came from. Mariano opens an issue on hexgrad/misaki to ask. `server/kokoro/release-gate.json` hides the built-in voices from everyone until `misakiProvenanceCleared` is set to `true`, which waits on that answer; a developer can turn them on for their own copy with `SCRIPT_GLOW_EXPERIMENTAL_KOKORO=1`. If the answer does not show the data is permissive, the word lists are rebuilt from CMUdict (BSD-2) with the mapping already written in the spike (86% agreement), and the fallback model is either retrained on that list or left out.

## Parts

### 1. Engine

- A new voice engine id, `kokoro`, next to `chatterbox`, `openai`, `gemini` and `elevenlabs` (`server/connections.js` `VOICE_ENGINES`). It needs no key and costs nothing, so it counts as local, not hosted: the stage-directions prespeak and the "free" labels treat it like Chatterbox.
- Voice ids are `kokoro:<name>` (for example `kokoro:af_heart`). The voice list gives each voice a label, accent (US or UK) and gender, taken from the name prefix (`af`, `am`, `bf`, `bm`). Only the English voices are offered.
- The line cache key includes the engine, the model file hash, the G2P data version, the voice and the text, so a model or G2P update never reuses stale audio.

### 2. Worker

- One long-lived worker runs the G2P and the model, because loading takes about a second. Under Electron it is a `utilityProcess` (the same pattern as the PDF worker, since the RunAsNode fuse is off). Under plain Node (`npm start`, tests) it is a `child_process.fork`.
- Requests are handled one at a time, in order. A line that takes more than 60 s fails with a clear message.
- The worker unloads after 10 minutes without a request, to give memory back, and is stopped when the app quits.
- New files: `server/kokoro/worker.js` (model and voices), `server/kokoro/g2p.js` (the Misaki port from the spike, about 150 lines plus the fallback), `server/kokoro/client.js` (starts the worker, queues requests, restarts it after a crash).

### 3. Model files: downloaded on first use

- Files: the fp32 model (`model.onnx`, about 325 MB), the English voice packs, the tokenizer files, the Misaki US and GB word lists, and the two small fallback G2P models. About 360 MB in total.
- They are published once as assets of a GitHub release in the Script Glow repository (for example tag `kokoro-assets-v1`), so there is one pinned place to download from. The app carries a manifest with each file's URL, size and SHA-256, and refuses a file whose hash does not match.
- They are stored in the user folder: `<SCRIPT_GLOW_HOME or userData>/models/kokoro-v1/`. The download resumes after an interruption and writes each file to a temporary name first, so a half-downloaded file is never used.
- The installer size does not change, except for the runtime: onnxruntime-node for the one system and processor being built, onnxruntime-common, the Node build of transformers.js and number-to-words, about 36 MB installed and about 10 MB zipped. The browser runtime (onnxruntime-web) and the other systems' binaries are left out of the build.

### 4. First run and Settings

- The welcome gets a new first choice, marked recommended: **Free voices on this computer**, "No setup. Works on any laptop. Downloads about 360 MB once." Choosing it sets the engine to `kokoro`, saves at once (auto-save), and starts the download with a progress bar. The cast can be set up while it downloads, and rendering waits for it.
- Settings gets a fourth engine card: **Built-in voices**, "Free · Private · No setup". While the files download, the card shows progress; once done, "Ready". A **Remove downloaded voices** link frees the space.
- A slow or failed download says what happened and offers **Try again**. The other engines stay available.

### 5. Pronunciation for names

- The Cast screen gets a **Say it like** box on each character card. The actor types how the name sounds in plain spelling, for example `shi-VAWN` for Siobhan. Capitals mark the stressed syllable.
- The text sent to every engine replaces the name with that spelling. So it also helps Chatterbox and the paid services, not only Kokoro. For Kokoro the G2P turns the respelling into phonemes, with the capitalized syllable stressed.
- It is saved in the project, and it is part of the render key, so changing it re-renders only the lines that contain the name (the other lines come from the line cache).

## Error handling

- Download: a network error, a full disk or a hash mismatch each show a plain message and **Try again**. Nothing partial is ever loaded.
- Worker crash: the client restarts it once and retries the line. A second crash fails the render with the message, like a Chatterbox error does today.
- Missing files at render time (for example deleted by hand): the engine reports "Built-in voices are not downloaded" with a button to download them.

## Tests

- G2P unit tests: the 20 actor lines from the spike with their expected phonemes, the stemming and clitic rules, numbers and times, ALL CAPS names, and a respelling with stress.
- Worker protocol tests with a fake model: order, one request at a time, timeout, crash and restart, idle unload.
- Download tests against a local fake server: resume, hash mismatch, full disk, and no partial file used.
- A license check in `npm test`: the production dependency tree contains no package whose license is GPL, LGPL or AGPL, and `phonemizer` and `@img/sharp-libvips-*` are absent.
- An end-to-end render with the real model, run in the CI `desktop` job with the model files cached between runs, and by hand on Mac and on a Windows laptop.
- Browser checks: the welcome's new choice, the download progress, the Settings card, and the **Say it like** box.

## Risks

- The Misaki word-list provenance (release switch above).
- Speed on a low-end Windows laptop is unknown. Measure before release. If it is slower than about 2 s per line, render a scene ahead in the background.
- Some Kokoro voices sound flat for emotional lines. The engine card lists the best-rated voices first.
- 360 MB is a large first download on a slow connection. The progress bar and resume help.
