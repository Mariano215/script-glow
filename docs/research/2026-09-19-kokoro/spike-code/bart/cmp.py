import torch, onnxruntime as ort, numpy as np
from transformers import BartForConditionalGeneration
m = BartForConditionalGeneration.from_pretrained("PeterReid/graphemes_to_phonemes_en_us").eval()
g = m.config.grapheme_chars
ids = [1] + [g.index(c) for c in "Marcus"] + [2]
dec = [1, 1, 17, 45, 29, 36, 15, 31, 20]
with torch.no_grad():
    t = m(input_ids=torch.tensor([ids]), decoder_input_ids=torch.tensor([dec])).logits[0].numpy()
e = ort.InferenceSession("enc_us.onnx").run(None, {"ids": np.array([ids])})[0]
o = ort.InferenceSession("dec_us.onnx").run(None, {"dec_ids": np.array([dec]), "enc": e})[0][0]
print("torch", t.argmax(-1)); print("onnx ", o.argmax(-1)); print(np.abs(t - o).max())
out=[1]
d = ort.InferenceSession("dec_us.onnx")
while len(out)<20:
    lo = d.run(None, {"dec_ids": np.array([out]), "enc": e})[0][0]
    with torch.no_grad(): tl = m(input_ids=torch.tensor([ids]), decoder_input_ids=torch.tensor([out])).logits[0].numpy()
    print(len(out), lo[-1].argmax(), tl[-1].argmax(), np.abs(lo-tl).max())
    nx = int(lo[-1].argmax())
    if nx==2: break
    out.append(nx)
