# Exports Misaki's BART fallback G2P (PeterReid/graphemes_to_phonemes_en_us and _gb, Apache-2.0) to
# ONNX for server/kokoro/g2p.js. Run once when preparing the built-in voice files; never at runtime.
#   uv run --no-project --managed-python --python 3.12 --with "torch==2.6.0" --with "transformers>=4.46,<5" --with onnx --with huggingface_hub \
#     python scripts/kokoro-bart-export.py <dir>/g2p
# Writes bart_enc_<us|gb>.onnx, bart_dec_<us|gb>.onnx and bart_<us|gb>.json (letters, phonemes, source).
import json
import sys

import torch
from huggingface_hub import HfApi
from transformers import BartForConditionalGeneration

out = sys.argv[1]
for accent in ("us", "gb"):
    name = f"PeterReid/graphemes_to_phonemes_en_{accent}"
    revision = HfApi().model_info(name).sha
    model = BartForConditionalGeneration.from_pretrained(name, revision=revision).eval()
    model.config.use_cache = False

    class Encoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = model.get_encoder()

        def forward(self, ids):
            return self.encoder(input_ids=ids).last_hidden_state

    class Decoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.model = model

        def forward(self, dec_ids, enc):
            hidden = self.model.model.decoder(input_ids=dec_ids, encoder_hidden_states=enc, use_cache=False).last_hidden_state
            return self.model.lm_head(hidden) + self.model.final_logits_bias

    ids = torch.tensor([[1, 5, 6, 7, 2]])
    dec = torch.tensor([[1, 5]])
    enc = Encoder()(ids)
    torch.onnx.export(Encoder(), (ids,), f"{out}/bart_enc_{accent}.onnx", input_names=["ids"], output_names=["enc"],
                      dynamic_axes={"ids": {1: "n"}, "enc": {1: "n"}}, opset_version=17, dynamo=False)
    torch.onnx.export(Decoder(), (dec, enc), f"{out}/bart_dec_{accent}.onnx", input_names=["dec_ids", "enc"], output_names=["logits"],
                      dynamic_axes={"dec_ids": {1: "t"}, "enc": {1: "n"}, "logits": {1: "t"}}, opset_version=17, dynamo=False)
    with open(f"{out}/bart_{accent}.json", "w", encoding="utf-8") as config:
        json.dump({"source": {"repo": name, "revision": revision}, "grapheme_chars": model.config.grapheme_chars,
                   "phoneme_chars": model.config.phoneme_chars}, config, ensure_ascii=False)
    print(f"{accent}: exported {name} at {revision}")
