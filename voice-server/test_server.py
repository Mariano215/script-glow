"""Self-check without a GPU: python test_server.py (uses a fake model)."""
import os
import tempfile
from pathlib import Path

voices = Path(tempfile.mkdtemp())
(voices / "Stock-Mica.wav").write_bytes(b"RIFF")
os.environ["VOICES_DIR"] = str(voices)
os.environ["VOICE_ALLOWED_HOSTS"] = "testserver"  # the host name the test client sends

import torch  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402


class FakeModel:
    sr = 24000

    def generate(self, text, audio_prompt_path=None, **_):
        FakeModel.prompts.append(audio_prompt_path)
        return torch.zeros(1, 240)


FakeModel.prompts = []
server._load_model = lambda: FakeModel()
client = TestClient(server.app)

assert server.HOST == "127.0.0.1", "binds to this computer only by default"
assert client.get("/v1/voices").json() == {"voices": ["default", "Stock-Mica"]}
for name in ["../secret", "a/b", "..", "x" * 101, ""]:
    assert client.post("/v1/tts", json={"text": "Hi.", "voice": name}).status_code in (400, 422), name
assert client.post("/v1/tts", json={"text": "Hi.", "voice": "Missing"}).status_code == 404
ok = client.post("/v1/tts", json={"text": "Hello there.", "voice": "Stock-Mica"})
assert ok.status_code == 200 and ok.content[:4] == b"RIFF"
assert FakeModel.prompts[-1] == str(voices / "Stock-Mica.wav")
assert client.post("/v1/tts", json={"text": "Hi.", "voice": "default"}).status_code == 200
assert FakeModel.prompts[-1] is None, "default uses the built-in voice when voices/default.wav is absent"

import io as _io  # noqa: E402
import wave as _wave  # noqa: E402


def clip(seconds, rate=24000):
    buf = _io.BytesIO()
    with _wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"\0\0" * int(seconds * rate))
    return buf.getvalue()


wav_type = {"Content-Type": "audio/wav"}
assert client.put("/v1/voices/MyVoice", content=clip(8), headers=wav_type).json() == {"voice": "MyVoice", "seconds": 8.0}
assert (voices / "MyVoice.wav").read_bytes() == clip(8)
assert "MyVoice" in client.get("/v1/voices").json()["voices"]
assert client.put("/v1/voices/MyVoice", content=clip(9), headers=wav_type).status_code == 409, "no silent overwrite"
assert client.put("/v1/voices/MyVoice?replace=true", content=clip(9), headers=wav_type).status_code == 200
assert (voices / ".MyVoice.previous.wav").read_bytes() == clip(8), "the replaced recording is kept"
assert client.get("/v1/voices").json()["voices"] == ["default", "MyVoice", "Stock-Mica"], "and is not listed as a voice"
assert client.put("/v1/voices/Short", content=clip(2), headers=wav_type).status_code == 400
assert client.put("/v1/voices/Long", content=clip(31), headers=wav_type).status_code == 400
assert client.put("/v1/voices/Junk", content=b"RIFFnot a wav", headers=wav_type).status_code == 400
assert client.put("/v1/voices/Typed", content=clip(8), headers={"Content-Type": "application/json"}).status_code == 415
assert client.put("/v1/voices/Big", content=b"\0" * (server.MAX_UPLOAD + 1), headers=wav_type).status_code == 413
for name in ["default", "..%2Fsecret", "a.b"]:
    assert client.put(f"/v1/voices/{name}", content=clip(8), headers=wav_type).status_code in (400, 404, 405), name
assert [p.name for p in voices.glob(".*")] == [".MyVoice.previous.wav"], "no temporary files left behind"
server.UPLOADS = False
assert client.put("/v1/voices/Other", content=clip(8), headers=wav_type).status_code == 403
server.UPLOADS = True
assert client.put("/v1/voices/stock-mica?replace=true", content=clip(8), headers=wav_type).status_code == 409, "case-only clash"
assert (voices / "Stock-Mica.wav").read_bytes() == b"RIFF", "the stock voice is untouched"

# A page whose domain points at 127.0.0.1 sends its own host name, and is refused.
assert TestClient(server.app, base_url="http://evil.example").get("/v1/voices").status_code == 400
assert TestClient(server.app, base_url="http://localhost:8095").get("/v1/voices").status_code == 200

# With a token, every route but /health needs it.
server.TOKEN = "t" * 32
assert client.get("/health").status_code == 200
assert client.get("/v1/voices").status_code == 401
assert client.get("/v1/voices", headers={"X-Voice-Token": "wrong"}).status_code == 401
assert client.get("/v1/voices", headers={"X-Voice-Token": "t" * 32}).status_code == 200
assert client.post("/v1/tts", json={"text": "Hi.", "voice": "default"}).status_code == 401
server.TOKEN = ""
print("PASS: voice-server")
