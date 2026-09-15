"""
Script Glow voice server: a small FastAPI wrapper around Chatterbox-Turbo.

API used by Script Glow:
  GET  /health      service status
  GET  /v1/voices   {"voices": ["default", <names of .wav files in voices/>]}
  POST /v1/tts      {"text": "...", "voice": "<name>"} -> WAV audio
  POST /v1/unload   free GPU memory now

A voice is a short reference recording, voices/<name>.wav. "default" uses
voices/default.wav when present, otherwise Chatterbox's built-in voice.
The model unloads after IDLE_TIMEOUT seconds without requests.

Environment: VOICE_HOST (127.0.0.1), VOICE_PORT (8095), VOICES_DIR (./voices).
There is no authentication. Keep the host on 127.0.0.1 unless the network is private.
"""

import asyncio
import io
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import torch
import torchaudio
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

HOST = os.environ.get("VOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("VOICE_PORT", "8095"))
VOICES_DIR = Path(os.environ.get("VOICES_DIR", Path(__file__).parent / "voices")).resolve()
IDLE_TIMEOUT = 300  # seconds before the model unloads from GPU memory
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
VOICE_NAME = re.compile(r"^[A-Za-z0-9_-]{1,100}$")

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


@app.post("/v1/unload")
async def unload():
    async with _lock:
        _unload_model()
    return {"status": "unloaded"}


if __name__ == "__main__":
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    uvicorn.run(app, host=HOST, port=PORT)
