# GPL-free G2P for Kokoro: findings (THROWAWAY SPIKE)

Throwaway feasibility spike, 2026-09-19. Nothing here goes into the Script Glow repo as is.
Folder: `/private/tmp/claude-501/-Volumes-T7-Projects-script-glow/248beb55-98f2-4006-8ae5-a97ff955ae71/scratchpad/phonemizer-spike`

## Verdict

**Feasible with conditions.** Kokoro runs end to end with no `phonemizer` and no espeak-ng code loaded, using Misaki's own English lexicons (Apache-2.0) plus Misaki's small neural fallback model (Apache-2.0, exported to ONNX here). On ordinary dialogue this matches espeak. The conditions:

1. **Lexicon provenance.** The Misaki `us_*`/`gb_*` JSON files ship inside an Apache-2.0 repo but no document says where the pronunciations came from. Get confirmation from hexgrad (open an issue) before shipping, or build the lexicon from CMUdict (BSD-2-Clause) instead. The mapping from CMUdict to Misaki symbols is written and tested here (`cmu_vs_misaki.mjs`).
2. **Names are the weak spot.** Words missing from the lexicon go to the neural fallback, and it misreads uncommon names (Siobhan, Nguyen, Elena). espeak also gets some names wrong, but it did better on 3 of the 4 names in this test set. Script Glow needs a per-script "say it like this" override for character names. That is also a feature actors would want anyway.
3. **Drop kokoro-js, or alias its `phonemizer` dependency.** `kokoro-js` statically imports `phonemizer`, so importing kokoro-js loads espeak-ng. Both ways around it work (section 1).
4. **Also stub `sharp`.** `@huggingface/transformers` statically imports `sharp`, whose prebuilt `@img/sharp-libvips-*` binary is LGPL-3.0-or-later. That is not GPL, but it is copyleft and TTS never uses it. An npm `overrides` stub removes it, tested in section 1.

## 1. How kokoro-js turns text into model input

Source: `node_modules/kokoro-js/dist/kokoro.js` (v1.2.1, minified; names below are the minified ones).

- Line 1 to 2: `import{StyleTextToSpeech2Model as e,AutoTokenizer as a,Tensor as t,RawAudio as r,env as n}from"@huggingface/transformers"` then `import{phonemize as l}from"phonemizer"`. **Static top-level import.** Importing kokoro-js always loads `phonemizer` (1.3 MB JS with espeak-ng compiled to WASM, the GPL part).
- `async function m(e,a="a",t=!0)` is the text-to-phonemes step. It normalizes text (quotes, `Mr.`, years to pairs, `h:mm` times, currency), splits on punctuation, calls `l(text, "en-us" | "en")` (espeak) on each chunk, then patches the output (`r` to `ɹ`, `x` to `k`, `ʲ` to `j`, and so on).
- `KokoroTTS.generate(text,{voice,speed})`: `n = await m(e, r)` then `{input_ids} = this.tokenizer(n,{truncation:!0})` then `this.generate_from_ids(l,{voice,speed})`.
- `generate_from_ids(input_ids,{voice,speed})`: slices the 256-float style vector for the current length out of `voices/<voice>.bin` (`256*min(max(len-2,0),509)`), then calls `this.model({input_ids, style, speed})` and wraps `waveform` in `RawAudio(...,24000)`. **This takes phonemes directly: no text, no phonemizer.**

**Phoneme alphabet.** The tokenizer (`tokenizer.json`) has 115 symbols and a normalizer that deletes anything else:
`$;:,.!?` U+2014 `…"()“”` plus IPA letters, the stress marks `ˈ ˌ`, length `ː`, and the Misaki capitals `A I O Q S T W Y` plus `ᵊ ᵻ ʤ ʧ ɾ`. Kokoro v1.0 was trained on Misaki notation (`misaki/EN_PHONES.md`): `A`=eɪ, `I`=aɪ, `O`=oʊ (US), `Q`=əʊ (GB), `W`=aʊ, `Y`=ɔɪ, `ᵊ` small schwa, `ᵻ` between ə and ɪ, `ɾ` flap. espeak IPA is also accepted because the IPA letters are in the vocabulary, so kokoro-js feeds it IPA like `oʊ`. **Misaki output is Kokoro's native input.**

**Two working ways to skip `phonemizer`, both tested:**

- **A. No kokoro-js** (`speak_nogpl.mjs`, recommended). About 10 lines replace it: `StyleTextToSpeech2Model.from_pretrained` + `AutoTokenizer.from_pretrained` from transformers.js, read the voice `.bin` as a `Float32Array`, then run the same slice-and-call as `generate_from_ids`. A module-resolution hook (`watch.mjs`, `node --import ./watch.mjs speak_nogpl.mjs`) logged **zero** loads of `node_modules/phonemizer`, `espeak*` or `kokoro-js`. The control run (`import("kokoro-js")` alone) logged `kokoro-js/dist/kokoro.js` and `phonemizer/dist/phonemizer.js`.
- **B. Keep kokoro-js, alias the module** (`override-demo/`). `package.json` gets `"overrides": { "phonemizer": "file:./stub-phonemizer" }`. The stub exports `async function phonemize(text, lang)` that returns `[await g2p(text)]`, the same export shape. `npm i` links `node_modules/phonemizer -> ../stub-phonemizer`, and kokoro-js then works unchanged, US and GB (`wav/override_demo_bf_emma.wav`). Downsides: kokoro-js still runs its espeak-specific normalizer and patch regexes, and it splits text at punctuation before calling us, which loses a little context.
- The same overrides trick with `"sharp": "file:./stub-sharp"` removes `sharp` and its LGPL libvips binary (`node_modules/@img` came out empty) and TTS still ran.

Note: kokoro-js's `stream()` given a plain string never finished in this test (the splitter is never closed). `generate()` is fine. It does not matter for path A.

## 2. Candidate G2P options

| Option | Code license (quoted) | Data or weights license | Size | Runs in Node without Python or GPL? | Verdict |
|---|---|---|---|---|---|
| **Misaki lexicons** `us_gold/us_silver/gb_gold/gb_silver.json` (hexgrad/misaki) | Repo LICENSE: "Apache License Version 2.0, January 2004". README badge "Apache-2.0 license". | Same file tree, no separate data notice. **Provenance not documented** (README, EN_PHONES.md and web search say nothing about the source). | 11.6 MB raw JSON for all four, 2.9 MB gzipped | Yes, plain JSON. Misaki itself is Python (spaCy, num2words, torch), so the logic is ported here as about 150 lines of JS (`g2p.mjs`) | **Chosen** (condition 1) |
| **Misaki BART fallback** `PeterReid/graphemes_to_phonemes_en_us` / `_gb` | HF card: `license: apache-2.0` | Trained on the Misaki gold and silver lexicons (its `english_to_phonemes.py`: "This is designed to load the datasets from `misaki`.") | 3.0 MB safetensors, 3.1 MB ONNX per accent (1-layer BART, d_model 128) | Yes, after a one-time ONNX export (`bart/export.py`), run with onnxruntime-node, which ships anyway | **Chosen** as the fallback for unknown words |
| **CMUdict** (cmusphinx/cmudict) | LICENSE: "Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved. Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 1. Redistributions of source code must retain the above copyright notice..." (BSD-2-Clause style) | Same | 135,155 entries, 4.7 MB as the npm `cmu-pronouncing-dictionary` (ISC wrapper) | Yes | **Backup lexicon.** ARPAbet to Misaki mapping written: 86.1% of the 32,768 words in both agree with Misaki gold (75.3% strictly), once reduced vowels are merged. Has more names than Misaki, but its name readings are poor too (siobhan `ʃˈWbˌɑn`, elena `ˈɛlənɑ`) |
| **phonemize** npm (hans00) v2.0.1 | `license: 'MIT'`; README: "Pure rule-based processing, no ML overhead" | Dictionary built from open-dict-data/ipa-dict `en_US`, which states: "All material in this repository released under the MIT license unless otherwise specified", and whose en_US is "based on a modified version of cmudict-ipa". Deps `number-to-words` (MIT), `pinyin-pro`. No espeak. | 2.9 MB | Yes. Its ESM build fails on Node 26 (`ERR_IMPORT_ATTRIBUTE_MISSING`, a JSON import without `with {type:"json"}`), the CJS build works | Usable, but outputs generic IPA, not Misaki notation. Name quality was similar to BART's (table below). Not chosen |
| **OpenPhonemizer** (NeuralVox) | "You may use it under the BSD-3-Clause Clear license" | Weights `openphonemizer/ckpt`: `bsd-3-clause-clear`. But the likely training set `mrfakename/ipa-phonemes-word-pairs` is `cc-by-sa-4.0` and "generated using: phonemizer/espeak". Its README: "Model weights may be licensed under different licenses." | not checked | Needs PyTorch export | **Rejected**: trained on espeak output under a ShareAlike license. Murky |
| **DeepPhonemizer** (spring-media) | "MIT license" | Pretrained `en_us_cmudict_*` models trained on CMUdict. No explicit license on the weight files | not checked (PyTorch .pt) | Needs export | Possible but unnecessary: Misaki's BART fills the same role, smaller, in Kokoro's notation |
| `phonemizer` npm (what kokoro-js uses) | package.json says `"Apache-2.0"` | README: "Simple text to phones converter using eSpeak NG." espeak-ng README: "eSpeak NG Text-to-Speech is released under the GPL version 3 or later license." | 2.6 MB | Yes, but embeds GPL | The thing being removed. **Its npm metadata says Apache-2.0 but it bundles GPL code**, so a license scanner will not catch it |
| `espeak-ng` npm | `license = 'GPL-3.0-or-later'` | | 18.7 MB | | Excluded |
| Other ports | Misaki has Dart (misakid), Swift (MisakiSwift) and Rust (misaki-rs) ports. No maintained JS or npm port was found | | | | Not needed: the JS core is small |

Fallback head-to-head on out-of-lexicon names (`fallbacks.mjs`):

| Word | Misaki BART (chosen) | phonemize (MIT) |
|---|---|---|
| Siobhan | sˈObhˌɑn | ˈʃaʊˌbɑn |
| Nguyen | əŋɡˈIən | nuˈjɛn |
| Elena | ˈilənə | ˈɛɫənɑ |
| Kavanagh | kˈɑvənˌɑ | ˈkævəˌnɔ |
| Priya | pɹˈijə | ˈpɹɪjæ |
| Xiomara | ʃˌiOmˈɑɹə | ˈzɪoʊmɝə |
| Imogen | ˈɪməʤən | ˈɪməɡən |
| Dmitri | dəmˈitɹi | ˈdmɪtɹi |
| Beauchamp | bˈOʧæmp | ˈboʊˌʃɑmp |

Neither fallback is good at names. BART was right more often, and it already speaks Kokoro's notation.

## 3. What was built (`g2p.mjs`, about 150 lines)

A cut-down JS port of `misaki/en.py`:

- **Normalize:** curly quotes; `Mr./Mrs./Ms./Dr./St.` lose the period; `h:mm` becomes "3 fifteen" or "3 o'clock" and 4-digit years become pairs ("19 87"), the same readings kokoro-js gives espeak; other numbers via `number-to-words` (MIT); `...` becomes `…`.
- **Tokenize** into words (apostrophes kept) and Kokoro punctuation `; : , . ! ?` U+2014 `… " “ ” ( )`. Punctuation attaches to the previous word, as in Misaki output. `(beat)` becomes `(bˈit)`. Kokoro's vocabulary has parentheses, whereas kokoro-js turns them into `«»` and the tokenizer then deletes them.
- **Lexicon lookup** (US or GB): gold, then silver; Misaki's `grow_dictionary` capitalization twins; ALL CAPS and Title Case fall back to lowercase; Misaki's `-s/-es/-ies`, `-ed`, `-ing` stemming rules with the `ᵻz`, `t/d/ᵻd` and `ɾɪŋ` suffix phonology; clitics `'ve 'll 'd 'm 're 's` for forms like `I'd've` (`ˌIdəv`); 2 to 4 letter all-caps words not in the lexicon are spelled out with Misaki's `get_NNP` stress (`FBI` becomes `ˌɛfbˌiˈI`).
- **Misaki special cases:** `the` is ðə or ði before a vowel, `a` is ɐ, `I` is ˌI, `to` is tə or tʊ, `an` is ɐn.
- **Stress:** comes from the lexicon unchanged (primary `ˈ` and secondary `ˌ` placed before the vowel, as Kokoro expects).
- **Fallback:** Misaki BART via onnxruntime-node, greedy decode without a KV cache. The JS output was checked token for token against the PyTorch `generate()` for Siobhan, and the ONNX logits match PyTorch to 1.5e-5.
- **Not ported:** spaCy POS tagging, so homographs take the `DEFAULT` entry (`read` is always ɹˈid, `live` always lˈIv). espeak made the same mistake on line 14. Also not ported: currency and decimals (kokoro-js handles these; number-to-words covers integers only).

First bug found and fixed on the way: stripping `-s` from any word turned `Marcus` into `Marc`+s (`mˈɑɹks`). The fix restricts stems the way Misaki does (`-es` only when not `-ies`, and so on).

Export failure recorded: the Anaconda Python failed with `ImportError: numpy.core.multiarray failed to import` (a scipy/numpy mismatch). The alternative that worked was a clean `uv venv` with torch, transformers and onnx (`bart/.venv`).

## 4. Twenty actor lines: espeak path vs GPL-free path

Same model (fp32), same voice (af_heart), same tokenizer. The only change is the G2P step (`compare.mjs`, full output in `compare.txt` and `compare.json`). Most rows differ only in notation: espeak writes `oʊ eɪ aɪ ɚ ː` where Misaki writes `O A I əɹ` and drops length marks. The model reads both as the same sounds.

| # | Line | espeak-ng path (kokoro-js) | GPL-free path (ours) | Difference |
|---|---|---|---|---|
| 1 | I'd've told you, if you'd asked. | `aɪdəv tˈoʊld juː, ɪf juːd ˈæskt.` | `ˌIdəv tˈOld ju, ɪf jud ˈæskt.` | espeak aɪdəv vs ours ˌIdəv: same sounds, Misaki diphthong symbols |
| 2 | Y'all can't be serious right now. | `jˈɔːl kˈænt biː sˈɪɹiəs ɹˈaɪt nˈaʊ.` | `jˈɔl kˈænt bi sˈɪɹiəs ɹˈIt nˈW.` | Notation only (ː length marks, oʊ vs O, eɪ vs A, ɚ vs əɹ). Same speech. |
| 3 | It was the summer of 1987. | `ɪt wʌzðə sˈʌmɚɹ ʌv nˈaɪntiːn ˈeɪɾi sˈɛvən.` | `ɪt wʌz ðə sˈʌməɹ ʌv nˌIntˈin ˈAɾi sˈɛvən.` | stress placement on 'nineteen' only |
| 4 | Meet me at 3:15, not a minute later. | `mˈiːt mˌiː æt θɹˈiː fˈɪftiːn, nˌɑːɾə mˈɪnɪt lˈeɪɾɚ.` | `mˈit mˌi æt θɹˈi fˌɪftˈin, nˌɑt ɐ mˈɪnət lˈAɾəɹ.` | espeak links 'not a' (nɑːɾə), ours nˌɑt ɐ; minute ɪ vs ə |
| 5 | Siobhan, please, just listen to me. | `ʃɪvˈɔːn, plˈiːz, dʒˈʌst lˈɪsən tə mˌiː.` | `sˈObhˌɑn, plˈiz, ʤˈʌst lˈɪsᵊn tə mˌi.` | **Audible.** Siobhan: ours sˈObhˌɑn (wrong), espeak ʃɪvˈɔːn (right) |
| 6 | Mr. Nguyen is waiting downstairs. | `mˈɪstɚ nˈuːjɛn ɪz wˈeɪɾɪŋ dˈaʊnstɛɹz.` | `mˈɪstəɹ əŋɡˈIən ɪz wˈAɾɪŋ dˌWnstˈɛɹz.` | **Audible.** Nguyen: ours əŋɡˈIən, espeak nˈuːjɛn (neither is the usual 'win', espeak closer) |
| 7 | MARCUS! Get back here! | `mˈɑːɹkəs! ɡɛt bˈæk hˈɪɹ!` | `mˈɑɹkəs! ɡɛt bˈæk hˈɪɹ!` | Notation only (ː length marks, oʊ vs O, eɪ vs A, ɚ vs əɹ). Same speech. |
| 8 | (beat) Fine. Have it your way. | `«bˈiːt» fˈaɪn. hæv ɪt jʊɹ wˈeɪ.` | `(bˈit) fˈIn. hæv ɪt jʊɹ wˈA.` | Notation only (ː length marks, oʊ vs O, eɪ vs A, ɚ vs əɹ). Same speech. |
| 9 | Beat. Then she turns away. | `bˈiːt. ðˈɛn ʃiː tˈɜːnz ɐwˈeɪ.` | `bˈit. ðˈɛn ʃi tˈɜɹnz əwˈA.` | Notation only (ː length marks, oʊ vs O, eɪ vs A, ɚ vs əɹ). Same speech. |
| 10 | Are you really going to leave? | `ɑːɹ juː ɹˈiəli ɡˌoʊɪŋ tə lˈiːv?` | `ɑɹ ju ɹˈiᵊli ɡˈOɪŋ tə lˈiv?` | really ɹˈiəli vs ɹˈiᵊli |
| 11 | WHAT DID YOU JUST SAY TO ME? | `wˌʌt dˈɪd juː dʒˈʌst sˈeɪ tuː mˌiː?` | `wˌʌt dˈɪd ju ʤˈʌst sˈA tə mˌi?` | Notation only (ː length marks, oʊ vs O, eɪ vs A, ɚ vs əɹ). Same speech. |
| 12 | I won't. I can't. I shouldn't have to. | `aɪ wˈoʊnt. aɪ kˈænt. aɪ ʃˈʊdəntævtʊ.` | `ˌI wOnt. ˌI kˈænt. ˌI ʃˈʊdᵊnt hæv tə.` | espeak runs 'shouldn't have to' together (ʃˈʊdəntævtʊ); ours keeps the words |
| 13 | Wait... did you hear that? | `wˈeɪt... dˈɪd juː hˈɪɹ ðˈæt?` | `wˈAt… dˈɪd ju hˈɪɹ ðæt?` | Notation only (ː length marks, oʊ vs O, eɪ vs A, ɚ vs əɹ). Same speech. |
| 14 | You read my letter? I read it twice. | `juː ɹˈiːd maɪ lˈɛɾɚ? aɪ ɹˈiːd ɪt twˈaɪs.` | `ju ɹˈid mI lˈɛɾəɹ? ˌI ɹˈid ɪt twˈIs.` | both read 'read' as ɹˈid twice (no POS tagger in either path; second should be ɹˈɛd) |
| 15 | We're gonna need a bigger boat. | `wɪɹ ɡˌənə nˈiːd ɐ bˈɪɡɚ bˈoʊt.` | `wɪɹ ɡˈʌnə nˈid ɐ bˈɪɡəɹ bˈOt.` | gonna: ɡˌənə vs ɡˈʌnə |
| 16 | Kavanagh owes me four hundred dollars. | `kˈævɐnˌɑːɡ ˈoʊz mˌiː fˈoːɹ hˈʌndɹɪd dˈɑːlɚz.` | `kˈɑvənˌɑ ˈOz mˌi fˈɔɹ hˈʌndɹəd dˈɑləɹz.` | **Audible.** Kavanagh: ours kˈɑvənˌɑ, espeak kˈævɐnˌɑːɡ (different, neither clearly right) |
| 17 | Oh, come on! You promised! | `ˈoʊ, kˈʌm ˈɔn! juː pɹˈɑːmɪst!` | `ˈO, kˈʌm ˌɔn! ju pɹˈɑməst!` | 'on' stress ˈɔn vs ˌɔn |
| 18 | Tomorrow, and tomorrow, and tomorrow. | `təmˈɑːɹoʊ, ænd təmˈɑːɹoʊ, ænd təmˈɑːɹoʊ.` | `təmˈɑɹO, ænd təmˈɑɹO, ænd təmˈɑɹO.` | Notation only (ː length marks, oʊ vs O, eɪ vs A, ɚ vs əɹ). Same speech. |
| 19 | Leave the lighthouse keys on the table, Elena. | `lˈiːv ðə lˈaɪthaʊs kˈiːz ɔnðə tˈeɪbəl, ᵻlˈiːnə.` | `lˈiv ðə lˈIthˌWs kˈiz ˌɔn ðə tˈAbᵊl, ˈilənə.` | **Audible.** Elena: ours ˈilənə (wrong stress), espeak ᵻlˈiːnə (close) |
| 20 | Hmm. Maybe. We'll see. | `hˈəm. mˈeɪbiː. wiːl sˈiː.` | `hmm. mˈAbi. wil sˈi.` | **Audible.** Hmm: ours 'hmm' has no vowel, espeak hˈəm |

**Audible differences (my judgment from the phonemes): 5 of 20** (lines 5, 6, 16, 19, 20). Four are proper names that went to the fallback, and one is "Hmm". espeak is better on Siobhan, Elena and Hmm; Nguyen and Kavanagh are wrong or doubtful in both paths. On lines 12 and 14 the GPL-free path is equal or slightly better. Everything else is the same speech.

**Side-by-side WAVs** (24 kHz mono, af_heart), in `wav/`:

- `line01_espeak.wav` / `line01_misaki_nogpl.wav`: "I'd've told you, if you'd asked."
- `line03_espeak.wav` / `line03_misaki_nogpl.wav`: "It was the summer of 1987."
- `line04_espeak.wav` / `line04_misaki_nogpl.wav`: "Meet me at 3:15, not a minute later."
- `line05_espeak.wav` / `line05_misaki_nogpl.wav`: "Siobhan, please, just listen to me." (the worst case)
- `line07_espeak.wav` / `line07_misaki_nogpl.wav`: "MARCUS! Get back here!"
- Extra: `standalone_nogpl_af_heart.wav` (path A, no kokoro-js) and `override_demo_bf_emma.wav` (path B, British lexicon)

## 5. Coverage (`coverage.mjs`)

| Text | Words | Lexicon | Fallback (BART) |
|---|---|---|---|
| Script Glow SAMPLE, the 10 dialogue lines Script Glow actually speaks (from `src/parser.ts` `SAMPLE`) | 82 | **82 (100%)** | 0 |
| SAMPLE, every line including headings, cues and action | 151 | 139 (92.1%) | 12: the cue names ELENA and MARCUS, 6 times each |
| The 20 test lines | 123 | **118 (95.9%)** | 5: Siobhan, Nguyen, MARCUS, Kavanagh, Elena |

Everything that went to the fallback was a proper name. The combined US lexicon has 183,561 distinct keys (90,201 gold + 93,361 silver) and has almost no given names (no Marcus, Elena, Siobhan).

## 6. Size and speed

Measured on this Mac (Apple Silicon), Node 26, fp32 model.

- **Size added:** US + GB lexicons 11.6 MB raw (5.8 + 6.2 MB), 11.1 MB minified, **2.9 MB gzipped**. BART fallback 3.1 MB ONNX per accent (6.2 MB both). `number-to-words` 128 KB. The G2P code is 7 KB. Removed: `phonemizer` 2.6 MB. Net for US + GB, uncompressed: about +15 MB, next to the 326 MB fp32 or 92 MB q8 Kokoro model. US only: about +9 MB.
- **G2P load:** 383 to 423 ms cold (JSON parse of two lexicons plus two ONNX sessions), done once.
- **G2P per line:** 1.0 to 2.0 ms warm on average over the 20 lines. A fallback word costs about 4.5 ms each.
- **G2P plus TTS per line (path A):** 0.42 to 0.43 s per line, against the previous spike's 0.75 s with espeak via kokoro-js (different runs and prompts, so not strictly comparable, but G2P is clearly not the bottleneck). RSS 760 to 850 MB with the fp32 model loaded.

## 7. Licensing of the stack that would ship (path A)

| Component | License | Attribution or notice | Flag |
|---|---|---|---|
| Kokoro-82M v1.0 weights (hexgrad; ONNX export by onnx-community) | Apache-2.0 (card: "license: apache-2.0", "This is an Apache-licensed model") | Include the Apache-2.0 text and any NOTICE; credit hexgrad/Kokoro-82M | OK |
| Voice packs `voices/*.bin` (from kokoro-js, originally Kokoro-82M) | Apache-2.0 | Same | OK |
| kokoro-js | Apache-2.0 | Only if path B is used; path A copies about 10 lines of its logic, so keep an Apache credit for them anyway | OK |
| @huggingface/transformers 3.8.1 | Apache-2.0 | License text | OK |
| @huggingface/jinja | MIT | License text | OK |
| onnxruntime-node / onnxruntime-common 1.21.0 | MIT | License text plus the ThirdPartyNotices shipped in the package | OK |
| protobufjs and @protobufjs/* | BSD-3-Clause | License text | OK |
| flatbuffers, long, detect-libc | Apache-2.0 | License text | OK |
| global-agent, roarr, sprintf-js | BSD-3-Clause | License text | OK |
| tar, minipass, chownr, yallist | BlueOak-1.0.0 (permissive) | Keep notice | OK (install-time helpers of onnxruntime-node) |
| guid-typescript, semver, json-stringify-safe | ISC | Keep notice | OK |
| remaining small deps (matcher, boolean, es-*, gopd, etc.) | MIT | Keep notice | OK |
| **sharp 0.34.5** | Apache-2.0 | | OK itself, but see the next row |
| **@img/sharp-libvips-* 1.2.4** | **LGPL-3.0-or-later** | LGPL obligations (the user must be able to replace the library, plus the license text) | **Non-permissive (weak copyleft).** Not used by TTS. Remove it with the `overrides` stub (tested) |
| Misaki G2P logic, ported (`g2p.mjs`) | Apache-2.0 (hexgrad/misaki) | Apache-2.0 text; state that the port was modified | OK |
| **Misaki lexicons** us/gb gold and silver | Apache-2.0 by containment in the repo | Same | **Provenance undocumented. Confirm with hexgrad, or switch to CMUdict (BSD-2)** |
| Misaki BART G2P weights (PeterReid, ONNX export here) | Apache-2.0 (HF card) | Credit PeterReid/graphemes_to_phonemes_en_us/gb | OK, but trained on the Misaki lexicons, so it inherits their provenance question |
| number-to-words 1.2.4 | MIT ("Copyright (c) 2015 Martin Eneqvist") | License text | OK |
| CMUdict (only if used as backup) | BSD-2-Clause style, CMU | Keep the copyright notice and conditions | OK |
| phonemizer / espeak-ng | GPL-3.0-or-later (espeak-ng) | | **Gone from path A** (verified by the module-load hook) |

Nothing GPL ships in path A. After the sharp stub, nothing copyleft ships either. The open item is the Misaki lexicon provenance.

## Recommendation

1. Use path A: about 10 lines of transformers.js calls instead of kokoro-js, and the Misaki lexicon plus BART G2P in a utility process. Add `overrides: { sharp: stub }`.
2. Before shipping, ask hexgrad (a GitHub issue on hexgrad/misaki) where `us_*`/`gb_*` came from and confirm they are Apache-2.0. If there is no answer, or the answer is espeak output or Wiktionary (CC-BY-SA), rebuild the lexicon from CMUdict with `cmuToMisaki` in `cmu_vs_misaki.mjs` and retrain or skip the BART fallback.
3. Add a pronunciation override for character names in the script (Misaki's own syntax is `[Siobhan](/ʃɪvˈɔn/)`), and look them up before the fallback. This covers the only class of audible regression found.
4. Later, if wanted: a small POS heuristic for common homographs (read, live, lead, tear), which neither path handles today.

## Files

- `g2p.mjs`: the G2P (lexicon, rules, BART fallback)
- `speak_nogpl.mjs`, `watch.mjs`: path A and the proof that no espeak loads
- `override-demo/`: path B (`phonemizer` and `sharp` stubs via npm overrides)
- `compare.mjs`, `lines.json`, `compare.txt`, `compare.json`, `table.md`: the 20-line comparison
- `coverage.mjs`, `sample_script.txt`: coverage
- `fallbacks.mjs`, `cmu_vs_misaki.mjs`: fallback and CMUdict checks
- `bart/export.py`, `bart/ref.py`, `bart/cmp.py`, `bart/*.onnx`: BART export and parity checks
- `data/`: the Misaki lexicons; `lic/`: fetched license files, `en.py` and `EN_PHONES.md`
- `wav/`: listening files
