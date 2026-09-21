# Changelog

## Unreleased

- **Any voice for any character.** The voice list no longer blocks voices another character already uses, so a cast larger than the voice list can still be set by hand. Your own voice stays with your chosen role. When no unused voice of the right type is left, automatic casting shares one of that type instead of switching to an unlabeled voice.

- **Run several scenes as one.** Click a scene, then Shift-click another to pick every scene between them. Cmd-click (Ctrl on Windows and Linux) adds or removes one scene. The picked scenes play in script order, and **Make audio** makes one track for all of them.
- **Download as MP3.** With FFmpeg installed, a **WAV** or **MP3** choice sits next to the download links. The choice is kept in this browser.

## 0.5.0 (2026-09-20)

- **Check what I said.** With listening on, each of your lines is marked in the script as **Said**, **Half said** or **Not this line**, so you can see where you dried or jumped a line. It needs a WhisperX server address under Settings, Advanced. Your line goes there after the scene has already carried on, so the rehearsal is never held up waiting for it. Off until you switch it on, marks last only for the run, and nothing is scored or saved.
- **The Linux download is less than half the size.** The AppImage for Intel and AMD machines was 398 MB and is now 172 MB, the same size as the ARM one. It was carrying 343 MB of NVIDIA graphics-card libraries that Script Glow never uses: a piece of the voice engine fetched them on its own while the release was built. The app itself is unchanged, there is simply far less to download. The ARM AppImage was never affected.
- Building from source no longer lets a package run its own setup program unasked. Every one in the project is named and refused in `package.json`, and the install now stops instead of carrying on if a new one appears.
- **The welcome screen has a recommended choice again.** The built-in voices are held back until a licensing question about their word lists is settled, and with them hidden the welcome screen offered three choices that each need a graphics card, an API key or a terminal. **Use a paid voice service** is now marked as the one to pick, and says that the service charges for the audio it makes. The welcome screen also has an **i** button into the guide, which every other screen already had.
- **Make the audio** moved above the practice controls, where it belongs: none of them do anything until the audio exists. The card is named for what it does rather than for one slider inside it.
- **First letters of hidden lines** appears with **Hide my lines** and **Listen only**, the switches it depends on, instead of sitting on its own doing nothing.
- **How long I can pause** is a small dropdown instead of a second slider. It sat one screen away from **Pause between lines** with the same two end labels, meaning something different.
- Easier to use without a mouse or without sight: the **Hide my lines** and **Listen only** switches keep their names at phone width and are a proper size for a thumb, **A** and **B** say which end of the exchange they mark, and "Waiting for you" is announced when practice mode stops on your line.
- The guide no longer sends you to a **Built-in voices** card that is not in this version, names the free voices before the paid ones, and says plainly that **Continue when I stop speaking** listens through the microphone on this computer and needs no server.
- The README was a version behind: it said the Windows installer was unsigned, offered no Linux download, and never mentioned that listening opens the microphone.

## 0.4.1 (2026-09-20)

- **The Windows installer is signed.** Windows no longer shows the blue SmartScreen warning that told people the app was from an unknown publisher and asked them to choose **More info**, then **Run anyway**. The installer is signed as **Mariano Mattei** through Azure Artifact Signing. Nothing else changed in this release.

## 0.4.0 (2026-09-20)

- **Continue when I stop speaking.** With **Wait for me on my line** on, Script Glow listens through your microphone and carries on once you stop, so a scene runs with no hand on the keyboard. **How long I can pause** sets how long a silence has to be, from half a second to five seconds. Space and **Continue** still work. Only the loudness of the room is read: nothing is recorded, saved or sent.
- **Script Glow runs on Linux.** Every release now carries an AppImage for Intel and AMD machines and another for ARM ones, alongside the Mac and Windows files. One file, no package manager, any distribution. AppImages are not signed: run `chmod +x` on it before you start it.
- **Help opens where you are.** A small **i** button sits beside each screen heading and beside every voice service in Settings. It opens the user guide at that section instead of at the top.
- **Step by step setup for every voice service.** New guide sections for the built-in voices, Chatterbox, ElevenLabs, OpenAI, Google Gemini and Ollama, written for someone who has never made an API key, plus a plain explanation of what a key is. Each links straight to the page where the key is made.
- **Ask for help without knowing the jargon.** The guide now has an **Ask for help on GitHub** button that opens an issue with your version and browser already filled in, so you only have to say what happened.
- Mac updates download as a small patch again instead of the whole app. The name of the update file did not match the name of the patch file beside it, so every update quietly fell back to a full download of 168 to 190 MB.

## 0.3.0 (2026-09-20)

- **Built-in voices.** Kokoro-82M runs on this computer's CPU inside Script Glow: no voice server, no GPU, no key, no cost. Choose **Free voices on this computer** on the welcome screen, or **Built-in voices** in Settings. The voice files (about 360 MB) download once, resume after an interruption, and are checked before use. 28 English voices, US and UK. Hidden until the Misaki word-list provenance question is settled (hexgrad/misaki#107); set `SCRIPT_GLOW_EXPERIMENTAL_KOKORO=1` to turn them on before then.
- **Say it like** on each character card: type how a name sounds, for example `shi-VAWN`, and every voice engine says it that way.
- Run `npm install` again: `@huggingface/transformers`, `onnxruntime-node` and `number-to-words` are new. `sharp` is replaced by an empty stub, so no LGPL image library is installed.
- The license of every component that ships or is downloaded is in `THIRD_PARTY_NOTICES.md`.

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
