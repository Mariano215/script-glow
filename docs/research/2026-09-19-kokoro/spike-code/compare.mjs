// THROWAWAY: espeak path (kokoro-js generate) vs GPL-free path (g2p.mjs + generate_from_ids), same model and voice.
import fs from "node:fs";
import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import { createG2P, stats } from "./g2p.mjs";
env.allowRemoteModels = false;
env.localModelPath = new URL("./bundled/", import.meta.url).pathname;
const lines = JSON.parse(fs.readFileSync("lines.json", "utf8"));
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
const tok = tts.tokenizer; let lastEspeak = "";
tts.tokenizer = (s, o) => { lastEspeak = s; return tok(s, o); };
const g2p = await createG2P();
const WAV = new Set([0, 2, 3, 4, 6]); // I'd've, 1987, 3:15, Siobhan, MARCUS!
fs.mkdirSync("wav", { recursive: true });
const rows = []; let g2pMs = 0;
for (const [i, line] of lines.entries()) {
  const a = await tts.generate(line, { voice: "af_heart" });
  const t = performance.now(); const ours = await g2p(line); g2pMs += performance.now() - t;
  const b = await tts.generate_from_ids(tok(ours, { truncation: true }).input_ids, { voice: "af_heart" });
  rows.push({ i: i + 1, line, espeak: lastEspeak, ours });
  if (WAV.has(i)) { const n = String(i + 1).padStart(2, "0"); a.save(`wav/line${n}_espeak.wav`); b.save(`wav/line${n}_misaki_nogpl.wav`); }
  console.log(`${i + 1}. ${line}\n   espeak: ${lastEspeak}\n   ours:   ${ours}`);
}
fs.writeFileSync("compare.json", JSON.stringify(rows, null, 1));
console.log(`g2p avg ${(g2pMs / lines.length).toFixed(1)} ms/line (warm, includes BART fallback)`, stats);
