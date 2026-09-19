import torch, json
from transformers import BartForConditionalGeneration
m = BartForConditionalGeneration.from_pretrained("PeterReid/graphemes_to_phonemes_en_us").eval()
g, p = m.config.grapheme_chars, m.config.phoneme_chars
for w in ["Siobhan", "Marcus", "Nguyen", "Elena", "Zorblax"]:
    ids = [1] + [g.index(c) if c in g else 3 for c in w] + [2]
    out = m.generate(input_ids=torch.tensor([ids]))[0].tolist()
    print(w, out, "".join(p[t] for t in out if t > 3))
