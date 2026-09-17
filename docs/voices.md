# Stock voices and your own voice

Chatterbox copies the voice of a short reference recording. Script Glow ships no recordings, but two scripts install free ones into your voice server's `voices` folder.

## Install

Run these from the Script Glow folder. The folder is created by the voice server on its first start.

```sh
node scripts/install-stock-voices.mjs voice-server/voices       # 4 voices
node scripts/install-expanded-voices.mjs voice-server/voices    # 12 more, needs FFmpeg
```

The scripts:

- download from pinned revisions and check every file against a SHA-256 hash,
- never overwrite a file: a file with different bytes stops the script with an error,
- skip files that are already installed and correct.

The voice server lists new files at once; no restart is needed.

## The voices

| Set | Voices | Source | License |
| --- | --- | --- | --- |
| Stock | Mica, Amber, Granite, Ash, Slate, Quartz | [Kokoro Voices](https://github.com/n33kos/kokoro-voices/tree/bbf160ee12f887b872d4f7f18ec0c29ce186086c), synthetic voices | CC0 1.0 |
| Voice-Zero | Alan, Alana, David, Graeme, Ian, Kara, Linda, Rachael, Ruth, Sean | [Voice-Zero](https://github.com/OwenTyme/voice-zero/blob/490cfbee850a6d409076f477c766f567000a79b6/voices/README.md), from LibriVox recordings | CC0 as declared by the repository; LibriVox recordings are public domain in the USA |

Sources, reader credits, revisions and hashes are in [scripts/stock-voices.json](../scripts/stock-voices.json) and [scripts/expanded-voices.json](../scripts/expanded-voices.json). The previews in the app ([public/voice-previews](../public/voice-previews/README.md)) are Chatterbox output, not the reference recordings.

Accent and gender labels describe the reference. Chatterbox output can differ.

## Your own voice

Use **Settings > Your voice > Record my voice**. See [connections.md](connections.md#your-own-voice). Record only your own voice, or the voice of someone who agreed to it. Files in `voice-server/voices/` are ignored by git.

Every clip Chatterbox makes carries an inaudible Resemble AI watermark.
