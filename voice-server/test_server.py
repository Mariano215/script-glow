"""Self-check without a GPU: python test_server.py (uses a fake model)."""
import os
import tempfile
from pathlib import Path

voices = Path(tempfile.mkdtemp())
(voices / "Stock-Mica.wav").write_bytes(b"RIFF")
os.environ["VOICES_DIR"] = str(voices)

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
print("PASS: voice-server")
