# Script Glow voice server

Script Glow needs a voice service to read the script aloud. This folder has a small one built on
[Chatterbox](https://github.com/resemble-ai/chatterbox) (MIT license, model weights MIT). It runs on
your own computer.

## What you need

- Python 3.12
- An NVIDIA graphics card is strongly recommended. It also works on the CPU, but much slower.
- Several GB of free disk space for PyTorch and the model. The model downloads the first time you make audio.

## Install and start

Windows (PowerShell), from the `voice-server` folder:

```powershell
python -m venv .venv
.venv\Scripts\pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python server.py
```

macOS or Linux:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

Skip the separate `torch` line if you have no NVIDIA card. The server listens on
`http://127.0.0.1:8095`, which is the Script Glow default, so no configuration is needed.
Leave this window open while you rehearse.

## Add voices

A voice is a short, clean recording (5 to 20 seconds of one person talking) saved as
`voices/<Name>.wav`. Script Glow lists every file in that folder.

Install the free stock voices, from the Script Glow folder:

```sh
mkdir voice-server/voices
node scripts/install-stock-voices.mjs voice-server/voices
```

`node scripts/install-expanded-voices.mjs voice-server/voices` adds ten more, and needs
[FFmpeg](https://ffmpeg.org) on your PATH.

**Your own voice:** save a recording of yourself as `voices/MyVoice.wav`, then set
`"preferredActorVoice": "MyVoice"` in Script Glow's `data/connections.json`. Only use recordings of
people who agreed to it. Files in `voices/` are ignored by git and never shared.

Every clip Chatterbox makes carries an inaudible Resemble AI watermark.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `VOICE_HOST` | `127.0.0.1` | Network address. The server has no login, so keep it local. |
| `VOICE_PORT` | `8095` | Port. Update `chatterbox.url` in Script Glow if you change it. |
| `VOICES_DIR` | `./voices` | Folder with the voice recordings. |

## Check it

```sh
.venv/bin/python test_server.py      # Windows: .venv\Scripts\python test_server.py
```

The check uses a fake model, so it needs no GPU and downloads nothing.
