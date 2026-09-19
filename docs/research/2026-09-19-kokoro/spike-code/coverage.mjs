// THROWAWAY: lexicon vs fallback share for the Script Glow SAMPLE (spoken dialogue only) and the 20 test lines.
import fs from "node:fs";
import { createG2P, stats } from "./g2p.mjs";
const g = await createG2P();
const reset = () => { stats.lexicon = 0; stats.fallback = 0; stats.fallbackWords = []; };
const report = name => { const t = stats.lexicon + stats.fallback; console.log(`${name}: ${t} words, lexicon ${stats.lexicon} (${(100 * stats.lexicon / t).toFixed(1)}%), fallback ${stats.fallback}:`, stats.fallbackWords.join(", ")); };
// Everything in the sample, headings and names included (worst case: every line spoken).
const all = fs.readFileSync("sample_script.txt", "utf8");
reset(); for (const l of all.split("\n")) if (l.trim()) await g(l); report("SAMPLE, every line");
// Dialogue only: lines after a character cue, parentheticals dropped (what Script Glow speaks).
const L = all.split("\n"); const dialog = [];
for (let i = 1; i < L.length; i++) if (/^[A-Z]+$/.test(L[i - 1].trim()) || (dialog.length && L[i - 1].startsWith("("))) if (L[i].trim() && !L[i].startsWith("(")) dialog.push(L[i]);
reset(); for (const l of dialog) await g(l); report(`SAMPLE, ${dialog.length} dialogue lines`);
reset(); for (const l of JSON.parse(fs.readFileSync("lines.json", "utf8"))) await g(l); report("20 test lines");
