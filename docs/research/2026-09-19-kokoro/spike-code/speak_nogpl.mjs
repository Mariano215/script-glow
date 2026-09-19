// THROWAWAY: Kokoro with no kokoro-js import and no phonemizer. What kokoro-js generate_from_ids does, inline.
import fs from "node:fs";
import { env, StyleTextToSpeech2Model, AutoTokenizer, Tensor, RawAudio } from "@huggingface/transformers";
import { createG2P } from "./g2p.mjs";
env.allowRemoteModels = false;
env.localModelPath = new URL("./bundled/", import.meta.url).pathname;
const id = "onnx-community/Kokoro-82M-v1.0-ONNX";
let t = performance.now();
const g2p = await createG2P();
const g2pLoad = performance.now() - t;
const [model, tokenizer] = await Promise.all([StyleTextToSpeech2Model.from_pretrained(id, { dtype: "fp32", device: "cpu" }), AutoTokenizer.from_pretrained(id)]);
// Voice packs are 510x256 float32 style vectors (Apache-2.0, shipped in kokoro-js/voices); copied path, not imported.
const voice = new Float32Array(fs.readFileSync("node_modules/kokoro-js/voices/af_heart.bin").buffer.slice(0));
async function speak(text) {
  const ps = await g2p(text);
  const { input_ids } = tokenizer(ps, { truncation: true });
  const n = Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509) * 256;
  const { waveform } = await model({ input_ids, style: new Tensor("float32", voice.slice(n, n + 256), [1, 256]), speed: new Tensor("float32", [1], [1]) });
  return { ps, audio: new RawAudio(waveform.data, 24000) };
}
const lines = JSON.parse(fs.readFileSync("lines.json", "utf8"));
await speak("Warm up.");
let g = 0, tot = 0;
for (const l of lines) { let a = performance.now(); await g2p(l); g += performance.now() - a; a = performance.now(); await speak(l); tot += performance.now() - a; }
const { audio } = await speak("I told you I would come back, and here I am, exactly as I promised.");
audio.save("wav/standalone_nogpl_af_heart.wav");
console.log(`g2p cold load ${g2pLoad.toFixed(0)} ms; g2p ${(g / lines.length).toFixed(2)} ms/line; g2p+TTS ${(tot / lines.length / 1000).toFixed(2)} s/line; rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
