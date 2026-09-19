// THROWAWAY: map CMUdict ARPAbet to Misaki symbols and measure agreement with us_gold (stress stripped).
import fs from "node:fs";
import { dictionary } from "cmu-pronouncing-dictionary";
const M = { AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "W", AY: "I", B: "b", CH: "ʧ", D: "d", DH: "ð", EH: "ɛ", ER: "ɜɹ", EY: "A", F: "f", G: "ɡ", HH: "h", IH: "ɪ", IY: "i", JH: "ʤ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", OW: "O", OY: "Y", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", UH: "ʊ", UW: "u", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ" };
export const cmuToMisaki = arpa => arpa.split(" ").map(p => { const b = p.replace(/\d/, ""), s = p.match(/\d/)?.[0];
  const v = b === "AH" && s === "0" ? "ə" : b === "ER" && s === "0" ? "əɹ" : M[b]; return (s === "1" ? "ˈ" : s === "2" ? "ˌ" : "") + v; }).join("");
const gold = JSON.parse(fs.readFileSync("data/us_gold.json", "utf8"));
const norm = s => s.replace(/[ˈˌ]/g, "").replace(/ɾ/g, "t").replace(/ᵊ/g, "ə").replace(/ᵻ/g, "ɪ");
let both = 0, same = 0, sameLoose = 0; const ex = [];
for (const [w, v] of Object.entries(gold)) { const c = dictionary[w]; if (typeof v !== "string" || !c) continue; both++;
  const a = norm(cmuToMisaki(c)), b = norm(v); if (a === b) same++; else if (a.replace(/[əʌɪ]/g, "ə") === b.replace(/[əʌɪ]/g, "ə")) sameLoose++; else if (ex.length < 8) ex.push(`${w}: cmu ${cmuToMisaki(c)} / misaki ${v}`); }
console.log(`CMUdict entries ${Object.keys(dictionary).length}; us_gold string entries also in CMUdict: ${both}; identical (stress, flap and small-schwa ignored): ${same} (${(100 * same / both).toFixed(1)}%); identical after merging reduced vowels: ${(100 * (same + sameLoose) / both).toFixed(1)}%`);
console.log(ex.join("\n"));
for (const w of ["marcus", "elena", "siobhan", "nguyen", "kavanagh"]) console.log(w, dictionary[w] ? cmuToMisaki(dictionary[w]) : "(not in CMUdict)");
