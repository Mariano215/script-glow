# Local voice catalog

Installed 2026-09-14 in the Chatterbox server's `voices` folder. Chatterbox's `GET /v1/voices` immediately listed all four additions. No service restart, GPU generation or changes to the existing references were needed for installation.

| Chatterbox ID | Synthetic reference | Duration | Suggested use |
| --- | --- | --- | --- |
| `Stock-Mica` | `af_mica` | 6.775 s | Bright female partner |
| `Stock-Granite` | `am_granite` | 8.975 s | Low, deliberate male partner |
| `Stock-Amber` | `af_amber` | 6.350 s | Warm female partner |
| `Stock-Ash` | `am_ash` | 7.575 s | Textured male partner |

These are 24 kHz mono, 16-bit PCM WAV samples, used as Chatterbox reference audio. They are not a new TTS engine or downloaded executable models. Chatterbox generates the actual dialogue; its delivery can differ from the sample's qualities.

## Generation verification

All four IDs generated real Chatterbox audio on 2026-09-14 using the same two-sentence audition. Outputs are in ignored `artifacts/voices/Stock-*.wav`, with measured durations in `artifacts/voices/report.json`. Local WhisperX recognized the audition words for all four (`artifacts/voices/transcriptions.json`). Mica was also used as the scene partner in the full/practice integration check. Valid non-silent audio and recognizable speech are verified; delivery and preferred casting still benefit from listening to the samples.

Recreate the auditions, after other GPU rendering finishes:

```powershell
node verification/voice-auditions.mjs
```

## Provenance

Source: [n33kos/kokoro-voices](https://github.com/n33kos/kokoro-voices/tree/bbf160ee12f887b872d4f7f18ec0c29ce186086c), pinned revision `bbf160ee12f887b872d4f7f18ec0c29ce186086c`. The publisher describes these as original synthetic constructions, unrelated to identifiable people or their recorded performances. The repository includes WAV previews and releases its voice files under [CC0 1.0 Universal](https://github.com/n33kos/kokoro-voices/blob/bbf160ee12f887b872d4f7f18ec0c29ce186086c/LICENSE). License and provenance are recorded as the publisher's statements. Kokoro itself has a separate Apache 2.0 license; no Kokoro model is installed by this project.

The exact source URLs follow `https://raw.githubusercontent.com/n33kos/kokoro-voices/bbf160ee12f887b872d4f7f18ec0c29ce186086c/samples/<reference>.wav`. Names, durations and SHA-256 hashes are recorded in [stock-voices.json](../scripts/stock-voices.json). Downloads preserve the source bytes; no transcoding is applied.

## Reinstall / verify

Requires Node 22+ and an existing Chatterbox voice directory:

```powershell
node scripts/install-stock-voices.mjs "<chatterbox-server>/voices"
```

For a different existing directory or service URL:

```powershell
node scripts/install-stock-voices.mjs "<chatterbox-server>/voices" "http://127.0.0.1:8095"
```

The installer pins source revision and hashes, verifies downloaded bytes, checks WAV signatures, and creates new files with exclusive writes. Re-running verifies and skips matching files. An existing file with different bytes causes an error; nothing is overwritten. The final request verifies all four IDs appear in the running service. A service verification failure leaves successfully installed references intact and returns a nonzero exit code.

## Your own voice

Set `casting.preferredActorVoice` in `data/connections.json` to your own cloned voice ID, and it is used for the character you play. Full-cast rendering includes that voice. Practice rendering silences that character's dialogue while preserving the scene timeline. Other characters keep their assigned voices.

Other voices on the original machine (including `British-Female` and `default`) were already installed. Their provenance was not researched here and they are not distributed with Script Glow. New stock samples come from the source above. The app queries the service's current catalog instead of assuming that every machine has these voices.
