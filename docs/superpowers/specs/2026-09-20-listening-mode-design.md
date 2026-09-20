# Listening mode design

Date: 2026-09-20. Status: draft, waiting for review.

## Goal

In practice mode the app pauses on the actor's line and waits. Today the actor presses Space or taps **Continue** (`src/main.ts:1885`, `src/main.ts:1737`). That is a hand on a keyboard in the middle of a performance. Listening mode ends the wait by itself when the actor stops speaking, so a scene runs from the first line to the last without a key press.

Out of scope: scoring the actor's delivery, correcting them, reading along to show where they are in the line, languages other than English, and any use of the microphone outside the wait window.

## What was measured, 2026-09-20

Round trip to the WhisperX server at `100.120.203.53:8010`, `large-v3` with diarization on, from a Mac on the same network (5 ms health round trip):

| Spoken clip | Warm round trip |
| --- | --- |
| 1.17 s | 0.97 s |
| 4.29 s | 1.09 s to 1.18 s |
| 10.41 s | 1.54 s |

First call after idle: 4.12 s. Pinning `language=en` saved about 0.08 s.

Two conclusions decide the design. There is a fixed cost of about 0.9 s before any audio length is counted, so the network and the GPU are not the limit. And the server transcribes a finished file, so nothing can be sent until the actor has stopped. A transcript cannot be what ends the wait: it would arrive 1.3 s to 2.1 s after the last word, and a scene partner comes in at about 0.2 s.

So the microphone decides when the line ended, and the transcript, when there is one, only says what was said.

## Parts

### 1. Silence ends the wait (`src/listening.ts`, new)

While `waitingFor` is set, and only then, the app holds a microphone stream and watches its level through a Web Audio `AnalyserNode`. No recording, no file, no network.

The decision is a pure function in `src/playback.ts`, next to `shouldWait`, so it is unit tested without a browser:

```ts
listenState(previous, { level, now, speechSince, silenceSince }) -> 'waiting' | 'speaking' | 'done'
```

Rules:

- Speech starts when the level is over the floor for 120 ms. A cough or a chair does not start it.
- The line ends when the level stays under the floor for the hold time after speech has started. Default hold 0.5 s, set by the actor from 0.5 s to 5 s in half second steps, the same range and step as **Pause between lines** (`src/main.ts:1510`), with the same two labels: Natural, and Take your time.
- The floor is measured, not fixed: the app takes the room's level for the first 300 ms of the wait and sets the floor above it. A noisy room raises its own floor.
- If no speech is heard for 20 s, the wait stays open and the actor presses Space as they do now. Listening never traps the scene.

A long hold is cheap, which is the point of the range going to 5 s. Space and **Continue** keep working while listening is on, so an actor who sets a 4 s hold for a scene full of pauses can still come in early on any line by pressing Space. The hold is the ceiling on how long the app will wait, not a delay the actor has to sit through.

The actor's line in practice mode is baked silence, so during the wait nothing is playing and the only sound in the room is the actor. Echo cancellation and noise suppression are on in the stream constraints, as they already are for self-tape (`src/selftape.ts:169`).

`releaseWait()` (`src/main.ts:228`) is what listening calls, which is the same function Space and **Continue** already call. Whichever comes first wins, and the other does nothing because `waitingFor` is already cleared.

### 1a. The manual ways to continue, which already exist

These are built and stay built. Listening is added beside them, never instead of them.

- **Space** anywhere outside a field or a dialog (`src/main.ts:1929`).
- **Continue** on the player, which replaces the play button while waiting (`src/main.ts:1737`, `src/main.ts:1975`). On a touch screen it is a tap, and the status line already says so (`src/main.ts:1951`).

One thing is not built: a click anywhere else does not continue. It could, but it collides with an existing control, because clicking a line already plays from that line (`src/main.ts:1638`). The narrow version that does not collide: while `waitingFor` is set, a click on the script panel background, not on a line, continues. Worth doing only if the **Continue** button turns out to be too small a target in practice. It is not in phase one.

### 2. The microphone

- One stream, asked for on the first wait of a session and kept until the scene is closed, because asking on every line makes the browser light blink and costs about 200 ms.
- Audio only: `{ audio: { echoCancellation: true, noiseSuppression: true } }`.
- The self-tape recorder already owns the microphone while a take is recording, and the wait is skipped then (`src/main.ts:1885` tests `!recorder?.recording`), so the two never compete.
- If permission is refused, listening turns itself off, says so once, and the scene falls back to Space. The setting stays off until the actor turns it on again.
- In the desktop app the microphone is already allowed for the app's own origin only (`desktop/main.js`), so nothing new is granted.

### 3. The transcript layer (optional, off by default)

When a transcription service is set, the span between speech start and speech end is also sent for transcription, **after** the wait has already been released. It never delays the cue. What it buys:

- The line is marked in the script as said, skipped, or different from the text, so an actor reviewing a run sees where they dropped a line.
- A wrong line is named: "you said the line before this one".

Comparison is a pure function in `src/playback.ts`:

```ts
lineMatch(spoken: string, expected: string) -> { score: number; verdict: 'said' | 'partial' | 'different' }
```

Both sides are lowercased, punctuation dropped, and compared as a word-overlap ratio. Thresholds: 0.7 said, 0.4 partial, below that different. The server's answer carries a `SPEAKER_00: ` prefix because diarization is on, so the prefix is stripped before comparing.

Server route, following the adapter name already published at `server/app.js:150` (`whisperx: 'multipart-transcriptions-v1'`):

`POST /api/listen/transcribe`, body the clip, answer `{ text }`. It posts to `${profile.whisperx.url}/v1/audio/transcriptions` as multipart with `model`, `language=en` and `file`, the same shape `verification/transcribe-render.mjs:8` already uses. The browser never calls the WhisperX box directly, so the server address stays a server-side concern, as it is for Chatterbox and Ollama.

The clip is held in memory and dropped when the answer arrives. Nothing is written to disk. This is different from a self-tape take, which the actor asked to keep.

### 4. Where the controls live

Built: in the Practice card, directly under **Wait for me on my line** (`src/main.ts:1504`), because it changes what that switch does. The pause slider appears only when listening is on, the same way **Times through each block** appears only with build-up.

- **Continue when I stop speaking**: off by default.
- **How long I can pause**: 0.5 s to 5 s in half second steps, default 0.5 s, the same range, step and labels as **Pause between lines**.

The two values sit in `prefs`, beside `wait`, `hint` and `build`, not in the connection profile. An earlier draft of this spec put them in the profile on the argument that the microphone belongs to the machine. That was wrong: the setting is a rehearsal preference, and its sibling control is already in `prefs`, so the profile would have been a second home for one idea. `prefs` travels with the project, so a scene full of pauses keeps its longer hold (`server/projects.js:36`, `server/projects.js:51`).

The **WhisperX server** row in Advanced (`src/main.ts:1271`) is untouched in phase one, because phase one never calls it. It loses "Not used yet" in phase two.

### 5. A paid streaming service (later phase, not phase one)

Batch transcription cannot beat the microphone on timing, so a paid service is only worth adding for the accuracy layer, or for an actor who wants the cue to fire on the last words of the line rather than on silence. Streaming services send partial text while the actor is still speaking, which makes that possible.

Prices per hour of audio, checked 2026-09-20:

| Service | Price/hr | Latency (their claim) |
| --- | --- | --- |
| AssemblyAI Universal-Streaming (English) | $0.15 | not published, billed on socket open time |
| Deepgram Nova-3 streaming | $0.29 promotional, $0.46 regular | about 300 ms partials |
| Deepgram Flux (English) | $0.39 | end-of-turn detection built in |
| ElevenLabs Scribe v2 Realtime | $0.39 | about 150 ms first partial |

None of these were measured here. If one is added, it is ElevenLabs Scribe v2 Realtime: the app already stores, tests and uses an ElevenLabs key (`server/hosted.js:57`, `server/secrets.js:10`), so it needs no new provider, no new key row and no new settings screen. Deepgram Flux is the one to pick instead if end-of-turn quality turns out to matter more than reusing the key.

Whatever is chosen stays off unless the actor picks it, like every other hosted engine in this app.

## Privacy

- Listening off: the microphone is never opened.
- Listening on, checking off: the microphone is opened during the wait only, and only its level is read. No audio leaves the browser and nothing is stored.
- Checking on with WhisperX: the clip goes to the address the actor typed, which is their own machine.
- Checking on with a paid service: the clip goes to that company, which charges for it. The app says so on the setting, in the same words the voice engines already use, and shows the cost before it is spent.

`SECURITY.md` gains a line: what the microphone is used for, when it is open, and where the audio goes in each case.

## Tests

Unit, `tests/playback.test.ts`:

- `listenState` goes waiting to speaking to done on a level series, and stays waiting when the level never rises.
- A short spike under 120 ms does not start speech.
- Silence shorter than the hold does not end the line, at the shortest hold and at the longest.
- A pause in the middle of a line does not end it when the hold is longer than the pause.
- The floor follows the measured room level.
- `lineMatch` returns said, partial and different for the three cases, and ignores case, punctuation and the `SPEAKER_00: ` prefix.

Unit, `tests/connections.test.js`: the new `listen` keys round trip, an unknown key is refused, and an old profile without `listen` loads with the defaults.

Unit, `tests/backend.test.js`: `POST /api/listen/transcribe` returns the text from a fake transcription server, and reports a server that is down in words an actor can act on.

Browser, `verification/listening.mjs` (new): Chrome with `--use-fake-device-for-media-stream` and `--use-file-for-fake-audio-capture`, which the existing checks already use (`verification/lib.mjs:12`). A scene reaches the actor's line, the fake microphone plays a spoken line, and playback continues on its own without a key press. Then the same scene with silence: the wait stays open and Space still works.

## Risks

- **A room with a fan or a street outside.** The measured floor handles steady noise. A sudden noise during the hold can hold the line open, which is the safe direction: the actor presses Space, as today.
- **An actor who pauses for effect mid-line.** Any hold short enough to feel responsive will cut in on a dramatic pause. That is why the range reaches 5 s and why Space still comes in early: an actor who pauses can set a long hold and lose nothing, because they can always cut the wait short by hand. The transcript layer is the real answer, since with it on the app can tell a pause from a finished line by whether the words so far cover the line. Phase one ships the knob, not the cleverness.
- **Bluetooth headsets** add 100 to 300 ms of their own and often drop the microphone to a low sample rate. Worth testing before claiming a number in the release notes.
- **The 0.9 s server floor** is `large-v3` with diarization on. For one actor alone in a room, diarization earns nothing. A smaller English model with diarization off should take the floor well under half a second, but that is a change on the machine running WhisperX, not in Script Glow.

## Phases

1. Silence ends the wait, settings switch, hold knob, unit tests, browser check. No network, no key, no server route. This is the feature for most actors.
2. The transcript layer against WhisperX: the new route, `lineMatch`, and the marks in the script.
3. A paid streaming service, if phase two shows the accuracy layer is worth paying for.
