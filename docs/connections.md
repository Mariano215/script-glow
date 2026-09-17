# Connection profile and keys

Script Glow keeps two kinds of settings apart:

| File | Holds | Safe to copy to another computer |
| --- | --- | --- |
| `data/connections.json` (or `SCRIPT_GLOW_CONFIG`) | Which engines to use, server addresses, your own voice name | Yes. It never holds a key. |
| Key file in your user settings folder (or `SCRIPT_GLOW_SECRETS`) | API keys and the voice server token | No |

The key file is at:

| System | Path |
| --- | --- |
| Windows | `%APPDATA%\script-glow\secrets.json` |
| macOS and Linux | `~/.config/script-glow/secrets.json` (or `$XDG_CONFIG_HOME/script-glow/secrets.json`) |

On macOS and Linux the folder is set to owner-only (`0700`) and the file to `0600`. On Windows, your user folder is private to your account by default.

## The Settings screen

**Settings** writes the profile for you. A change applies as soon as you press **Save changes**; no restart is needed. It cannot be saved while audio is being made, so a scene never mixes two engines.

Keys are added one at a time under **Keys for paid services** with **Save key**. The browser never gets a key back: it sees only whether one is set and its first 3 and last 4 characters. **Test the key** uses the saved key, so save it first.

## Editing the file by hand

Copy `connections.example.json` to `data/connections.json`, edit it, and restart Script Glow. A missing file means the defaults (every service on `127.0.0.1`). When `SCRIPT_GLOW_CONFIG` names a file, that file must exist, and Settings saves back to it.

Startup stops with an error when the profile:

- is larger than 16 KB, or is not valid JSON,
- has a field Script Glow does not know,
- has a URL that is not HTTP(S), or that has a user name, password, query or fragment,
- has a model name that looks like an API key.

Every field is described in the [README](../README.md#configure).

## Your own voice

**Settings > Your voice > Record my voice** records about 20 seconds, sends the recording to your Chatterbox server with `PUT /v1/voices/<name>`, keeps a private copy in `data/voice-previews/actor-preview.wav`, and sets `casting.preferredActorVoice`. Lines made with an earlier recording are made again, because the cache key includes the recording's date.

To do it by hand, save a WAV as `voices/<Name>.wav` on the voice server, put `<Name>` in `casting.preferredActorVoice`, and optionally copy the same WAV to `data/voice-previews/actor-preview.wav`.

`casting.aliases` maps other voice IDs to one canonical ID (no chains), so two names for the same recording count as one voice when casting.

## A voice server on another computer

Start the server there with a token (see [voice-server/README.md](../voice-server/README.md)). In Script Glow:

1. **Settings > Advanced > Chatterbox server**: its address, for example `http://gpu-desktop:8095`.
2. **Keys for paid services > Voice server token**: the same token.

Script Glow sends the token as `X-Voice-Token` on every call to that server. The token is kept in the key file, not in the profile.

## What each service is used for

| Service | Contract | Used for |
| --- | --- | --- |
| Chatterbox | `GET /health`, `GET /v1/voices`, `POST /v1/tts` (WAV out), `PUT /v1/voices/<name>` | Voicing lines, your own voice |
| Ollama | `GET /api/tags`, `POST /api/generate` | Guessing voice types from character names (optional) |
| WhisperX | `GET /health` | Health check and verification scripts only |

Script Glow never downloads a model. An empty Ollama model turns AI suggestions off; you can still choose every voice type by hand.
