# Changelog

## 0.2.0 (2026-09-17)

### Upgrading from 0.1.0

- Run `npm install` again.
- Replace `voice-server/server.py` on the machine that runs it. **Record my voice** needs its new `PUT /v1/voices` route.
- A voice server that listens on a network address now needs `VOICE_TOKEN` and `VOICE_ALLOWED_HOSTS`, and refuses new voices unless `VOICE_UPLOADS=on`. See `voice-server/README.md`. Put the same token in Settings.
- Parentheticals such as *(quietly)* are no longer read aloud. Audio made before still plays; new audio for those lines leaves them out.
- Reload any open Script Glow tab after the update: changes from the browser now need a secret made at each launch.

### New

- Practice controls: click a line to play from it, build up line by line, listen only, first-letter prompts, wait for me, A to B repeat.
- Self-tape: record a take against the cast, with a count-in beep, a recording light, fill the screen, and the script beside or over the camera.
- Settings screen: voice engine, name guessing, your own voice and keys, with a test for each server and a save bar.
- Hosted voices (OpenAI, Google Gemini, ElevenLabs) with voice previews, and hosted name guessing (OpenAI, Claude, Gemini, Grok, OpenRouter), off until chosen, with the cost shown before audio is made.
- Keys kept in your private user folder, never shown again and never in a backup. A FAL key can be stored for later video work (not used yet).
- Record your own voice from Settings; the voice server accepts it and keeps the previous recording.
- Projects list with dates, rename and delete (to a trash folder).
- Readability, phone layout and safety fixes from a full front-end review.
- Finish the tape: reader volume in the take, a slate recorded on its own, a casting-site check (Casting Networks, Eco Cast, Spotlight), Performer_Project_Scene file names, and trim to MP4 (FFmpeg, or the browser without it).
- The version is shown under the logo.
- New settings: `SCRIPT_GLOW_SECRETS`, `SCRIPT_GLOW_FFMPEG`; for the voice server `VOICE_TOKEN`, `VOICE_ALLOWED_HOSTS`, `VOICE_UPLOADS`.
- Tests run on Windows, Linux and macOS on every push.

### Fixed

- A draft saved by an earlier version was replaced by the sample script; the script overlay forgot a size you chose.
- A sentence over 1,000 characters with no full stop lost every letter "s" before it was voiced.
- Saved audio and takes could not be played when Script Glow was installed under a folder whose name starts with a dot (such as `~/.local`).
- On Windows and macOS, a new voice whose name differed only in capital letters could replace an existing voice.
- With `SCRIPT_GLOW_CONFIG` set, Settings were saved to `data/connections.json` instead, and lost on restart.
- Claude Haiku 4.5 name guesses failed with "rejected the request".
- On Windows, saving could fail while another program briefly held the project file open.
- **Build up line by line** and its repeat count were not kept with the project.
- Safari: after the camera prompt, scene audio could stay silent until the page was reloaded.
- The camera or microphone could stay on after a failed start; a take whose camera was unplugged could freeze the take screen.
- **Make MP4** was offered in Safari, which cannot make it without FFmpeg.
- Turning the camera off during the count-in could still start a recording.
- Error messages no longer show local file paths.

### Security

- The voice server checks the host name of every request (blocks DNS rebinding), supports a token, and refuses to start on a network address without one.
- The app cannot be shown inside another page, and sends a Content Security Policy.
- A key pasted into a model field is refused instead of being saved in the shareable profile.
- The key folder is set to owner-only on macOS and Linux even when it already existed; a leftover key file from 0.1.0 is reported.

## 0.1.0 (2026-09-15)

First public release.

- Import plain text, Fountain, and text-based PDF scripts, with a live parse preview in the editor.
- Cast screen: a voice for every character, voice previews, script-based voice types, optional local AI suggestions.
- Full-cast and practice tracks for one scene or the whole script, with auto-follow line highlight, hide my lines, loop, speed, and WAV downloads.
- Project library with autosave, `.sgbackup` export and restore.
- Included Chatterbox voice server and free CC0 stock voices.
- In-app help.
