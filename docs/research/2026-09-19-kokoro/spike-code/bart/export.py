# THROWAWAY: export Misaki's Apache-2.0 BART G2P fallback (PeterReid/graphemes_to_phonemes_en_us/gb) to ONNX.
import torch, json, sys
from transformers import BartForConditionalGeneration
for v in ("us", "gb"):
    m = BartForConditionalGeneration.from_pretrained(f"PeterReid/graphemes_to_phonemes_en_{v}").eval()
    m.config.use_cache = False
    class Enc(torch.nn.Module):
        def __init__(s): super().__init__(); s.e = m.get_encoder()
        def forward(s, ids): return s.e(input_ids=ids).last_hidden_state
    class Dec(torch.nn.Module):
        def __init__(s): super().__init__(); s.m = m
        def forward(s, dec_ids, enc): 
            o = s.m.model.decoder(input_ids=dec_ids, encoder_hidden_states=enc, use_cache=False).last_hidden_state
            return s.m.lm_head(o) + s.m.final_logits_bias
    ids = torch.tensor([[1, 5, 6, 7, 2]]); d = torch.tensor([[1, 5]])
    enc = Enc()(ids)
    torch.onnx.export(Enc(), (ids,), f"enc_{v}.onnx", input_names=["ids"], output_names=["enc"], dynamic_axes={"ids": {1: "n"}, "enc": {1: "n"}}, opset_version=17, dynamo=False)
    torch.onnx.export(Dec(), (d, enc), f"dec_{v}.onnx", input_names=["dec_ids", "enc"], output_names=["logits"], dynamic_axes={"dec_ids": {1: "t"}, "enc": {1: "n"}, "logits": {1: "t"}}, opset_version=17, dynamo=False)
    # reference output for the JS port check
    g = m.generate(input_ids=torch.tensor([[1] + [m.config.grapheme_chars.index(c) if c in m.config.grapheme_chars else 3 for c in "Siobhan"] + [2]]))
    print(v, g.tolist(), m.config.max_position_embeddings)
    json.dump({"grapheme_chars": m.config.grapheme_chars, "phoneme_chars": m.config.phoneme_chars, "gen": m.generation_config.to_dict()}, open(f"cfg_{v}.json", "w"), ensure_ascii=False)
