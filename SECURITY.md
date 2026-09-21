# Security

## Design

Script Glow is a single-user app that runs on your own computer. It has no accounts or passwords.

- The app listens on `127.0.0.1` only. It refuses requests addressed to any other host name or sent from another site, and it cannot be shown inside another page.
- Every change sent from the browser must carry a secret that is made new each time the app starts.
- Imported scripts and backups are treated as untrusted: sizes are limited, text is escaped, and PDFs are read in a separate process with memory and time limits.
- The secret stops web pages, not programs. Any program on this computer can reach `127.0.0.1`, ask for the secret and use the app as you would: read your projects and takes, make audio with your paid voice keys, and test a voice server address, which sends your Chatterbox token to it. A program running as you can read your files anyway. Another user account on the same computer can do the same, so use Script Glow on a computer that only you log in to.

## Keys

- API keys and the voice server token are kept in your user settings folder: `%APPDATA%\script-glow\secrets.json` on Windows, `~/.config/script-glow/secrets.json` on macOS and Linux. On macOS and Linux the file is `0600` and its folder `0700`.
- A key is never sent back to the browser, never written to `data/connections.json`, never put in a project backup, and never shown in an error message.
- Each key is sent only to its own provider, in a request header, and never follows a redirect.

## What leaves your computer

| You choose | What is sent | To whom |
| --- | --- | --- |
| Chatterbox on this computer, Ollama on this computer | Nothing | |
| A hosted voice engine (ElevenLabs, OpenAI, Google Gemini) | The text of each line when new audio is made | That company |
| A hosted engine for name guesses (OpenAI, Claude, Gemini, Grok, OpenRouter) | Character names only | That company |
| A Chatterbox or Ollama server on another computer | Lines, names, and your voice recording | That computer |
| The desktop app, at every start | A request for the latest release, and the download of a newer one | GitHub |

Your script file, your settings and your self-tapes are never sent to any of them.

**Continue when I stop speaking** opens the microphone while practice mode waits on your line, and reads only how loud the room is. No recording is made, nothing is written to disk and nothing leaves the browser. The microphone is closed again when you switch the setting off.

**Check what I said** is off unless you switch it on. With it on, each line you speak is recorded while practice mode waits, and the recording is sent to the WhisperX address in your profile, which is a machine you chose. The clip is held in memory on the way through, is never written to disk, and is dropped once the text comes back. The text is compared with the script in your browser and the result is kept only until the scene is reloaded.

## The voice server

The voice server in `voice-server/` listens on `127.0.0.1` and answers only requests addressed to this computer, so a web page cannot reach it by pointing its own domain at `127.0.0.1`.

To use it from another computer, set `VOICE_HOST`, `VOICE_ALLOWED_HOSTS` and `VOICE_TOKEN`. It will not start on a network address without a token of 20 or more characters, and it then refuses every request without that token (except `/health`). New voices are refused on a network address unless `VOICE_UPLOADS=on`. Anyone with the token can make speech in any installed voice, including yours, so keep it private and use a private network.

## Files on disk

`data/` holds your projects, self-tapes and your voice recording. On macOS and Linux your voice recording is owner-only. On Windows, files in `data/` get the permissions of the folder you cloned Script Glow into; clone it inside your user folder if other people use this computer.

## Reporting a vulnerability

Please report it privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Do not open a public issue. Include the steps to reproduce and the version or commit.

Only the latest release receives fixes.
