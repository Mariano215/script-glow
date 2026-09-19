// THROWAWAY spike: GPL-free English G2P for Kokoro-82M. Not for the Script Glow repo.
// Misaki lexicons (Apache-2.0) + Misaki's BART fallback (Apache-2.0) exported to ONNX.
// A cut-down JS port of misaki/en.py: no spaCy, so no POS tags (homographs take DEFAULT).
import fs from "node:fs";
import * as ort from "onnxruntime-node";
import n2w from "number-to-words";

const here = new URL(".", import.meta.url).pathname;
const PUNCT = ";:,.!?—…\"“”()";
const VOWELS = new Set("AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ");
const stats = { lexicon: 0, fallback: 0, fallbackWords: [] };

// misaki Lexicon.grow_dictionary: add Capitalized / lowercase twins.
function grow(d) {
  const e = {};
  for (const [k, v] of Object.entries(d)) {
    if (k.length < 2) continue;
    const cap = k[0].toUpperCase() + k.slice(1);
    if (k === k.toLowerCase()) { if (k !== cap) e[cap] = v; }
    else if (k === k[0] + k.slice(1).toLowerCase()) e[k.toLowerCase()] = v;
  }
  return { ...e, ...d };
}
const load = f => grow(JSON.parse(fs.readFileSync(`${here}data/${f}.json`, "utf8")));

// BART fallback: greedy decode, no KV cache (words are short, 1-layer model).
async function loadBart(v) {
  const cfg = JSON.parse(fs.readFileSync(`${here}bart/cfg_${v}.json`, "utf8"));
  const [enc, dec] = await Promise.all(["enc", "dec"].map(n => ort.InferenceSession.create(`${here}bart/${n}_${v}.onnx`)));
  const g = [...cfg.grapheme_chars], p = [...cfg.phoneme_chars];
  return async word => {
    const ids = [1, ...[...word].map(c => { const i = g.indexOf(c); return i < 0 ? 3 : i; }), 2];
    const { enc: h } = await enc.run({ ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]) });
    const out = [1];
    while (out.length < 64) {
      const { logits } = await dec.run({ dec_ids: new ort.Tensor("int64", BigInt64Array.from(out, BigInt), [1, out.length]), enc: h });
      const V = logits.dims[2], last = logits.data.subarray((out.length - 1) * V, out.length * V);
      let best = 0; for (let i = 1; i < V; i++) if (last[i] > last[best]) best = i;
      if (best === 2) break;
      out.push(best);
    }
    return out.filter(t => t > 3).map(t => p[t]).join("");
  };
}

// Numbers, the same readings kokoro-js gives espeak (years in pairs, clock times).
function numberWords(t) {
  return t
    .replace(/\b([1-9]|1[0-2]):([0-5]\d)\b/g, (_, h, m) => m === "00" ? `${h} o'clock` : m < 10 ? `${h} oh ${+m}` : `${h} ${m}`)
    .replace(/\b(1[1-9]|20)(\d\d)(s?)\b/g, (_, a, b, s) => b === "00" ? `${a} hundred${s}` : +b < 10 ? `${a} oh ${+b}${s}` : `${a} ${b}${s}`)
    .replace(/(?<=\d),(?=\d{3})/g, "")
    .replace(/\d+(st|nd|rd|th)\b/g, m => n2w.toWordsOrdinal(parseInt(m)))
    .replace(/\d+/g, m => n2w.toWords(+m))
    .replace(/-/g, " ");
}

export async function createG2P({ british = false } = {}) {
  const v = british ? "gb" : "us";
  const gold = load(`${v}_gold`), silver = load(`${v}_silver`), bart = await loadBart(v);
  const pick = ps => (ps && typeof ps === "object") ? ps.DEFAULT : ps;
  const known = w => w in gold || w in silver;
  const look = w => pick(gold[w] ?? silver[w]);
  const _s = st => /[ptkfθ]$/.test(st) ? st + "s" : /[szʃʒʧʤ]$/.test(st) ? st + (british ? "ɪ" : "ᵻ") + "z" : st + "z";
  const _ed = st => /[pkfθʃsʧ]$/.test(st) ? st + "t" : /d$/.test(st) ? st + (british ? "ɪ" : "ᵻ") + "d" : !/t$/.test(st) ? st + "d" : st + (british ? "ɪ" : "ᵻ") + "d";
  const CLITIC = { "'ve": "v", "'ll": "l", "'d": "d", "'m": "m", "'re": "ɹ", "'s": null };

  function lexical(w) {
    if (known(w)) return look(w);
    const lw = w.toLowerCase();
    if (w !== lw && known(lw)) return look(lw);                   // ALL CAPS, Title Case
    const cw = lw[0].toUpperCase() + lw.slice(1);
    if (known(cw)) return look(cw);                                // MARCUS -> Marcus (proper noun entries)
    if (/[^s]s$/.test(lw) && lw.length > 2) {                      // stem -s / -es / -ies, as misaki stem_s
      const stems = [lw.slice(0, -1)];
      if (/[^i]es$/.test(lw) && lw.length > 4) stems.push(lw.slice(0, -2));
      if (/ies$/.test(lw) && lw.length > 4) stems.push(lw.slice(0, -3) + "y");
      for (const st of stems) if (known(st)) return _s(look(st));
    }
    if (/ed$/.test(lw) && lw.length > 4) for (const st of [lw.slice(0, -1), lw.slice(0, -2)]) if (known(st)) return _ed(look(st));
    if (/ing$/.test(lw) && lw.length > 4) for (const st of [lw.slice(0, -3), lw.slice(0, -3) + "e", lw.slice(0, -4)]) if (known(st)) return look(st) + "ɪŋ";
    const m = lw.match(/^(.+?)('ve|'ll|'d|'m|'re|'s)$/);             // I'd've, Marcus's
    if (m) { const head = lexical(m[1]); if (head) return m[2] === "'s" ? _s(head) : head + (/[bdfɡkpstvzθðʃʒʤʧ]$/.test(head) && /'(ve|ll)/.test(m[2]) ? "ə" : "") + CLITIC[m[2]]; }
    return null;
  }

  async function word(w, nextVowel) {
    const lw = w.toLowerCase();
    if (["the", "a", "i", "to", "an"].includes(lw)) stats.lexicon++;
    // misaki special cases (context: does the next word start with a vowel sound)
    if (lw === "the") return nextVowel ? "ði" : "ðə";
    if (lw === "a" && w !== "A") return "ɐ";
    if (w === "I") return "ˌI";
    if (lw === "to") return nextVowel ? "tʊ" : "tə";
    if (lw === "an") return "ɐn";
    let ps = lexical(w);
    if (ps == null && /^[A-Z]{2,4}$/.test(w) && (w.length < 4 || !/[AEIOUY]/.test(w))) {   // FBI, NYPD: spell it (misaki get_NNP stress)
      const letters = [...w].map(c => gold[c]);
      if (!letters.includes(undefined)) { const j = letters.join("").replace(/ˈ/g, "ˌ"), k = j.lastIndexOf("ˌ"); ps = j.slice(0, k) + "ˈ" + j.slice(k + 1); }
    }
    if (ps != null) { stats.lexicon++; return ps; }
    stats.fallback++; stats.fallbackWords.push(w);
    return bart(w[0] + w.slice(1).toLowerCase());                   // BART was trained on dictionary casing
  }

  return async function g2p(text) {
    text = numberWords(text.replace(/[‘’]/g, "'").replace(/\b(Mr|Mrs|Ms|Dr|St)\.(?= [A-Z])/g, "$1").replace(/\s+/g, " ").trim());
    const toks = text.match(/[A-Za-z]+(?:'[A-Za-z]+)*'?|[;:,.!?—…"“”()]+|\S/g) || [];
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (/^[A-Za-z]/.test(t)) {
        const next = toks.slice(i + 1).find(x => /^[A-Za-z]/.test(x));
        const nextPs = next ? lexical(next) : null;
        const nextVowel = nextPs ? VOWELS.has(nextPs.replace(/^[ˈˌ]/, "")[0]) : /^[aeiou]/i.test(next || "");
        out.push({ ps: await word(t.replace(/'$/, ""), nextVowel), punct: false });
      } else if ([...t].every(c => PUNCT.includes(c))) out.push({ ps: t.replace(/\.{3}/g, "…"), punct: true });
    }
    // Punctuation hugs the previous word; opening quote/paren hugs the next, like misaki output.
    let s = "";
    for (const [i, o] of out.entries()) {
      const prev = out[i - 1];
      const glue = !prev || (o.punct && !/^[(“]/.test(o.ps)) || (prev.punct && /[(“]$/.test(prev.ps));
      s += (glue ? "" : " ") + o.ps;
    }
    return s;
  };
}
export { stats };
