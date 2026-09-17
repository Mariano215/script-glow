# Script Glow voice server

Script Glow needs a voice service to read the script aloud. This folder has a small one built on
[Chatterbox](https://github.com/resemble-ai/chatterbox) (MIT license, model weights MIT). It runs on
your own computer.

## What you need

- Python 3.12
- An NVIDIA graphics card is strongly recommended. It also works on the CPU, but much slower. On a Mac it always runs on the CPU.
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

Skip the separate `torch` line if you have no NVIDIA card. On Linux, the plain `pip install` already includes the NVIDIA libraries (a large download). The server listens on
`http://127.0.0.1:8095`, which is the Script Glow default, so no configuration is needed.
Leave this window open while you rehearse.

## Add voices

A voice is a short, clean recording (5 to 20 seconds of one person talking) saved as
`voices/<Name>.wav`. Script Glow lists every file in that folder.

Start the server once so it creates the `voices` folder. Then install the free stock voices, from the Script Glow folder:

```sh
node scripts/install-stock-voices.mjs voice-server/voices
```

`node scripts/install-expanded-voices.mjs voice-server/voices` adds twelve more, and needs
[FFmpeg](https://ffmpeg.org) on your PATH.

**Your own voice:** in Script Glow, open **Settings** and press **Record my voice** (or choose a
file). Script Glow sends the recording here with `PUT /v1/voices/<name>` and uses it for your role.
Recording again keeps the one before as `voices/.<name>.previous.wav`.
By hand: save a recording of yourself as `voices/MyVoice.wav`, then type `MyVoice` under **Your own
voice** in Settings. Only use recordings of
people who agreed to it. Files in `voices/` are ignored by git and never shared.

Every clip Chatterbox makes carries an inaudible Resemble AI watermark.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `VOICE_HOST` | `127.0.0.1` | Network address to listen on. Anything other than `127.0.0.1`, `localhost` or `::1` needs `VOICE_TOKEN`. |
| `VOICE_TOKEN` | none | A shared secret of 20 or more characters. When set, every request except `/health` must send it in the `X-Voice-Token` header. |
| `VOICE_ALLOWED_HOSTS` | none | Extra host names or addresses that requests may be addressed to, separated by commas, for example `gpu-desktop,100.64.0.5`. |
| `VOICE_UPLOADS` | `on` for `127.0.0.1`, `off` otherwise | `off` refuses new voices sent by Script Glow; `on` accepts them. |
| `VOICE_PORT` | `8095` | Port. Update `chatterbox.url` in Script Glow if you change it. |
| `VOICES_DIR` | `./voices` | Folder with the voice recordings. |

## Use it from another computer

The server answers only requests addressed to the names it knows, so a web page cannot reach it by
pointing its own domain at `127.0.0.1`. To serve a laptop on your private network (for example
Tailscale), make a token and start the server with it:

```sh
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

```powershell
# Windows PowerShell
$env:VOICE_HOST = "0.0.0.0"; $env:VOICE_ALLOWED_HOSTS = "gpu-desktop,100.64.0.5"; $env:VOICE_TOKEN = "<the token>"
.venv\Scripts\python server.py
```

```sh
# macOS or Linux
VOICE_HOST=0.0.0.0 VOICE_ALLOWED_HOSTS=gpu-desktop,100.64.0.5 VOICE_TOKEN='<the token>' .venv/bin/python server.py
```

Use the name or address the laptop connects to in `VOICE_ALLOWED_HOSTS`. On the laptop, open
Script Glow **Settings**: set the Chatterbox server address under **Advanced**, and paste the token
under **Keys for paid services > Voice server token**. Add `VOICE_UPLOADS=on` if you want to record
your own voice from the laptop. Never open this port to the internet.

## Check it

```sh
.venv/bin/python test_server.py      # Windows: .venv\Scripts\python test_server.py
```

The check uses a fake model, so it needs no GPU and downloads nothing. It covers the host check, the token and uploads.
