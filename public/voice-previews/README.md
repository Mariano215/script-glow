# Generated voice auditions

These WAVs contain only this locally generated comparison sentence:

> I thought you had already left. Wait! There is something you need to know.

They are Chatterbox outputs, not the original reference recordings. Personal
cloned-voice samples are not distributed in this folder. An installation may
provide its own ignored `data/voice-previews/actor-preview.wav`; see
`docs/connections.md`. Do not redistribute anyone's voice sample without permission.

Stock references are original synthetic voices from
[Kokoro Voices](https://github.com/n33kos/kokoro-voices/tree/bbf160ee12f887b872d4f7f18ec0c29ce186086c),
released under CC0-1.0. VoiceZero references are selected from the CC0-declared
[Voice-Zero voices directory](https://github.com/OwenTyme/voice-zero/blob/490cfbee850a6d409076f477c766f567000a79b6/voices/README.md).
Reference licensing does not imply the original reader endorses generated speech.
Source recording pages, reader credits, pinned revisions, and reference checksums
are recorded in `scripts/expanded-voices.json` and `scripts/stock-voices.json`.
LibriVox public-domain status is US-specific; rights in other countries may differ.

Accent labels describe the reference sources, some approximately; they do not
guarantee the generated accent. Tone labels for Voice-Zero are intentionally
unrated. WhisperX verifies words, not accent, identity, or acting quality.

Regenerate missing samples and verify every file with
`node verification/expanded-voice-auditions.mjs`. Existing previews are checked,
never overwritten. Verification reports go to `artifacts/expanded-voices/report.json`.
