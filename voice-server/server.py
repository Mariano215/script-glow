"""
Script Glow voice server: a small FastAPI wrapper around Chatterbox-Turbo.

API used by Script Glow:
  GET  /health      service status
  GET  /v1/voices   {"voices": ["default", <names of .wav files in voices/>]}
  POST /v1/tts      {"text": "...", "voice": "<name>"} -> WAV audio
  PUT  /v1/voices/<name>[?replace=true]  body: a PCM WAV, 5 to 30 seconds -> saved as voices/<name>.wav
  POST /v1/unload   free GPU memory now

A voice is a short reference recording, voices/<name>.wav. "default" uses
voices/default.wav when present, otherwise Chatterbox's built-in voice.
The model unloads after IDLE_TIMEOUT seconds without requests.

Environment: VOICE_HOST (127.0.0.1), VOICE_PORT (8095), VOICES_DIR (./voices),
VOICE_TOKEN (none), VOICE_ALLOWED_HOSTS (none), VOICE_UPLOADS (on for 127.0.0.1, off otherwise).

Only requests addressed to this computer's own name are answered, so a web page cannot reach the
server by pointing its own domain at 127.0.0.1. To serve other machines, set VOICE_HOST, list the
names they use in VOICE_ALLOWED_HOSTS, and set VOICE_TOKEN: every request except /health must then
send the same value in the X-Voice-Token header. The server refuses to start on a network address
without a token.
"""

import asyncio
import io
import os
import re
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import hmac

import torch
import torchaudio
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

HOST = os.environ.get("VOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("VOICE_PORT", "8095"))
VOICES_DIR = Path(os.environ.get("VOICES_DIR", Path(__file__).parent / "voices")).resolve()
IDLE_TIMEOUT = 300  # seconds before the model unloads from GPU memory
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
VOICE_NAME = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
LOOPBACK = HOST in ("127.0.0.1", "localhost", "::1")
TOKEN = os.environ.get("VOICE_TOKEN", "")
# New voices are accepted by default only while the server is private to this computer.
UPLOADS = os.environ.get("VOICE_UPLOADS", "on" if LOOPBACK else "off").lower() != "off"
ALLOWED_HOSTS = [h for h in ["127.0.0.1", "localhost", "[::1]", HOST, *os.environ.get("VOICE_ALLOWED_HOSTS", "").split(",")] if h.strip()]
MAX_UPLOAD = 10 * 1024 * 1024  # bytes; 30 seconds of 48 kHz stereo 16-bit is under 6 MB

_model = None
_last_used = 0.0
_lock = asyncio.Lock()
_unload_task: Optional[asyncio.Task] = None


def _load_model():
    global _model
    if _model is None:
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        _model = ChatterboxTurboTTS.from_pretrained(device=DEVICE)
    return _model


def _unload_model():
    global _model
    if _model is None:
        return
    _model = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


_CHUNK_LIMIT = 300  # characters; long single generations make Turbo loop or repeat


def _chunk_text(text: str, limit: int = _CHUNK_LIMIT) -> list[str]:
    """Split text into sentence-sized chunks no longer than `limit` characters."""
    parts: list[str] = []
    cur = ""
    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        if not sentence:
            continue
        if cur and len(cur) + len(sentence) + 1 > limit:
            parts.append(cur)
            cur = sentence
        else:
            cur = f"{cur} {sentence}".strip()
    if cur:
        parts.append(cur)
    return parts or [text.strip()]


def _generate_audio(model, text: str, voice_path: Optional[Path]):
    """Synthesize sentence chunks with a short pause between them."""
    prompt = str(voice_path) if voice_path else None
    gap = torch.zeros(1, int(model.sr * 0.15))
    pieces = []
    for i, chunk in enumerate(_chunk_text(text)):
        wav = model.generate(chunk, audio_prompt_path=prompt, repetition_penalty=1.4, temperature=0.7).detach().to("cpu")
        if wav.dim() == 1:
            wav = wav.unsqueeze(0)
        if i:
            pieces.append(gap)
        pieces.append(wav)
    return torch.cat(pieces, dim=-1)


def _voice_names() -> list[str]:
    return sorted(p.stem for p in VOICES_DIR.glob("*.wav") if VOICE_NAME.match(p.stem) and p.stem != "default")


async def _idle_watcher():
    while True:
        await asyncio.sleep(30)
        if _model is not None and time.time() - _last_used > IDLE_TIMEOUT:
            async with _lock:
                if _model is not None and time.time() - _last_used > IDLE_TIMEOUT:
                    _unload_model()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _unload_task
    _unload_task = asyncio.create_task(_idle_watcher())
    yield
    _unload_task.cancel()
    _unload_model()


app = FastAPI(title="Script Glow voice server", lifespan=lifespan)


@app.middleware("http")
async def require_token(request: Request, call_next):
    # compare_digest takes the same time for any wrong token, so the token cannot be guessed by timing.
    if TOKEN and request.url.path != "/health" and not hmac.compare_digest(request.headers.get("x-voice-token", "").encode(), TOKEN.encode()):
        return JSONResponse({"detail": "Wrong or missing voice token."}, status_code=401)
    return await call_next(request)


# Added last, so it runs first: a request for any other host name is refused before anything else.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=[h.strip() for h in ALLOWED_HOSTS])


class TTSRequest(BaseModel):
    text: str = Field(max_length=20000)
    voice: str = Field(default="default", description="Name of a .wav file in voices/, or default")


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _model is not None, "device": DEVICE}


@app.post("/v1/tts")
async def generate_tts(req: TTSRequest):
    global _last_used
    if not req.text.strip():
        raise HTTPException(400, "text must not be empty")
    # Voice names map to files, so allow only plain names (no paths).
    if not VOICE_NAME.match(req.voice):
        raise HTTPException(400, "Voice names may use letters, numbers, - and _ only.")
    if req.voice == "default":
        default = VOICES_DIR / "default.wav"
        voice_path = default if default.exists() else None
    elif req.voice in _voice_names():
        voice_path = VOICES_DIR / f"{req.voice}.wav"
    else:
        raise HTTPException(404, f"Voice '{req.voice}' not found.")

    async with _lock:
        model = await asyncio.to_thread(_load_model)
        _last_used = time.time()
        wav = await asyncio.to_thread(_generate_audio, model, req.text, voice_path)

    buf = io.BytesIO()
    torchaudio.save(buf, wav, model.sr, format="wav")
    return Response(content=buf.getvalue(), media_type="audio/wav")


@app.get("/v1/voices")
async def list_voices():
    return {"voices": ["default", *_voice_names()]}


@app.put("/v1/voices/{name}")
async def save_voice(name: str, request: Request, replace: bool = False):
    """Add a reference recording. An existing voice is only replaced when asked."""
    if not UPLOADS:
        raise HTTPException(403, "This voice server does not accept new voices (VOICE_UPLOADS=off).")
    if not VOICE_NAME.match(name) or name == "default":
        raise HTTPException(400, "Voice names may use letters, numbers, - and _ only, and cannot be default.")
    if request.headers.get("content-type", "").split(";")[0].strip().lower() not in ("audio/wav", "audio/x-wav", "audio/wave"):
        raise HTTPException(415, "Send the recording as audio/wav.")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_UPLOAD:
            raise HTTPException(413, "The recording is larger than 10 MB.")
    try:
        with wave.open(io.BytesIO(bytes(body))) as clip:
            seconds = clip.getnframes() / clip.getframerate()
    except (wave.Error, EOFError, ZeroDivisionError):
        raise HTTPException(400, "Send a PCM WAV recording.")
    if not 5 <= seconds <= 30:
        raise HTTPException(400, f"A voice needs 5 to 30 seconds of speech; this is {seconds:.1f} seconds.")
    target = VOICES_DIR / f"{name}.wav"
    # Windows and macOS ignore case in file names: "stock-mica" would overwrite Stock-Mica.wav.
    if any(v.lower() == name.lower() and v != name for v in _voice_names()):
        raise HTTPException(409, f"A voice with the name {name} in other capital letters already exists.")
    if target.exists() and not replace:
        raise HTTPException(409, f"A voice named {name} already exists.")
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    # Written whole or not at all, so a half-saved file is never used as a voice.
    temporary = VOICES_DIR / f".{name}.{os.getpid()}.upload"
    temporary.write_bytes(bytes(body))
    # The replaced recording is kept once, as a hidden file the voice list ignores.
    if target.exists():
        os.replace(target, VOICES_DIR / f".{name}.previous.wav")
    os.replace(temporary, target)
    return {"voice": name, "seconds": round(seconds, 1)}


@app.post("/v1/unload")
async def unload():
    async with _lock:
        _unload_model()
    return {"status": "unloaded"}


if __name__ == "__main__":
    if not LOOPBACK and len(TOKEN) < 20:
        raise SystemExit("VOICE_HOST is a network address. Set VOICE_TOKEN to a secret of 20 or more characters first, for example:\n"
                         '  python -c "import secrets; print(secrets.token_urlsafe(32))"')
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    uvicorn.run(app, host=HOST, port=PORT)
