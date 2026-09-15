<p align="center"><img src="public/brand/script-glow-mark-v2.png" alt="Script Glow logo" width="96"></p>

# Script Glow

A local rehearsal studio for actors. Import a script, pick your character, give every other part a voice, and rehearse with an AI scene partner.

Script Glow renders two tracks for any scene or the full script:

- **Full cast**: every character speaks, so you learn the rhythm.
- **Practice**: your lines become silence of the exact same length, so you speak them on cue.

Everything runs on your own machine. Scripts and audio are not sent to a paid cloud API.

## Features

- **Script import**: plain text, [Fountain](https://fountain.io), and text-based PDF. Scene headings, act breaks, characters, and dialogue are detected, and you can fix them in the built-in editor.
- **Screenplay view**: US Letter geometry, 12 pt Courier, standard dialogue and parenthetical indents.
- **Casting**: a card for every character with voice type, voice choice, and preview. Defaults come from script descriptions and pronoun cues. A local LLM (Ollama) can suggest voice types when the script gives no cue. Voices already in use are greyed out.
- **Rehearsal**: full script or single scene, adjustable pause between lines, optional stage directions, hide and reveal your lines, loop, and 0.75× to 1.5× speed.
- **Script marking**: separate highlight and playback colors for your role or any character. Marks stay visible in print.
- **Project library**: many projects on disk, autosave, `.sgbackup` export and restore, and render reuse when inputs match.
- **Downloads**: full-cast and practice WAV files.
- **In-app guide**: press **? Help** in the top bar.

## Requirements

| Component | Required | Purpose |
| --- | --- | --- |
| [Node.js](https://nodejs.org) 24+ | Yes | Runs the app and API |
| Voice server | Yes, for audio | Reads the script aloud. Use the included [voice server](voice-server/README.md) (Chatterbox, Python 3.12, NVIDIA GPU recommended), or any server with `GET /health`, `GET /v1/voices`, and `POST /v1/tts` (`{ "text", "voice" }` in, WAV out). |
| [Ollama](https://ollama.com) | Optional | AI voice-type suggestions. Needs an installed model. |
| WhisperX server | Optional | Health check and verification scripts only. |

Windows is verified. Linux and macOS should work but are not tested.

## Install

```sh
git clone https://github.com/Mariano215/script-glow.git
cd script-glow
npm install
```

## Set up voices

Follow [voice-server/README.md](voice-server/README.md) to install the voice server and the free stock voices. Start it before Script Glow.

## Configure

The defaults work with the included voice server on the same computer, so this step is optional. To change service addresses, copy the example profile and edit it:

```sh
mkdir data
cp connections.example.json data/connections.json
```

```json
{
  "version": 1,
  "name": "My local services",
  "chatterbox": { "url": "http://127.0.0.1:8095", "cacheNamespace": "my-chatterbox", "legacyCache": false },
  "whisperx": { "url": "http://127.0.0.1:8010" },
  "ollama": { "url": "http://127.0.0.1:11434", "model": "" },
  "casting": { "preferredActorVoice": "", "aliases": {} }
}
```

| Field | Meaning |
| --- | --- |
| `chatterbox.url` | Base URL of the TTS server. |
| `chatterbox.cacheNamespace` | Keeps the line cache separate for each voice server. |
| `whisperx.url` | Base URL of the optional WhisperX server. |
| `ollama.url`, `ollama.model` | Ollama server and an installed model name. An empty model turns AI suggestions off. |
| `casting.preferredActorVoice` | Optional voice ID for your own cloned voice. It is used for your role when available. |
| `casting.aliases` | Maps other voice IDs to one canonical ID. |

Rules:

- `data/connections.json` is gitignored. Without it, the app uses loopback defaults.
- To use a file somewhere else, set `SCRIPT_GLOW_CONFIG=/path/to/profile.json`.
- URLs must be HTTP(S) and cannot contain credentials, a query string, or a fragment. Do not put API keys in the profile. Invalid profiles stop startup with an error.
- A private preview of your own voice can go in `data/voice-previews/actor-preview.wav`.

Restart the app after you change the profile. See [docs/connections.md](docs/connections.md) for the details.

## Run

Development (API on port 3001, Vite UI with hot reload):

```sh
npm run dev
```

Open http://127.0.0.1:5173.

Compiled app:

```sh
npm run build
npm start
```

Open http://127.0.0.1:3001.

## How to rehearse

1. Click **New project** and import a script, or use the included sample.
2. Click **Edit script** to check the parsed scenes and characters.
3. Open **Cast**. Click **I'm playing this role** on your character. Pick and preview a voice for every other character.
4. Open **Rehearsal**. Choose **Full script** or one scene and press **Play**. The first render is slower while Chatterbox loads its model.
5. Listen in **Full cast**, then switch to **Practice** and speak your lines in the gaps.
6. Download either WAV to rehearse away from the app.

Changes to the script, cast, your role, pause length, or stage directions need new audio. Speed and highlight colors do not. Scene labels show **Audio ready** or **Audio not made yet**.

### Script format tips

- Give each scene its own heading: `INT.`/`EXT.`, a numbered heading, `SCENE 1`, or a Fountain heading such as `.THE GARDEN`.
- If a break is not detected, add `# Scene title` above the scene.
- Put character names in uppercase above dialogue, or write `NAME: dialogue`.
- Scanned (image-only) PDFs need OCR before import.

## Projects and data

| Location | Contents | Git |
| --- | --- | --- |
| `data/projects/` | Projects, manifests, and saved render WAVs | Ignored |
| `data/connections.json` | Your connection profile | Ignored |
| `.cache/` | Line audio cache (512 MiB) and export cache (1 GiB), oldest files removed first | Ignored |
| `artifacts/` | Verification output | Ignored |

- Settings autosave. Wait for **Saved locally**. Script text needs **Save script** in the editor.
- **Export backup** writes a `.sgbackup` with the script, cast, settings, and audio. **Restore backup** always creates a new project.
- Limits: 1,000 projects and 4 GiB per backup. Each project keeps its 200 newest audio versions. Older versions and their WAV files are removed automatically, because the audio can always be made again.
- Render limits: full script up to 5,000 lines, 500,000 characters, and 2 hours of audio. One scene up to 300 lines, 60,000 characters, and 30 minutes. One speech can be up to 20,000 characters; long speeches are split into sentences for the voice service and joined back together.
- There is no delete-project button yet.
- Keep backups on a different drive.

More detail: [docs/project-library.md](docs/project-library.md).

## Security

Script Glow is a single-user local app with no authentication. The server listens on `127.0.0.1` only and checks the `Host` and `Origin` headers. Do not expose it to a network. Imported scripts and backups are treated as untrusted input: size limits apply, text is escaped before rendering, and PDFs are parsed in a separate process with memory and time limits.

## HTTP API

The UI uses these local endpoints. They are internal and can change.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Status of the voice and transcription services |
| GET | `/api/connections` | Effective non-secret connection settings |
| GET | `/api/voices` | Voice IDs from Chatterbox |
| POST | `/api/import` | Extract text from an uploaded PDF (10 MB max) |
| POST | `/api/casting/guess-genders` | AI voice-type suggestions for character names |
| POST | `/api/render` | Start a render job |
| GET | `/api/jobs/:id` | Render job progress and result |
| POST | `/api/jobs/:id/cancel` | Cancel a render job |
| GET | `/audio/:filename` | Cached render audio |
| GET, POST | `/api/projects` | List or create projects |
| GET, PUT | `/api/projects/:id` | Read or save a project |
| POST | `/api/projects/:id/renders` | Save a finished render to the project |
| GET | `/api/projects/:id/audio/:filename` | Saved project audio |
| GET | `/api/projects/:id/backup`, `/backup-info` | Download a backup, or list the audio it will contain |
| POST | `/api/projects/restore` | Restore a backup as a new project |
| GET | `/private-voice-preview.wav` | Optional local actor voice preview |

## Development

```sh
npm test          # unit and API tests (node:test)
npm run build     # type check and production build
```

Browser checks with their own isolated server and fake voices (no GPU, no real data):

```sh
node verification/studio-workspace.mjs
node verification/project-library.mjs
node verification/render-guard.mjs
```

Checks against a running app (GPU checks need the voice server and should run one at a time):

```sh
node verification/browser.mjs
node verification/pdf-import.mjs
node verification/live-render.mjs          # renders a short scene, checks silence and timing
node verification/transcribe-render.mjs    # optional: checks words with WhisperX
node verification/voice-auditions.mjs      # optional: audition clips for stock voices
```

Service scripts read the URLs from your connection profile. Output goes to `artifacts/`.

### Project layout

```
server/        Express API: rendering, projects, PDF import, casting AI, connection profile
voice-server/  Optional Chatterbox voice server (Python)
src/           Vite + TypeScript UI: parser, casting, highlights, help, styles
tests/         node:test suites
verification/  Browser (Playwright) and live-service checks
scripts/       Voice reference installers and manifests
public/        Logo, bundled fonts, voice preview clips
docs/          Design notes and feature write-ups
```

### Documentation

- [Design and acceptance criteria](docs/design.md)
- [Connection profile and adapters](docs/connections.md)
- [Project library](docs/project-library.md)
- [AI casting](docs/ai-casting.md)
- [Voice sources](docs/voices.md) and [voice expansion](docs/voice-expansion.md)
- [TTS alternatives and costs](docs/tts-options.md)
- [Cast screen and highlights](docs/studio-navigation-highlights.md)
- [Desktop rehearsal roadmap](docs/desktop-rehearsal-roadmap.md)
- [Product research](docs/research.md)
- [Brand assets](docs/brand.md)

## Credits and licenses

- Fonts: DM Sans and Libre Baskerville, SIL Open Font License. See [public/fonts](public/fonts/README.md).
- Voice previews: generated by Chatterbox from CC0 references ([Kokoro Voices](https://github.com/n33kos/kokoro-voices), [Voice-Zero](https://github.com/OwenTyme/voice-zero)). See [public/voice-previews](public/voice-previews/README.md). No personal voice samples are included.
- Script Glow code: [MIT License](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md). Bundled fonts and voice previews keep their own licenses above.
