# Built-in Kokoro Voices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An actor installs Script Glow and hears the cast read their scene with no voice server, no GPU, no API key and no cost, because Kokoro-82M runs on the computer's CPU inside the app.

**Architecture:** A GPL-free text-to-phoneme step (a JavaScript port of Misaki with its word lists and its small BART fallback model) turns each line into Kokoro's phonemes. One long-lived worker process runs that step and the fp16 Kokoro model through transformers.js and onnxruntime-node: an Electron `utilityProcess` in the desktop app, a `child_process.fork` under plain Node. `server/kokoro/client.js` queues lines to it, `server/kokoro/assets.js` downloads the pinned, hash-checked model files into the user folder, and `server/app.js` gains a local `kokoro` engine. The page gains a recommended welcome choice, a Settings card with download progress, and a **Say it like** box on each character card that respells names for every engine.

**Tech Stack:** Node 24, Express 5, TypeScript and Vite, `@huggingface/transformers` 3.8.1, `onnxruntime-node` (the exact version transformers.js pins), `number-to-words` 1.2.4, Electron 44 `utilityProcess`, electron-builder, `node:test`, Playwright, GitHub Actions. Python (through `uv`) only for the one-time BART export in Task 4, never at runtime.

**Spec:** `docs/superpowers/specs/2026-09-19-kokoro-engine-design.md`. Evidence and reference code: `docs/research/2026-09-19-kokoro/` (`g2p-findings.md`, `twenty-lines.md`, `spike-code/`). The spike code is throwaway; this plan's code replaces it.

## Global Constraints

- Work on branch `feature/kokoro-engine`, in its worktree. It already has `origin/main` (8ff0fdd, settings auto-save and the desktop data folder) merged in; plan line references match that tree.
- **Release gate (from the spec).** Misaki's word lists have no statement of where their data came from. Mariano opens the issue drafted in `docs/research/2026-09-19-kokoro/misaki-lexicon-question.md` on hexgrad/misaki. **Kokoro is not enabled in a public release until the answer shows the data is permissive.** `server/kokoro/release-gate.json` stays `"misakiProvenanceCleared": false` until Mariano sets it by hand, and the release workflow refuses to build while it is false (Task 9). If the answer is not permissive, the word lists are rebuilt from CMUdict (BSD-2) with `cmuToMisaki` from `spike-code/cmu_vs_misaki.mjs`, and the fallback model is retrained on that list or left out. That rebuild is a separate plan.
- Nothing GPL, LGPL or AGPL ships. `kokoro-js`, `phonemizer` and espeak-ng are never installed. `sharp` is replaced by the empty stub in `stubs/sharp` through npm `overrides`, so `@img/sharp-libvips-*` (LGPL-3.0) is never installed. `tests/licenses.test.js` enforces this in `npm test`.
- No Python at runtime.
- Engine id `kokoro`. Voice ids `kokoro:<name>` (for example `kokoro:af_heart`). English only: the 28 voices whose names start with `af_`, `am_`, `bf_`, `bm_`. Accent `US` or `UK` and gender come from the prefix.
- Kokoro is local, not hosted: no key, the "free" labels, and the stage-directions prespeak treat it like Chatterbox.
- Model files: the fp16 model, the English voice packs, the tokenizer files, the Misaki US and GB word lists, and the two BART fallback models. Published once as assets of the GitHub release `kokoro-assets-v1` in `Mariano215/script-glow`. The app carries `server/kokoro/manifest.json` with each file's path, size and SHA-256 and refuses a file whose hash does not match. Stored in `<SCRIPT_GLOW_HOME, else the repo root>/models/kokoro-v1/`. A file gets its real name only after its hash matched, so nothing partial is ever loaded.
- **The upload of the model files to the public repository is done by Mariano by hand** (Task 4, Step 9). No agent runs `gh release create` or uploads anything.
- Worker: one long-lived process; `utilityProcess` under Electron, `child_process.fork` under Node; one request at a time, in order; a line over 60 s fails with a clear message; a crash restarts it once and retries the line; it stops after 10 minutes idle and when the app quits.
- The line cache key for Kokoro holds the engine, the model file hash, the G2P version and word-list hashes, the voice and the text.
- **Say it like** applies to every engine: the text sent is changed, the page still shows the script as written, and the respelling is part of the render key.
- Out of scope (spec): voice cloning with Kokoro, languages other than English, GPU acceleration, part-of-speech rules for words spelled alike (read, live, lead).
- All text (code comments, UI copy, commit messages, docs): American English, no em-dashes or en-dashes. Where a dash character is data (Kokoro's punctuation), the code writes it as the escape `\u2014`. Server addresses in copy and examples: `192.168.1.20` or `10.0.0.5` only.
- Run `npm test` and `npm run build` before every commit. Both must pass.
- Commit subjects are conventional commits. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Do not push.

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `server/kokoro/g2p.js` | Create | Misaki port: text to Kokoro phonemes, respelling rule, BART fallback loader |
| `server/kokoro/assets.js` | Create | Asset names, readiness, resumable hash-checked download, voice list, cache identity, `MANIFEST` |
| `server/kokoro/manifest.json` | Create (generated) | Every model file with its size and SHA-256, and where each came from |
| `server/kokoro/release-gate.json` | Create | The Misaki provenance gate that the release workflow reads |
| `server/kokoro/worker.js` | Create | The process that runs the G2P and the model, one line at a time |
| `server/kokoro/client.js` | Create | Starts the worker, queues lines, timeout, crash restart, idle stop |
| `server/app.js` | Modify | `kokoro` engine: voices, health, preview, line cache, prespeak, chunk size, `/api/kokoro` routes |
| `server/connections.js` | Modify | `kokoro` in `VOICE_ENGINES` |
| `server/projects.js` | Modify | `sayAs` in project preferences |
| `src/parser.ts` | Modify | `sayItLike()` |
| `src/main.ts` | Modify | Welcome choice, Settings card and progress, render status, Say it like box |
| `src/style.css` | Modify | Styles for the three new pieces of UI |
| `stubs/sharp/package.json`, `stubs/sharp/index.js` | Create | Empty stand-in for `sharp` |
| `scripts/kokoro-assets.mjs` | Create | Fetch the model files, write the manifest, stage the release assets |
| `scripts/kokoro-bart-export.py` | Create | One-time export of the BART fallback to ONNX |
| `scripts/third-party-notices.mjs` | Create | Writes and checks `THIRD_PARTY_NOTICES.md` |
| `THIRD_PARTY_NOTICES.md` | Create (generated) | Every shipped or downloaded component with its license text |
| `desktop/builder.cjs` | Modify | Unpack the worker and its package tree; ship the notices file |
| `.github/workflows/test.yml` | Modify | Desktop job: cached model files, end-to-end render, real-data G2P check |
| `.github/workflows/release.yml` | Modify | Release gate step |
| `tests/g2p.test.js`, `tests/fixtures/g2p-lexicon.json`, `tests/fixtures/g2p-lines.json` | Create | G2P golden tests |
| `tests/licenses.test.js` | Create | License guard and notices check |
| `tests/kokoro-assets.test.js` | Create | Download tests against a local fake release |
| `tests/kokoro-client.test.js`, `tests/fixtures/fake-kokoro-worker.js` | Create | Worker protocol tests with a fake worker |
| `tests/kokoro-engine.test.js` | Create | The engine inside the server |
| `tests/parser.test.ts`, `tests/projects.test.js` | Modify | Say it like |
| `verification/kokoro-g2p.mjs` | Create | The 20 lines through the real word lists and BART |
| `verification/kokoro-speak.mjs`, `verification/no-espeak-hook.mjs` | Create | Real worker smoke test, with a hook that fails on any espeak load |
| `verification/builtin-voices.mjs`, `verification/say-it-like.mjs` | Create | Browser checks |
| `verification/kokoro-desktop.mjs` | Create | Packed app end to end with the real model |
| `verification/first-run.mjs`, `verification/desktop.mjs` | Modify | Four welcome choices; unpacked files and notices in the packed app |
| `package.json`, `package-lock.json`, `.gitignore`, `README.md`, `CHANGELOG.md` | Modify | Dependencies, scripts, `models/`, docs |

---

### Task 1: Text to phonemes without espeak (the Misaki port)

**Files:**
- Create: `server/kokoro/g2p.js`
- Create: `tests/g2p.test.js`, `tests/fixtures/g2p-lexicon.json`, `tests/fixtures/g2p-lines.json`
- Modify: `package.json`, `package-lock.json` (add `number-to-words`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `G2P_VERSION: string`, currently `'misaki-js-1'`. Change it whenever a rule changes.
  - `createG2P({ gold, silver, fallback, british = false }): (text: string) => Promise<string>`. `gold` and `silver` are Misaki word lists: an object from word to a phoneme string, or to `{ DEFAULT, VBD, ... }` for words spelled alike. `fallback(word: string): Promise<string>` gives phonemes for a word in neither list. `british` picks the UK reduced vowel in suffixes.
  - `loadG2P(dir: string, { british = false } = {}): Promise<(text: string) => Promise<string>>`. Reads `us_gold.json`, `us_silver.json`, `bart_us.json`, `bart_enc_us.onnx`, `bart_dec_us.onnx` from `dir` (`gb_` and `_gb` files when `british`). Imports `onnxruntime-node` only when called, so tests of `createG2P` never load a native module.
  - A respelling rule used by Task 8: a hyphenated token with at least one lowercase part and at least one ALL CAPS part (`shi-VAWN`) is read part by part, each part's own stress removed, and primary stress put before the first vowel of each ALL CAPS part.
  - `tests/fixtures/g2p-lines.json`: `[{ text, phonemes }]`, the 20 actor lines with the phonemes the spike produced. Task 4 checks them again with the real word lists.

- [ ] **Step 1: Add the number reader**

Run: `npm install --save-exact number-to-words@1.2.4`
Expected: `package.json` `dependencies` now has `"number-to-words": "1.2.4"`, and `npm ls number-to-words` prints `number-to-words@1.2.4`. Its license is MIT.

- [ ] **Step 2: Write the golden lines fixture**

Create `tests/fixtures/g2p-lines.json`. These are the 20 lines and the "GPL-free path" column from `docs/research/2026-09-19-kokoro/twenty-lines.md`, copied exactly:

```json
[
  {"text": "I'd've told you, if you'd asked.", "phonemes": "ˌIdəv tˈOld ju, ɪf jud ˈæskt."},
  {"text": "Y'all can't be serious right now.", "phonemes": "jˈɔl kˈænt bi sˈɪɹiəs ɹˈIt nˈW."},
  {"text": "It was the summer of 1987.", "phonemes": "ɪt wʌz ðə sˈʌməɹ ʌv nˌIntˈin ˈAɾi sˈɛvən."},
  {"text": "Meet me at 3:15, not a minute later.", "phonemes": "mˈit mˌi æt θɹˈi fˌɪftˈin, nˌɑt ɐ mˈɪnət lˈAɾəɹ."},
  {"text": "Siobhan, please, just listen to me.", "phonemes": "sˈObhˌɑn, plˈiz, ʤˈʌst lˈɪsᵊn tə mˌi."},
  {"text": "Mr. Nguyen is waiting downstairs.", "phonemes": "mˈɪstəɹ əŋɡˈIən ɪz wˈAɾɪŋ dˌWnstˈɛɹz."},
  {"text": "MARCUS! Get back here!", "phonemes": "mˈɑɹkəs! ɡɛt bˈæk hˈɪɹ!"},
  {"text": "(beat) Fine. Have it your way.", "phonemes": "(bˈit) fˈIn. hæv ɪt jʊɹ wˈA."},
  {"text": "Beat. Then she turns away.", "phonemes": "bˈit. ðˈɛn ʃi tˈɜɹnz əwˈA."},
  {"text": "Are you really going to leave?", "phonemes": "ɑɹ ju ɹˈiᵊli ɡˈOɪŋ tə lˈiv?"},
  {"text": "WHAT DID YOU JUST SAY TO ME?", "phonemes": "wˌʌt dˈɪd ju ʤˈʌst sˈA tə mˌi?"},
  {"text": "I won't. I can't. I shouldn't have to.", "phonemes": "ˌI wOnt. ˌI kˈænt. ˌI ʃˈʊdᵊnt hæv tə."},
  {"text": "Wait... did you hear that?", "phonemes": "wˈAt… dˈɪd ju hˈɪɹ ðæt?"},
  {"text": "You read my letter? I read it twice.", "phonemes": "ju ɹˈid mI lˈɛɾəɹ? ˌI ɹˈid ɪt twˈIs."},
  {"text": "We're gonna need a bigger boat.", "phonemes": "wɪɹ ɡˈʌnə nˈid ɐ bˈɪɡəɹ bˈOt."},
  {"text": "Kavanagh owes me four hundred dollars.", "phonemes": "kˈɑvənˌɑ ˈOz mˌi fˈɔɹ hˈʌndɹəd dˈɑləɹz."},
  {"text": "Oh, come on! You promised!", "phonemes": "ˈO, kˈʌm ˌɔn! ju pɹˈɑməst!"},
  {"text": "Tomorrow, and tomorrow, and tomorrow.", "phonemes": "təmˈɑɹO, ænd təmˈɑɹO, ænd təmˈɑɹO."},
  {"text": "Leave the lighthouse keys on the table, Elena.", "phonemes": "lˈiv ðə lˈIthˌWs kˈiz ˌɔn ðə tˈAbᵊl, ˈilənə."},
  {"text": "Hmm. Maybe. We'll see.", "phonemes": "hmm. mˈAbi. wil sˈi."}
]
```

- [ ] **Step 3: Write the small word list the tests use**

Create `tests/fixtures/g2p-lexicon.json`. It holds only the words the tests need, with the phonemes the spike's real word list gave them, so the tests run without the 11 MB download. `ask`, `turn`, `go`, `owe`, `dollar`, `key`, `promise` and `I'd` are stems on purpose: the lines use `asked`, `turns`, `going`, `owes`, `dollars`, `keys`, `promised` and `I'd've`, which the stem and clitic rules must build.

```json
{
  "and": "ænd", "are": "ɑɹ", "ask": "ˈæsk", "at": "æt", "away": "əwˈA", "B": "bˈi", "back": "bˈæk",
  "be": "bi", "beat": "bˈit", "bigger": "bˈɪɡəɹ", "boat": "bˈOt", "can't": "kˈænt", "come": "kˈʌm",
  "did": "dˈɪd", "dollar": "dˈɑləɹ", "downstairs": "dˌWnstˈɛɹz", "eighty": "ˈAɾi", "F": "ˈɛf",
  "fifteen": "fˌɪftˈin", "fine": "fˈIn", "five": "fˈIv", "four": "fˈɔɹ", "get": "ɡɛt", "go": "ɡˈO",
  "gonna": "ɡˈʌnə", "have": "hæv", "hear": "hˈɪɹ", "here": "hˈɪɹ", "hmm": "hmm",
  "hundred": "hˈʌndɹəd", "I": "ˈI", "I'd": "ˌId", "if": "ɪf", "is": "ɪz", "it": "ɪt",
  "just": "ʤˈʌst", "key": "kˈi", "known": "nˈOn", "later": "lˈAɾəɹ", "leave": "lˈiv",
  "letter": "lˈɛɾəɹ", "lighthouse": "lˈIthˌWs", "listen": "lˈɪsᵊn", "maybe": "mˈAbi", "me": "mˌi",
  "meet": "mˈit", "minute": "mˈɪnət", "Mr": "mˈɪstəɹ", "my": "mI", "need": "nˈid",
  "nineteen": "nˌIntˈin", "not": "nˌɑt", "now": "nˈW", "o'clock": "əklˈɑk", "of": "ʌv", "oh": "ˈO",
  "on": "ˌɔn", "or": "ɔɹ", "owe": "ˈO", "please": "plˈiz", "promise": "pɹˈɑməs",
  "read": {"DEFAULT": "ɹˈid", "VBD": "ɹˈɛd"}, "really": "ɹˈiᵊli", "right": "ɹˈIt", "say": "sˈA",
  "see": "sˈi", "serious": "sˈɪɹiəs", "seven": "sˈɛvən", "she": "ʃi", "shouldn't": "ʃˈʊdᵊnt",
  "summer": "sˈʌməɹ", "table": "tˈAbᵊl", "that": "ðæt", "then": "ðˈɛn", "three": "θɹˈi",
  "told": "tˈOld", "tomorrow": "təmˈɑɹO", "turn": "tˈɜɹn", "twelve": "twˈɛlv", "twice": "twˈIs",
  "wait": "wˈAt", "waiting": "wˈAɾɪŋ", "was": "wʌz", "way": "wˈA", "we'll": "wil", "we're": "wɪɹ",
  "well": "wˈɛl", "what": "wˌʌt", "won't": "wOnt", "y'all": "jˈɔl", "you": "ju", "you'd": "jud",
  "your": "jʊɹ"
}
```

- [ ] **Step 4: Write the failing tests**

Create `tests/g2p.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createG2P } from '../server/kokoro/g2p.js';

// A small word list holding only what these tests need, and a fallback that answers like the BART
// model did in the spike (docs/research/2026-09-19-kokoro/twenty-lines.md), so no model is loaded.
const gold = JSON.parse(readFileSync(new URL('./fixtures/g2p-lexicon.json', import.meta.url), 'utf8'));
const lines = JSON.parse(readFileSync(new URL('./fixtures/g2p-lines.json', import.meta.url), 'utf8'));
const SPOKEN_BY_FALLBACK = { Siobhan: 'sˈObhˌɑn', Nguyen: 'əŋɡˈIən', Marcus: 'mˈɑɹkəs', Kavanagh: 'kˈɑvənˌɑ', Elena: 'ˈilənə', Shi: 'ʃˈi', Vawn: 'vˈɔn', constructor: 'kənstɹˈʌktəɹ', Zoe: 'zˈOi' };
function g2p() {
  const asked = [];
  const run = createG2P({ gold, silver: {}, fallback: async word => { asked.push(word); return Object.hasOwn(SPOKEN_BY_FALLBACK, word) ? SPOKEN_BY_FALLBACK[word] : ''; } });
  return Object.assign(run, { asked });
}

test('the 20 actor lines from the spike come out as they did there', async () => {
  const run = g2p();
  for (const { text, phonemes } of lines) assert.equal(await run(text), phonemes, text);
  assert.deepEqual(run.asked, ['Siobhan', 'Nguyen', 'Marcus', 'Kavanagh', 'Elena'], 'Only names reach the fallback');
});

test('stems and clitics: -ed, -s, -ing and I\'d\'ve are built from the word list', async () => {
  const run = g2p();
  assert.equal(await run('asked'), 'ˈæskt');
  assert.equal(await run('turns'), 'tˈɜɹnz');
  assert.equal(await run('going'), 'ɡˈOɪŋ');
  assert.equal(await run('promised'), 'pɹˈɑməst');
  assert.equal(await run("I'd've"), 'ˌIdəv');
  assert.deepEqual(run.asked, []);
});

test('clock times, and hyphenated words read as two words', async () => {
  const run = g2p();
  assert.equal(await run('At 3:05 or 12:00.'), 'æt θɹˈi ˈO fˈIv ɔɹ twˈɛlv əklˈɑk.');
  assert.equal(await run('well-known'), 'wˈɛl nˈOn');
});

test('ALL CAPS: a known word is read, a short unknown one is spelled with the stress last', async () => {
  const run = g2p();
  assert.equal(await run('WHAT DID YOU SAY?'), 'wˌʌt dˈɪd ju sˈA?');
  assert.equal(await run('FBI'), 'ˌɛfbˌiˈI');
  assert.equal(await run('MARCUS!'), 'mˈɑɹkəs!');
});

test('a Say it like respelling is stressed on its capitals', async () => {
  const run = g2p();
  assert.equal(await run('shi-VAWN, please.'), 'ʃivˈɔn, plˈiz.');
  assert.deepEqual(run.asked, ['Shi', 'Vawn']);
});

test('words spelled alike take their DEFAULT reading', async () => {
  assert.equal(await g2p()('I read it.'), 'ˌI ɹˈid ɪt.');
});

test('odd input: accents are dropped, and a word named like an object property still works', async () => {
  const run = g2p();
  assert.equal(await run('Zoë'), 'zˈOi');
  assert.equal(await run('constructor'), 'kənstɹˈʌktəɹ');
  assert.deepEqual(run.asked, ['Zoe', 'constructor']);
});
```

- [ ] **Step 5: Run the tests and see them fail**

Run: `node --test tests/g2p.test.js`
Expected: FAIL, `Cannot find module '.../server/kokoro/g2p.js'`.

- [ ] **Step 6: Write the G2P**

Create `server/kokoro/g2p.js`. It is the spike's `g2p.mjs` with four changes: data is passed in (so tests need no files), lookups use `Object.hasOwn` (a word such as `constructor` must not find `Object.prototype.constructor`), hyphens are handled by the tokenizer (numbers still read "eighty seven", `well-known` still reads as two words, and a respelling stays whole), and accents are dropped (`Zoë` reads as `Zoe`). The spike's coverage counters are gone.

```js
// English text to Kokoro phonemes, with no espeak-ng (GPL). A JavaScript port of the English G2P
// in hexgrad/misaki (misaki/en.py, Apache-2.0), modified for Script Glow: no part-of-speech
// tagging (words spelled alike take their DEFAULT reading), a respelling rule for Say it like,
// and the word lists and fallback model read from the downloaded model folder.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import n2w from 'number-to-words';

// Change this whenever a rule below changes, so the line cache never reuses audio made by old rules.
export const G2P_VERSION = 'misaki-js-1';
// Kokoro's punctuation. Everything else that is not a letter is dropped.
const PUNCT = ';:,.!?\u2014…"“”()';
const VOWELS = new Set('AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ');
const STRESS = /[ˈˌ]/g;

// Misaki's grow_dictionary: a lowercase entry also answers for its Capitalized form, and back.
function grow(lexicon) {
  const extra = {};
  for (const [word, phonemes] of Object.entries(lexicon)) {
    if (word.length < 2) continue;
    const capital = word[0].toUpperCase() + word.slice(1);
    if (word === word.toLowerCase()) { if (word !== capital) extra[capital] = phonemes; }
    else if (word === word[0] + word.slice(1).toLowerCase()) extra[word.toLowerCase()] = phonemes;
  }
  return { ...extra, ...lexicon };
}

// Numbers read the way kokoro-js has espeak read them: clock times, years in pairs, then words.
function numberWords(text) {
  const spaced = words => words.replace(/-/g, ' ');
  return text
    .replace(/\b([1-9]|1[0-2]):([0-5]\d)\b/g, (_, hour, minute) => minute === '00' ? `${hour} o'clock` : minute < 10 ? `${hour} oh ${+minute}` : `${hour} ${minute}`)
    .replace(/\b(1[1-9]|20)(\d\d)(s?)\b/g, (_, high, low, plural) => low === '00' ? `${high} hundred${plural}` : +low < 10 ? `${high} oh ${+low}${plural}` : `${high} ${low}${plural}`)
    .replace(/(?<=\d),(?=\d{3})/g, '')
    .replace(/\d+(st|nd|rd|th)\b/g, match => spaced(n2w.toWordsOrdinal(parseInt(match, 10))))
    .replace(/\d+/g, match => spaced(n2w.toWords(Number(match))));
}

// A Say it like respelling: hyphenated, with a lowercase part and a CAPITALIZED (stressed) part.
const respelling = token => token.includes('-') && token.split('-').some(part => /^[A-Z]+$/.test(part)) && token.split('-').some(part => /^[a-z]+$/.test(part));

// gold and silver: Misaki word lists (word to phonemes, or to { DEFAULT, VBD, ... } for words
// spelled alike). fallback: phonemes for a word in neither list (the BART model in production).
export function createG2P({ gold, silver, fallback, british = false }) {
  gold = grow(gold); silver = grow(silver);
  const known = word => Object.hasOwn(gold, word) || Object.hasOwn(silver, word);
  const look = word => {
    const entry = Object.hasOwn(gold, word) ? gold[word] : silver[word];
    return entry && typeof entry === 'object' ? entry.DEFAULT ?? Object.values(entry)[0] : entry;
  };
  const reduced = british ? 'ɪ' : 'ᵻ';
  const plural = stem => /[ptkfθ]$/.test(stem) ? `${stem}s` : /[szʃʒʧʤ]$/.test(stem) ? `${stem}${reduced}z` : `${stem}z`;
  const past = stem => /[pkfθʃsʧ]$/.test(stem) ? `${stem}t` : /[dt]$/.test(stem) ? `${stem}${reduced}d` : `${stem}d`;
  const CLITIC = { "'ve": 'v', "'ll": 'l', "'d": 'd', "'m": 'm', "'re": 'ɹ' };

  function lexical(word) {
    if (known(word)) return look(word);
    const lower = word.toLowerCase();
    if (word !== lower && known(lower)) return look(lower);
    const capital = lower[0].toUpperCase() + lower.slice(1);
    if (known(capital)) return look(capital);
    // Misaki's stem rules: -s, -es, -ies, then -ed, then -ing.
    if (/[^s]s$/.test(lower) && lower.length > 2) {
      const stems = [lower.slice(0, -1)];
      if (/[^i]es$/.test(lower) && lower.length > 4) stems.push(lower.slice(0, -2));
      if (/ies$/.test(lower) && lower.length > 4) stems.push(`${lower.slice(0, -3)}y`);
      for (const stem of stems) if (known(stem)) return plural(look(stem));
    }
    if (/ed$/.test(lower) && lower.length > 4) for (const stem of [lower.slice(0, -1), lower.slice(0, -2)]) if (known(stem)) return past(look(stem));
    if (/ing$/.test(lower) && lower.length > 4) for (const stem of [lower.slice(0, -3), `${lower.slice(0, -3)}e`, lower.slice(0, -4)]) if (known(stem)) return `${look(stem)}ɪŋ`;
    // Clitics, as in I'd've and Marcus's.
    const clitic = lower.match(/^(.+?)('ve|'ll|'d|'m|'re|'s)$/);
    if (clitic) {
      const head = lexical(clitic[1]);
      if (head) return clitic[2] === "'s" ? plural(head) : `${head}${/[bdfɡkpstvzθðʃʒʤʧ]$/.test(head) && /'(ve|ll)/.test(clitic[2]) ? 'ə' : ''}${CLITIC[clitic[2]]}`;
    }
    return null;
  }

  async function word(token, nextVowel) {
    const lower = token.toLowerCase();
    // Misaki's special cases; "the" and "to" depend on whether the next word starts with a vowel sound.
    if (lower === 'the') return nextVowel ? 'ði' : 'ðə';
    if (lower === 'a' && token !== 'A') return 'ɐ';
    if (token === 'I') return 'ˌI';
    if (lower === 'to') return nextVowel ? 'tʊ' : 'tə';
    if (lower === 'an') return 'ɐn';
    let phonemes = lexical(token);
    // Two to four capitals not in the lists (FBI, NYPD) are spelled out, stress on the last letter.
    if (phonemes == null && /^[A-Z]{2,4}$/.test(token) && (token.length < 4 || !/[AEIOUY]/.test(token))) {
      const letters = [...token].map(letter => gold[letter]);
      if (!letters.includes(undefined)) {
        const joined = letters.join('').replace(/ˈ/g, 'ˌ'), last = joined.lastIndexOf('ˌ');
        phonemes = `${joined.slice(0, last)}ˈ${joined.slice(last + 1)}`;
      }
    }
    // The fallback model learned from dictionary spelling: a capital, then lowercase.
    return phonemes ?? fallback(token[0] + token.slice(1).toLowerCase());
  }

  // "shi-VAWN": each part is read, its own stress dropped, and the capitalized part stressed.
  async function respell(token) {
    let out = '';
    for (const part of token.split('-')) {
      const sounds = [...(lexical(part.toLowerCase()) ?? await fallback(part[0].toUpperCase() + part.slice(1).toLowerCase())).replace(STRESS, '')];
      const vowel = sounds.findIndex(sound => VOWELS.has(sound));
      if (/^[A-Z]+$/.test(part) && vowel >= 0) sounds.splice(vowel, 0, 'ˈ');
      out += sounds.join('');
    }
    return out;
  }

  return async function g2p(text) {
    // Accents go (Zoë reads as Zoe), curly apostrophes straighten, Mr. and friends lose the period.
    text = numberWords(text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[‘’]/g, "'")
      .replace(/\b(Mr|Mrs|Ms|Dr|St)\.(?= [A-Z])/g, '$1').replace(/\s+/g, ' ').trim());
    const tokens = (text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*'?|[;:,.!?\u2014…"“”()]+|\S/g) ?? [])
      .flatMap(token => token.includes('-') && !respelling(token) ? token.split('-') : [token]);
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (/^[A-Za-z]/.test(token)) {
        const next = tokens.slice(i + 1).find(item => /^[A-Za-z]/.test(item));
        const nextSounds = next && !respelling(next) ? lexical(next.replace(/'$/, '')) : null;
        const nextVowel = nextSounds ? VOWELS.has(nextSounds.replace(/^[ˈˌ]/, '')[0]) : /^[aeiou]/i.test(next ?? '');
        out.push({ phonemes: respelling(token) ? await respell(token) : await word(token.replace(/'$/, ''), nextVowel), punct: false });
      } else if ([...token].every(char => PUNCT.includes(char))) out.push({ phonemes: token.replace(/\.{3}/g, '…'), punct: true });
    }
    // Punctuation hugs the word before it; an opening bracket or quote hugs the word after it.
    let spoken = '';
    for (const [i, item] of out.entries()) {
      const previous = out[i - 1];
      const glued = !previous || (item.punct && !/^[(“]/.test(item.phonemes)) || (previous.punct && /[(“]$/.test(previous.phonemes));
      spoken += (glued ? '' : ' ') + item.phonemes;
    }
    return spoken;
  };
}

// Misaki's BART fallback (PeterReid/graphemes_to_phonemes_en_us and _gb, Apache-2.0), exported to
// ONNX by scripts/kokoro-bart-export.py. Greedy decoding without a cache: words are short.
async function bartFallback(dir, accent) {
  const ort = await import('onnxruntime-node');
  const config = JSON.parse(await readFile(path.join(dir, `bart_${accent}.json`), 'utf8'));
  const [encoder, decoder] = await Promise.all(['enc', 'dec'].map(part => ort.InferenceSession.create(path.join(dir, `bart_${part}_${accent}.onnx`))));
  const letters = [...config.grapheme_chars], sounds = [...config.phoneme_chars];
  const ids = values => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), [1, values.length]);
  return async word => {
    const input = [1, ...[...word].map(letter => { const at = letters.indexOf(letter); return at < 0 ? 3 : at; }), 2];
    const { enc } = await encoder.run({ ids: ids(input) });
    const output = [1];
    while (output.length < 64) {
      const { logits } = await decoder.run({ dec_ids: ids(output), enc });
      const size = logits.dims[2], last = logits.data.subarray((output.length - 1) * size, output.length * size);
      let best = 0;
      for (let i = 1; i < size; i++) if (last[i] > last[best]) best = i;
      if (best === 2) break;
      output.push(best);
    }
    return output.filter(id => id > 3).map(id => sounds[id]).join('');
  };
}

// The G2P for US (British false) or UK English, from the downloaded g2p folder.
export async function loadG2P(dir, { british = false } = {}) {
  const accent = british ? 'gb' : 'us';
  const list = async name => JSON.parse(await readFile(path.join(dir, `${accent}_${name}.json`), 'utf8'));
  const [gold, silver, fallback] = await Promise.all([list('gold'), list('silver'), bartFallback(dir, accent)]);
  return createG2P({ gold, silver, fallback, british });
}
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `node --test tests/g2p.test.js`
Expected: PASS, 7 tests, 0 failures.

- [ ] **Step 8: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: every test passes (the 7 new ones included) and the build ends without errors.

- [ ] **Step 9: Commit**

```bash
git add server/kokoro/g2p.js tests/g2p.test.js tests/fixtures/g2p-lexicon.json tests/fixtures/g2p-lines.json package.json package-lock.json
git commit -m "feat: English text to Kokoro phonemes without espeak (Misaki port)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: License guard, transformers.js and the sharp stub

**Files:**
- Create: `tests/licenses.test.js`
- Create: `stubs/sharp/package.json`, `stubs/sharp/index.js`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `@huggingface/transformers` 3.8.1 and `onnxruntime-node` (same version transformers.js pins) as exact production dependencies, for Tasks 1 (`loadG2P`) and 5 (the worker). `npm test` fails if anything that ships is GPL, LGPL or AGPL, or if `phonemizer`, `kokoro-js` or `@img/sharp-libvips-*` is installed. Task 10 adds a notices check to the same test file.

- [ ] **Step 1: Write the license tests**

Create `tests/licenses.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// What ships: every installed package that is not only a development tool. package-lock.json
// records each package's license, so no network and no node_modules walk is needed.
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const shipped = Object.entries(lock.packages).filter(([where, entry]) => where.startsWith('node_modules/') && !entry.dev);
const nameOf = where => where.slice(where.lastIndexOf('node_modules/') + 'node_modules/'.length);

test('nothing that ships is GPL, LGPL or AGPL', () => {
  const copyleft = shipped.filter(([, entry]) => /GPL/i.test(String(entry.license ?? ''))).map(([where, entry]) => `${nameOf(where)} (${entry.license})`);
  assert.deepEqual(copyleft, []);
});

// phonemizer says Apache-2.0 in its package.json but bundles espeak-ng (GPL-3.0), so a license
// field check alone would not catch it. kokoro-js imports it.
test('espeak-ng, kokoro-js and the LGPL sharp image library are not installed', () => {
  const names = shipped.map(([where]) => nameOf(where));
  assert.deepEqual(names.filter(name => ['phonemizer', 'kokoro-js', 'espeak-ng'].includes(name) || name.startsWith('@img/sharp-libvips')), []);
});

test('sharp is the empty stub in stubs/sharp', () => {
  assert.equal(lock.packages['node_modules/sharp']?.link, true);
  assert.equal(lock.packages['node_modules/sharp']?.resolved, 'stubs/sharp');
});
```

- [ ] **Step 2: Run the tests before transformers.js is added**

Run: `node --test tests/licenses.test.js`
Expected: the first two tests PASS; `sharp is the empty stub` FAILS (`undefined !== true`), because nothing installs sharp yet.

- [ ] **Step 3: Add transformers.js and see the guard catch libvips**

Run:
```bash
npm install --save-exact @huggingface/transformers@3.8.1
npm install --save-exact onnxruntime-node@$(node -p "require('./node_modules/@huggingface/transformers/package.json').dependencies['onnxruntime-node']")
node --test tests/licenses.test.js
```
Expected: `package.json` has both as exact versions (the spike ran `onnxruntime-node` 1.21.0; use whatever transformers.js 3.8.1 names). The test run FAILS `nothing that ships is GPL` with a list of `@img/sharp-libvips-* (LGPL-3.0-or-later)` entries. Do not add `onnxruntime-node` to `allowScripts`: its install script only fetches Linux GPU builds, and the Mac and Windows CPU binaries are inside the package.

- [ ] **Step 4: Write the stub**

Create `stubs/sharp/package.json`:

```json
{
  "name": "sharp",
  "version": "0.0.0-script-glow-stub",
  "description": "Empty stand-in for sharp. Script Glow never processes images, and this keeps the LGPL libvips binary out of the app.",
  "license": "MIT",
  "main": "index.js"
}
```

Create `stubs/sharp/index.js`:

```js
// transformers.js imports sharp when it loads but calls it only for images, which Script Glow never
// gives it. A call here means that changed, so it says so instead of failing somewhere obscure.
module.exports = function sharp() {
  throw new Error('Image processing is not available in Script Glow.');
};
```

The stub has its own `package.json` without `"type": "module"`, so `index.js` is CommonJS and `import sharp from 'sharp'` gets the function as its default export.

- [ ] **Step 5: Point sharp at the stub**

In `package.json`, add after the `allowScripts` block (keep the comma rules of JSON):

```json
  "overrides": {
    "sharp": "file:./stubs/sharp"
  }
```

Run:
```bash
npm install
ls node_modules/@img 2>/dev/null | grep -c sharp-libvips || true
node -e "import('@huggingface/transformers').then(m => console.log(typeof m.StyleTextToSpeech2Model))"
```
Expected: `npm install` succeeds; the `ls` count prints `0`; the last command prints `function`, which proves transformers.js loads with the stub.

- [ ] **Step 6: Run the license tests and see them pass**

Run: `node --test tests/licenses.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 7: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; the build ends without errors.

- [ ] **Step 8: Commit**

```bash
git add tests/licenses.test.js stubs/sharp package.json package-lock.json
git commit -m "build: add transformers.js with sharp stubbed out, and a license guard in npm test

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Model file download, voice list and cache identity

**Files:**
- Create: `server/kokoro/assets.js`
- Create: `tests/kokoro-assets.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `G2P_VERSION` from `server/kokoro/g2p.js` (Task 1); `renameRetry(from, to)` from `server/connections.js` (exists).
- Produces (all take a manifest object `{ version, tag, base, sources?, files: [{ path, size, sha256 }] }`, where `path` uses `/`):
  - `assetName(path: string): string`, the release asset name (`kokoro/voices/af_heart.bin` becomes `kokoro--voices--af_heart.bin`). Task 4's script uses it too.
  - `assetsReady(dir: string, manifest): Promise<boolean>`, true when every file is present at its full size.
  - `cacheIdentity(manifest): { model: string, g2p: string }`.
  - `voiceList(manifest): Array<{ id: string, label: string, gender: 'female' | 'male', accent: 'US' | 'UK' }>`, best rated first.
  - `createDownloader({ dir, manifest, fetchImpl = fetch, openFile = fs.promises.open })` returning `{ state(): { status: 'idle' | 'downloading' | 'ready' | 'error', received: number, total: number, error: string }, start(): Promise<void>, settled(): Promise<void>, remove(): Promise<void> }`. `start()` never rejects; failures land in `state().error` as a sentence for the actor. `remove()` rejects with `status: 409` while a download runs.
  - Task 4 adds `MANIFEST` to this file.

- [ ] **Step 1: Keep downloaded models out of git**

Add one line to `.gitignore`, after `.cache/`:

```
models/
```

- [ ] **Step 2: Write the failing tests**

Create `tests/kokoro-assets.test.js`. The fake release is a real HTTP server on this computer, so resume is tested with real `Range` requests.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assetName, assetsReady, cacheIdentity, createDownloader, voiceList } from '../server/kokoro/assets.js';

const bytes = (length, seed) => Buffer.from(Array.from({ length }, (_, i) => (i * 7 + seed) % 251));
const sha = data => createHash('sha256').update(data).digest('hex');
const FILES = { 'kokoro/onnx/model_fp16.onnx': bytes(300000, 1), 'kokoro/voices/af_heart.bin': bytes(5000, 2), 'g2p/us_gold.json': bytes(7000, 3) };
const MODEL = 'kokoro/onnx/model_fp16.onnx';
const manifestAt = base => ({ version: 1, tag: 'test', base, files: Object.entries(FILES).map(([file, data]) => ({ path: file, size: data.length, sha256: sha(data) })) });

// A fake release on this computer. cut: the first answer for the model stops after that many
// bytes. wrong: that file is served with other bytes. Every Range header asked for is kept.
async function release(t, { cut = 0, wrong = '' } = {}) {
  const ranges = [];
  let cutDone = false;
  const server = http.createServer((req, res) => {
    const found = Object.entries(FILES).find(([file]) => `/${assetName(file)}` === req.url);
    if (!found) { res.writeHead(404).end(); return; }
    let body = found[0] === wrong ? bytes(found[1].length, 99) : found[1];
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    if (range) { ranges.push(`${assetName(found[0])} ${req.headers.range}`); body = body.subarray(Number(range[1])); }
    res.writeHead(range ? 206 : 200, { 'Content-Length': body.length });
    if (cut && !cutDone && found[0] === MODEL) { cutDone = true; res.write(body.subarray(0, cut), () => setTimeout(() => res.destroy(), 100)); return; }
    res.end(body);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'script-glow-assets-'));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); });
  return { manifest: manifestAt(`http://127.0.0.1:${server.address().port}`), dir, ranges };
}

test('downloads every file, checks each hash, and only then says ready', async t => {
  const { manifest, dir } = await release(t);
  const download = createDownloader({ dir, manifest });
  assert.equal(await assetsReady(dir, manifest), false);
  assert.equal(download.start(), download.start(), 'A second start joins the running download');
  await download.start();
  assert.deepEqual(download.state(), { status: 'ready', received: 312000, total: 312000, error: '' });
  assert.equal(await assetsReady(dir, manifest), true);
  assert.deepEqual(await readFile(path.join(dir, MODEL)), FILES[MODEL]);
  await download.remove();
  assert.equal(await assetsReady(dir, manifest), false, 'Remove deletes the files');
});

test('an interrupted download is never used, and resumes where it stopped', async t => {
  const { manifest, dir, ranges } = await release(t, { cut: 100000 });
  const download = createDownloader({ dir, manifest });
  await download.start();
  assert.equal(download.state().status, 'error');
  assert.match(download.state().error, /internet connection/);
  assert.equal(await assetsReady(dir, manifest), false);
  const kept = (await stat(path.join(dir, `${MODEL}.part`))).size;
  assert.ok(kept > 0 && kept < FILES[MODEL].length, `A part of the model is kept (${kept} bytes)`);
  await download.start();
  assert.equal(download.state().status, 'ready', download.state().error);
  assert.deepEqual(ranges, [`${assetName(MODEL)} bytes=${kept}-`]);
  assert.deepEqual(await readFile(path.join(dir, MODEL)), FILES[MODEL]);
});

test('a file with the wrong hash is refused and removed', async t => {
  const { manifest, dir } = await release(t, { wrong: 'kokoro/voices/af_heart.bin' });
  const download = createDownloader({ dir, manifest });
  await download.start();
  assert.match(download.state().error, /damaged/);
  await assert.rejects(stat(path.join(dir, 'kokoro/voices/af_heart.bin')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(dir, 'kokoro/voices/af_heart.bin.part')), { code: 'ENOENT' });
  assert.equal(await assetsReady(dir, manifest), false);
});

test('a full disk says so, and no file is left looking finished', async t => {
  const { manifest, dir } = await release(t);
  const full = async (file, flags) => { const handle = await open(file, flags); return { appendFile: async () => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }); }, close: () => handle.close() }; };
  const download = createDownloader({ dir, manifest, openFile: full });
  await download.start();
  assert.match(download.state().error, /not enough free disk space/);
  await assert.rejects(stat(path.join(dir, MODEL)), { code: 'ENOENT' });
});

test('voices come from the voice files, best rated first, accent and gender from the name', () => {
  const list = voiceList({ files: ['bm_george', 'am_adam', 'af_heart', 'bf_emma'].map(name => ({ path: `kokoro/voices/${name}.bin`, size: 1, sha256: '' })) });
  assert.deepEqual(list.map(voice => voice.id), ['kokoro:af_heart', 'kokoro:bf_emma', 'kokoro:bm_george', 'kokoro:am_adam']);
  assert.deepEqual(list[0], { id: 'kokoro:af_heart', label: 'Heart', gender: 'female', accent: 'US' });
  assert.deepEqual(list[2], { id: 'kokoro:bm_george', label: 'George', gender: 'male', accent: 'UK' });
});

test('the cache identity changes with the model file and with any G2P file', () => {
  const manifest = manifestAt('https://example.invalid');
  const before = cacheIdentity(manifest);
  const model = structuredClone(manifest); model.files[0].sha256 = 'new';
  const words = structuredClone(manifest); words.files[2].sha256 = 'new';
  assert.notEqual(cacheIdentity(model).model, before.model);
  assert.notEqual(cacheIdentity(words).g2p, before.g2p);
  assert.match(before.g2p, /^misaki-js-1:/);
});
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `node --test tests/kokoro-assets.test.js`
Expected: FAIL, `Cannot find module '.../server/kokoro/assets.js'`.

- [ ] **Step 4: Write the downloader**

Create `server/kokoro/assets.js`. Check the voice grades in `RANK` against `VOICES.md` in hexgrad/Kokoro-82M when Task 4 pins its revision, and reorder if they changed.

```js
// The built-in voice files: which ones there are (manifest.json, written by
// scripts/kokoro-assets.mjs), whether they are all on this computer, and a download that resumes
// after an interruption and refuses any file whose SHA-256 does not match.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { renameRetry } from '../connections.js';
import { G2P_VERSION } from './g2p.js';

// Release assets have no folders, so kokoro/voices/af_heart.bin is published as kokoro--voices--af_heart.bin.
export const assetName = file => file.replaceAll('/', '--');
const sized = async (file, size) => { try { return (await stat(file)).size === size; } catch { return false; } };
// Every file present at its full size. A file only gets its real name after its hash matched.
export async function assetsReady(dir, manifest) {
  return (await Promise.all(manifest.files.map(file => sized(path.join(dir, file.path), file.size)))).every(Boolean);
}
// What the line cache key needs: a new model file or new G2P data never reuses old audio.
export function cacheIdentity(manifest) {
  return {
    model: manifest.files.find(file => file.path === 'kokoro/onnx/model_fp16.onnx')?.sha256 ?? '',
    g2p: [G2P_VERSION, ...manifest.files.filter(file => file.path.startsWith('g2p/')).map(file => file.sha256)].join(':'),
  };
}
// Best rated first, from the grades in hexgrad/Kokoro-82M VOICES.md, so casting reaches for them first.
const RANK = ['af_heart', 'af_bella', 'af_nicole', 'bf_emma', 'af_aoede', 'af_kore', 'af_sarah', 'am_fenrir', 'am_michael', 'am_puck', 'af_alloy', 'af_nova', 'bf_isabella', 'bm_fable', 'bm_george', 'af_sky', 'bm_lewis', 'af_jessica', 'af_river', 'am_echo', 'am_eric', 'am_liam', 'am_onyx', 'bf_alice', 'bf_lily', 'bm_daniel', 'am_santa', 'am_adam'];
// af_heart: a (US) or b (UK), f (female) or m (male), then the name.
export function voiceList(manifest) {
  const rank = name => { const at = RANK.indexOf(name); return at < 0 ? RANK.length : at; };
  return manifest.files.map(file => /^kokoro\/voices\/([ab][fm]_[a-z]+)\.bin$/.exec(file.path)?.[1]).filter(Boolean)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(name => ({ id: `kokoro:${name}`, label: name[3].toUpperCase() + name.slice(4), gender: name[1] === 'f' ? 'female' : 'male', accent: name[0] === 'a' ? 'US' : 'UK' }));
}

const said = error => error.code === 'ENOSPC' ? 'There is not enough free disk space for the built-in voices. Free some space, then press Try again.'
  : error.damaged ? 'A downloaded file was damaged on the way. Press Try again.'
  : 'The download stopped. Check this computer\'s internet connection, then press Try again.';

// openFile is there for the tests, which stand in a full disk.
export function createDownloader({ dir, manifest, fetchImpl = fetch, openFile = open }) {
  const total = manifest.files.reduce((sum, file) => sum + file.size, 0);
  let state = { status: 'idle', received: 0, total, error: '' };
  let running = null;
  async function fetchOne(file) {
    const final = path.join(dir, file.path), part = `${final}.part`;
    if (await sized(final, file.size)) { state.received += file.size; return; }
    await mkdir(path.dirname(final), { recursive: true });
    let have = 0;
    try { have = (await stat(part)).size; } catch { /* nothing yet */ }
    if (have > file.size) { await unlink(part); have = 0; }
    let hash = createHash('sha256');
    if (have) for await (const chunk of createReadStream(part)) hash.update(chunk);
    state.received += have;
    if (have < file.size) {
      // A connection that goes quiet for 30 seconds counts as dropped.
      const quiet = new AbortController();
      let timer = setTimeout(() => quiet.abort(), 30000);
      try {
        const response = await fetchImpl(`${manifest.base}/${assetName(file.path)}`, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: quiet.signal });
        if (response.status !== 200 && response.status !== 206) throw new Error(`HTTP ${response.status}`);
        // The server ignored the range and sent the whole file, so the part is started again.
        if (have && response.status === 200) { await unlink(part); state.received -= have; have = 0; hash = createHash('sha256'); }
        const handle = await openFile(part, 'a');
        try {
          for await (const chunk of response.body) {
            clearTimeout(timer); timer = setTimeout(() => quiet.abort(), 30000);
            await handle.appendFile(chunk);
            hash.update(chunk); state.received += chunk.length;
          }
        } finally { await handle.close(); }
      } finally { clearTimeout(timer); }
    }
    if ((await stat(part)).size !== file.size || hash.digest('hex') !== file.sha256) {
      await unlink(part);
      throw Object.assign(new Error(`${file.path} does not match its checksum`), { damaged: true });
    }
    await renameRetry(part, final);
  }
  return {
    state: () => ({ ...state }),
    // Starting again while a download runs joins it. A failed file keeps its .part to resume from.
    start() {
      if (!running) {
        state = { status: 'downloading', received: 0, total, error: '' };
        running = (async () => {
          try { for (const file of manifest.files) await fetchOne(file); state.status = 'ready'; }
          catch (error) { state = { ...state, status: 'error', error: said(error) }; }
        })().finally(() => { running = null; });
      }
      return running;
    },
    // Resolves once no download is running, so a render can wait for the files.
    settled: () => running ?? Promise.resolve(),
    async remove() {
      if (running) throw Object.assign(new Error('The voices are still downloading. Wait for the download to finish, then remove them.'), { status: 409 });
      await rm(dir, { recursive: true, force: true });
      state = { status: 'idle', received: 0, total, error: '' };
    },
  };
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --test tests/kokoro-assets.test.js`
Expected: PASS, 6 tests. Run it three times; the resume test must pass every time.

- [ ] **Step 6: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; the build ends without errors.

- [ ] **Step 7: Commit**

```bash
git add server/kokoro/assets.js tests/kokoro-assets.test.js .gitignore
git commit -m "feat: resumable, hash-checked download of the built-in voice files

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The model files, their manifest, and the release gate file

This task prepares the files the app downloads, pins where each came from, and writes `server/kokoro/manifest.json`. **Uploading them is Step 10, and only Mariano does it.** Tasks 5 to 8 work from the local folder this task fills; only the CI end-to-end job in Task 9 needs the upload.

**Files:**
- Create: `scripts/kokoro-assets.mjs`, `scripts/kokoro-bart-export.py`
- Create: `server/kokoro/manifest.json` (generated), `server/kokoro/release-gate.json`
- Create: `verification/kokoro-g2p.mjs`
- Modify: `server/kokoro/assets.js` (add `MANIFEST`), `tests/kokoro-assets.test.js`

**Interfaces:**
- Consumes: `assetName` (Task 3), `loadG2P` (Task 1), `tests/fixtures/g2p-lines.json` (Task 1).
- Produces:
  - `MANIFEST` exported from `server/kokoro/assets.js`: `{ version: 1, tag: 'kokoro-assets-v1', base: 'https://github.com/Mariano215/script-glow/releases/download/kokoro-assets-v1', sources: { kokoro: { repo, revision }, misaki: { repo, revision }, bart_us: { repo, revision }, bart_gb: { repo, revision } }, files: [{ path, size, sha256 }] }` with 42 files: `kokoro/config.json`, `kokoro/tokenizer.json`, `kokoro/tokenizer_config.json`, `kokoro/onnx/model_fp16.onnx`, 28 `kokoro/voices/<name>.bin`, `g2p/{us,gb}_{gold,silver}.json`, `g2p/bart_{enc,dec}_{us,gb}.onnx`, `g2p/bart_{us,gb}.json`.
  - A local folder with exactly that layout. This plan calls it `$KOKORO_FILES`; use `export KOKORO_FILES="$HOME/script-glow-kokoro-assets/kokoro-v1"`. Tasks 5 and 9 read it.
  - `server/kokoro/release-gate.json`: `{ "misakiProvenanceCleared": false, "evidence": "" }`. Task 9's release step reads it.

- [ ] **Step 1: Write the fetch, manifest and stage script**

Create `scripts/kokoro-assets.mjs`:

```js
// Prepares the built-in voice files for the kokoro-assets-v1 GitHub release. Nothing here uploads.
//   node scripts/kokoro-assets.mjs fetch <dir>        the Kokoro model, English voices, tokenizer and Misaki word lists
//   node scripts/kokoro-assets.mjs manifest <dir>     writes server/kokoro/manifest.json from what is in <dir>
//   node scripts/kokoro-assets.mjs stage <dir> <out>  copies every file under its release asset name, plus the license
// The BART fallback models come from scripts/kokoro-bart-export.py, run between fetch and manifest.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assetName } from '../server/kokoro/assets.js';

const TAG = 'kokoro-assets-v1';
const KOKORO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// The 28 English voices: a is US, b is UK; f is female, m is male.
const VOICES = ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'];
const [command, dir, out] = process.argv.slice(2);
if (!dir || !['fetch', 'manifest', 'stage'].includes(command) || (command === 'stage' && !out)) {
  console.error('Usage: node scripts/kokoro-assets.mjs fetch <dir> | manifest <dir> | stage <dir> <out>');
  process.exit(1);
}
const json = async url => { const response = await fetch(url); if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response.json(); };
async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  console.log(`${file} ${(await stat(file)).size} bytes`);
}
async function sha256(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
// Every file under dir except sources.json, as paths with forward slashes, sorted.
async function listFiles() {
  const names = await readdir(dir, { recursive: true });
  const files = [];
  for (const name of names) if ((await stat(path.join(dir, name))).isFile() && name !== 'sources.json') files.push(name.split(path.sep).join('/'));
  return files.sort();
}

if (command === 'fetch') {
  // Each source is pinned to the commit it had today, and the commit is kept in sources.json.
  const kokoroRevision = (await json(`https://huggingface.co/api/models/${KOKORO}`)).sha;
  for (const name of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_fp16.onnx', ...VOICES.map(voice => `voices/${voice}.bin`)])
    await download(`https://huggingface.co/${KOKORO}/resolve/${kokoroRevision}/${name}`, path.join(dir, 'kokoro', name));
  const misakiRevision = (await json('https://api.github.com/repos/hexgrad/misaki/commits/main')).sha;
  for (const name of ['us_gold', 'us_silver', 'gb_gold', 'gb_silver'])
    await download(`https://raw.githubusercontent.com/hexgrad/misaki/${misakiRevision}/misaki/data/${name}.json`, path.join(dir, 'g2p', `${name}.json`));
  await writeFile(path.join(dir, 'sources.json'), `${JSON.stringify({ kokoro: { repo: KOKORO, revision: kokoroRevision }, misaki: { repo: 'hexgrad/misaki', revision: misakiRevision } }, null, 1)}\n`);
  console.log(`Fetched. Next: export the BART fallback into ${path.join(dir, 'g2p')} (scripts/kokoro-bart-export.py).`);
}
if (command === 'manifest') {
  const sources = JSON.parse(await readFile(path.join(dir, 'sources.json'), 'utf8'));
  for (const accent of ['us', 'gb']) sources[`bart_${accent}`] = JSON.parse(await readFile(path.join(dir, 'g2p', `bart_${accent}.json`), 'utf8')).source;
  const files = [];
  for (const file of await listFiles()) files.push({ path: file, size: (await stat(path.join(dir, file))).size, sha256: await sha256(path.join(dir, file)) });
  const manifest = { version: 1, tag: TAG, base: `https://github.com/Mariano215/script-glow/releases/download/${TAG}`, sources, files };
  await writeFile(new URL('../server/kokoro/manifest.json', import.meta.url), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`server/kokoro/manifest.json: ${files.length} files, ${Math.round(files.reduce((sum, file) => sum + file.size, 0) / 1e6)} MB`);
}
if (command === 'stage') {
  const manifest = JSON.parse(await readFile(new URL('../server/kokoro/manifest.json', import.meta.url), 'utf8'));
  await mkdir(out, { recursive: true });
  for (const file of manifest.files) {
    if (await sha256(path.join(dir, file.path)) !== file.sha256) throw new Error(`${file.path} does not match server/kokoro/manifest.json`);
    await copyFile(path.join(dir, file.path), path.join(out, assetName(file.path)));
  }
  // Apache-2.0 asks for the license text next to what is redistributed.
  await copyFile(new URL('../node_modules/@huggingface/transformers/LICENSE', import.meta.url), path.join(out, 'LICENSE-Apache-2.0.txt'));
  console.log(`Staged ${manifest.files.length + 1} files in ${out}`);
}
```

- [ ] **Step 2: Write the BART export**

Create `scripts/kokoro-bart-export.py`. It is `docs/research/2026-09-19-kokoro/spike-code/bart/export.py`, pinned to each model's current commit and writing the names `g2p.js` reads:

```python
# Exports Misaki's BART fallback G2P (PeterReid/graphemes_to_phonemes_en_us and _gb, Apache-2.0) to
# ONNX for server/kokoro/g2p.js. Run once when preparing the built-in voice files; never at runtime.
#   uv run --no-project --with "torch==2.6.0" --with "transformers>=4.46,<5" --with onnx --with huggingface_hub \
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
```

- [ ] **Step 3: Fetch the Kokoro files and the word lists**

Run:
```bash
export KOKORO_FILES="$HOME/script-glow-kokoro-assets/kokoro-v1"
node scripts/kokoro-assets.mjs fetch "$KOKORO_FILES"
```
Expected: 36 lines of `<file> <n> bytes`: `onnx/model_fp16.onnx` about 163,000,000 bytes, each voice exactly 522,240 bytes (510 styles of 256 float32 values), the four word lists about 5 to 6 MB each; then `Fetched. Next: export the BART fallback ...`. `$KOKORO_FILES/sources.json` names both revisions.

- [ ] **Step 4: Export the BART fallback**

Run:
```bash
uv run --no-project --with "torch==2.6.0" --with "transformers>=4.46,<5" --with onnx --with huggingface_hub \
  python scripts/kokoro-bart-export.py "$KOKORO_FILES/g2p"
ls "$KOKORO_FILES/g2p"
```
Expected: `us: exported PeterReid/graphemes_to_phonemes_en_us at <40-hex sha>` and the same for `gb`; the folder lists `bart_dec_gb.onnx bart_dec_us.onnx bart_enc_gb.onnx bart_enc_us.onnx bart_gb.json bart_us.json gb_gold.json gb_silver.json us_gold.json us_silver.json`, each ONNX file about 1.5 MB. If the Anaconda Python is picked up and fails with `numpy.core.multiarray failed to import`, the spike's fix applies: `uv` with `--no-project` uses its own clean environment, so run the command exactly as written.

- [ ] **Step 5: Check the 20 lines through the real word lists**

Run: `node verification/kokoro-g2p.mjs "$KOKORO_FILES/g2p"` after creating it:

```js
// The 20 actor lines through the real word lists and the BART fallback, which must give what the
// spike gave (tests/fixtures/g2p-lines.json). Also prints one line through the UK word lists.
// Usage: node verification/kokoro-g2p.mjs <models>/kokoro-v1/g2p
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadG2P } from '../server/kokoro/g2p.js';

const dir = process.argv[2];
assert.ok(dir, 'Usage: node verification/kokoro-g2p.mjs <folder with us_gold.json and bart_enc_us.onnx>');
const lines = JSON.parse(readFileSync(new URL('../tests/fixtures/g2p-lines.json', import.meta.url), 'utf8'));
const g2p = await loadG2P(dir);
let different = 0;
for (const { text, phonemes } of lines) {
  const got = await g2p(text);
  if (got !== phonemes) { different++; console.log(`DIFFERENT: ${text}\n  spike: ${phonemes}\n  now:   ${got}`); }
}
assert.equal(different, 0, `${different} of ${lines.length} lines differ from the spike`);
console.log('UK:', await (await loadG2P(dir, { british: true }))('Tomorrow, and tomorrow, and tomorrow.'));
console.log(`PASS: all ${lines.length} lines match through the real word lists and the BART fallback.`);
```

Expected: a `UK:` line of phonemes, then `PASS: all 20 lines match through the real word lists and the BART fallback.` If a line is `DIFFERENT`, Misaki's word lists changed since the spike. Stop and show Mariano the differences; change `tests/fixtures/g2p-lines.json` only with his agreement.

- [ ] **Step 6: Write the manifest**

Run: `node scripts/kokoro-assets.mjs manifest "$KOKORO_FILES"`
Expected: `server/kokoro/manifest.json: 42 files, 19x MB` (the spec's estimate was about 185 MB; the Settings copy in Task 7 shows the real number from the manifest).

- [ ] **Step 7: Write the failing manifest test**

Add to `tests/kokoro-assets.test.js`: extend the import line to `import { MANIFEST, assetName, assetsReady, cacheIdentity, createDownloader, voiceList } from '../server/kokoro/assets.js';` and add at the end:

```js
test('the shipped manifest lists all 42 files, hashed, from the pinned release', () => {
  assert.equal(MANIFEST.tag, 'kokoro-assets-v1');
  assert.equal(MANIFEST.base, 'https://github.com/Mariano215/script-glow/releases/download/kokoro-assets-v1');
  assert.equal(MANIFEST.files.length, 42);
  assert.ok(MANIFEST.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && file.size > 0));
  assert.equal(voiceList(MANIFEST).length, 28);
  for (const needed of ['kokoro/onnx/model_fp16.onnx', 'kokoro/config.json', 'kokoro/tokenizer.json', 'kokoro/tokenizer_config.json', 'g2p/us_gold.json', 'g2p/us_silver.json', 'g2p/gb_gold.json', 'g2p/gb_silver.json', 'g2p/bart_enc_us.onnx', 'g2p/bart_dec_us.onnx', 'g2p/bart_us.json', 'g2p/bart_enc_gb.onnx', 'g2p/bart_dec_gb.onnx', 'g2p/bart_gb.json'])
    assert.ok(MANIFEST.files.some(file => file.path === needed), needed);
  for (const source of ['kokoro', 'misaki', 'bart_us', 'bart_gb']) assert.match(MANIFEST.sources[source].revision, /^[a-f0-9]{40}$/, source);
});
```

Run: `node --test tests/kokoro-assets.test.js`
Expected: FAIL, `The requested module '../server/kokoro/assets.js' does not provide an export named 'MANIFEST'`.

- [ ] **Step 8: Export the manifest, and add the release gate file**

In `server/kokoro/assets.js`, change `import { createReadStream } from 'node:fs';` to `import { createReadStream, readFileSync } from 'node:fs';`, and after the `assetName` line add:

```js
// The files of the kokoro-assets-v1 release. Written by `node scripts/kokoro-assets.mjs manifest`.
export const MANIFEST = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
```

Create `server/kokoro/release-gate.json`. Mariano sets it to `true`, with a link to the answer in `evidence`, only once hexgrad confirms the word lists are permissive:

```json
{
  "misakiProvenanceCleared": false,
  "evidence": ""
}
```

Run: `node --test tests/kokoro-assets.test.js && npm test && npm run build`
Expected: 7 tests pass in the file; the whole suite and the build pass.

- [ ] **Step 9: Commit**

```bash
git add scripts/kokoro-assets.mjs scripts/kokoro-bart-export.py server/kokoro/manifest.json server/kokoro/release-gate.json server/kokoro/assets.js tests/kokoro-assets.test.js verification/kokoro-g2p.mjs
git commit -m "feat: pinned manifest of the built-in voice files, and the scripts that make them

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 10: MANUAL GATE (Mariano only): publish the files**

An agent runs only the first command, which stages the files locally, and then stops and hands over:

```bash
node scripts/kokoro-assets.mjs stage "$KOKORO_FILES" "$KOKORO_FILES-release"
```
Expected: `Staged 43 files in .../kokoro-v1-release` (42 assets and `LICENSE-Apache-2.0.txt`).

**Stop here.** The upload publishes to the public repository, and it redistributes the Misaki word lists whose provenance is the open release-gate question. Mariano decides when to run it:

```bash
gh release create kokoro-assets-v1 --repo Mariano215/script-glow --prerelease --latest=false \
  --title "Built-in voice files v1" \
  --notes "Model files that Script Glow downloads on first use for its built-in voices: Kokoro-82M v1.0 (hexgrad, Apache-2.0), Misaki English word lists (hexgrad/misaki, Apache-2.0), and Misaki's grapheme-to-phoneme fallback models (PeterReid, Apache-2.0, exported to ONNX). Revisions are in server/kokoro/manifest.json. Not an app release." \
  "$KOKORO_FILES-release"/*
gh variable set KOKORO_ASSETS_PUBLISHED --body true --repo Mariano215/script-glow
curl -sL "https://github.com/Mariano215/script-glow/releases/download/kokoro-assets-v1/kokoro--config.json" | shasum -a 256
node -p "require('./server/kokoro/manifest.json').files.find(f => f.path === 'kokoro/config.json').sha256"
```
Expected: the two hashes printed last are the same. `--prerelease --latest=false` matter: electron-updater reads the latest release to find app updates, and this one must never be it.

---

### Task 5: The worker and its client

**Files:**
- Create: `server/kokoro/worker.js`, `server/kokoro/client.js`
- Create: `tests/kokoro-client.test.js`, `tests/fixtures/fake-kokoro-worker.js`
- Create: `verification/kokoro-speak.mjs`, `verification/no-espeak-hook.mjs`

**Interfaces:**
- Consumes: `loadG2P` (Task 1); transformers.js (Task 2); the file layout of `$KOKORO_FILES` (Task 4).
- Produces:
  - `WORKER_FILE: string`, the worker path, with `app.asar` swapped for `app.asar.unpacked` in the packed app.
  - `createKokoroClient({ workerFile = WORKER_FILE, args = [], timeoutMs = 60000, idleMs = 600000 } = {})` returning `{ speak(voice: string, text: string): Promise<Buffer>, stop(): void }`. `voice` is the bare name (`af_heart`). The Buffer is 16-bit mono PCM at 24 kHz. Errors carry `status` (502, or 504 for the time limit) and a sentence for the actor. `args[0]` is the model folder.
  - The message protocol, for any worker: in `{ id: number, voice: string, text: string }`; out `{ id, pcm: Uint8Array }` or `{ id, error: string }`. `tests/fixtures/fake-kokoro-worker.js` speaks it too, and Tasks 6 and 7 use that fake. It logs `voice|text` per request to `<args[0]>/calls.log`.

- [ ] **Step 1: Write the fake worker**

Create `tests/fixtures/fake-kokoro-worker.js`:

```js
// Stands in for server/kokoro/worker.js in tests: the same messages, no model. The text decides
// what happens: "hang" never answers, "crash" exits, "crash-once" exits only the first time,
// "fail" answers with an error, "slow ..." takes a moment. Every request is logged to calls.log in
// the folder given as the first argument. The audio carries this process id and what was asked.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const port = process.parentPort;
const reply = message => port ? port.postMessage(message) : process.send(message);
let busy = false;
async function handle({ id, voice, text }) {
  appendFileSync(path.join(dir, 'calls.log'), `${voice}|${text}\n`);
  if (busy) { reply({ id, error: 'Two requests at once.' }); return; }
  busy = true;
  if (text === 'hang') return;
  if (text === 'crash') process.exit(3);
  if (text === 'crash-once' && !existsSync(path.join(dir, 'crashed'))) { writeFileSync(path.join(dir, 'crashed'), ''); process.exit(3); }
  if (text.startsWith('slow')) await new Promise(resolve => setTimeout(resolve, 200));
  busy = false;
  if (text === 'fail') { reply({ id, error: 'The model could not read this line.' }); return; }
  const pcm = Buffer.alloc(4800), said = Buffer.from(`${voice}|${text}`);
  pcm.writeInt32LE(process.pid, 0); pcm.writeInt32LE(said.length, 4); said.copy(pcm, 8);
  reply({ id, pcm: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length) });
}
if (port) port.on('message', event => handle(event.data)); else process.on('message', handle);
process.on('disconnect', () => process.exit(0));
```

- [ ] **Step 2: Write the failing tests**

Create `tests/kokoro-client.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKokoroClient } from '../server/kokoro/client.js';

const workerFile = fileURLToPath(new URL('./fixtures/fake-kokoro-worker.js', import.meta.url));
async function client(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'script-glow-kokoro-client-'));
  const made = createKokoroClient({ workerFile, args: [dir], ...options });
  t.after(async () => { made.stop(); await rm(dir, { recursive: true, force: true }); });
  return made;
}
// The fake worker's audio starts with its process id, then what it was asked to say.
const pid = pcm => pcm.readInt32LE(0);
const said = pcm => pcm.subarray(8, 8 + pcm.readInt32LE(4)).toString();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('lines are spoken one at a time, in the order asked, by one worker', async t => {
  const voices = await client(t);
  const results = await Promise.all([voices.speak('af_heart', 'slow first'), voices.speak('af_heart', 'second'), voices.speak('bm_george', 'third')]);
  assert.deepEqual(results.map(said), ['af_heart|slow first', 'af_heart|second', 'bm_george|third']);
  assert.equal(new Set(results.map(pid)).size, 1);
});

test('a line over the time limit fails with a plain message, and the next line still works', async t => {
  const voices = await client(t, { timeoutMs: 300 });
  await assert.rejects(voices.speak('af_heart', 'hang'), /more than 0.3 seconds on one line/);
  assert.equal(said(await voices.speak('af_heart', 'after')), 'af_heart|after');
});

test('a crash restarts the worker once and retries the line; a second crash fails it', async t => {
  const voices = await client(t);
  const before = await voices.speak('af_heart', 'before');
  const retried = await voices.speak('af_heart', 'crash-once');
  assert.equal(said(retried), 'af_heart|crash-once');
  assert.notEqual(pid(retried), pid(before), 'A new worker spoke the retried line');
  await assert.rejects(voices.speak('af_heart', 'crash'), /stopped twice on this line/);
  assert.equal(said(await voices.speak('af_heart', 'again')), 'af_heart|again');
});

test('an error from the worker is passed on and not retried', async t => {
  const voices = await client(t);
  await assert.rejects(voices.speak('af_heart', 'fail'), /could not read this line/);
});

test('an idle worker is stopped, and the next line starts a new one', async t => {
  const voices = await client(t, { idleMs: 200 });
  const first = pid(await voices.speak('af_heart', 'one'));
  await pause(600);
  assert.throws(() => process.kill(first, 0), { code: 'ESRCH' }, 'The idle worker has exited');
  assert.notEqual(pid(await voices.speak('af_heart', 'two')), first);
});
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `node --test tests/kokoro-client.test.js`
Expected: FAIL, `Cannot find module '.../server/kokoro/client.js'`.

- [ ] **Step 4: Write the client**

Create `server/kokoro/client.js`:

```js
// Starts the Kokoro worker (worker.js) on first use and sends it one line at a time, in order.
// A line that takes more than 60 seconds fails. A crashed worker is started again once and the
// line retried. After 10 minutes without a request the worker is stopped, so its memory goes back.
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Set only in the desktop app's main process. The RunAsNode fuse is off there, so the worker is an
// Electron utility process, the same way as the PDF worker in app.js.
const utilityProcess = process.versions.electron && process.type === 'browser' ? (await import('electron')).utilityProcess : null;
// The worker and every package it imports are unpacked from app.asar (desktop/builder.cjs).
export const WORKER_FILE = fileURLToPath(new URL('./worker.js', import.meta.url)).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const failure = (message, extra = {}) => Object.assign(new Error(message), { status: 502, ...extra });
// Workers still running when the app quits go with it.
const live = new Set();
process.once('exit', () => { for (const child of live) child.kill(); });

function spawn(file, args) {
  if (utilityProcess) return utilityProcess.fork(file, args, { stdio: 'ignore', serviceName: 'Script Glow built-in voices' });
  const child = fork(file, args, { serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
  // A send to a worker that just died shows up as its exit, not as an unhandled error.
  child.on('error', () => {});
  // An idle worker does not keep the server process alive; it exits when its parent does.
  child.unref(); child.channel?.unref();
  return child;
}
const deliver = (child, message) => utilityProcess ? child.postMessage(message) : child.connected && child.send(message);

export function createKokoroClient({ workerFile = WORKER_FILE, args = [], timeoutMs = 60000, idleMs = 10 * 60000 } = {}) {
  let child = null, idle = null, nextId = 1, queue = Promise.resolve();
  function stop() {
    clearTimeout(idle);
    const running = child; child = null;
    running?.kill();
  }
  function worker() {
    if (!child) {
      const started = child = spawn(workerFile, args);
      live.add(started);
      started.on('exit', () => { live.delete(started); if (child === started) child = null; });
    }
    return child;
  }
  function once(voice, text) {
    return new Promise((resolve, reject) => {
      const running = worker(), id = nextId++;
      const finish = (settle, value) => { clearTimeout(timer); running.off('message', onMessage); running.off('exit', onExit); settle(value); };
      const onMessage = message => {
        if (message?.id !== id) return;
        if (message.error) finish(reject, failure(message.error));
        else finish(resolve, Buffer.from(message.pcm.buffer, message.pcm.byteOffset, message.pcm.byteLength));
      };
      const onExit = () => finish(reject, failure('Built-in voices stopped unexpectedly.', { crashed: true }));
      const timer = setTimeout(() => {
        finish(reject, failure(`Built-in voices took more than ${timeoutMs / 1000} seconds on one line. Try again, or split the line.`, { status: 504 }));
        stop();
      }, timeoutMs);
      running.on('message', onMessage);
      running.on('exit', onExit);
      deliver(running, { id, voice, text });
    });
  }
  async function attempt(voice, text) {
    clearTimeout(idle);
    try { return await once(voice, text); }
    catch (error) {
      if (!error.crashed) throw error;
      // One crash can be bad luck, such as a moment of low memory. A second one on the same line is not.
      return once(voice, text).catch(again => { throw again.crashed ? failure('Built-in voices stopped twice on this line. Restart Script Glow and try again.') : again; });
    }
  }
  return {
    // voice is the name without its engine prefix (af_heart). Resolves to 16-bit mono PCM at 24 kHz.
    speak(voice, text) {
      const run = queue.then(() => attempt(voice, text));
      const rest = () => { clearTimeout(idle); idle = setTimeout(stop, idleMs); idle.unref?.(); };
      queue = run.then(rest, rest);
      return run;
    },
    stop,
  };
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --test tests/kokoro-client.test.js`
Expected: PASS, 5 tests, in about 2 seconds, and the command returns (no worker keeps it alive).

- [ ] **Step 6: Write the worker**

Create `server/kokoro/worker.js`:

```js
// Runs Kokoro-82M and the G2P for client.js, one line at a time, in order. The files come from the
// folder in argv[2] (downloaded by assets.js); nothing is fetched from the network. speak() does
// what kokoro-js's generate_from_ids does (Apache-2.0) without kokoro-js, which imports the
// espeak-ng phonemizer (GPL).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AutoTokenizer, StyleTextToSpeech2Model, Tensor, env } from '@huggingface/transformers';
import { loadG2P } from './g2p.js';

const dir = process.argv[2];
env.allowRemoteModels = false;
env.localModelPath = `${dir}${path.sep}`;
let model = null;
const g2ps = new Map(), styles = new Map();
const once = (map, key, make) => { if (!map.has(key)) map.set(key, make()); return map.get(key); };

async function speak(voice, text) {
  if (!/^[ab][fm]_[a-z]+$/.test(voice)) throw new Error('that is not a built-in voice');
  model ??= Promise.all([StyleTextToSpeech2Model.from_pretrained('kokoro', { dtype: 'fp16', device: 'cpu' }), AutoTokenizer.from_pretrained('kokoro')]);
  const [tts, tokenizer] = await model;
  // Voices whose names start with b are British and read with the British word lists.
  const g2p = await once(g2ps, voice[0], () => loadG2P(path.join(dir, 'g2p'), { british: voice[0] === 'b' }));
  const style = await once(styles, voice, async () => {
    const bytes = await readFile(path.join(dir, 'kokoro', 'voices', `${voice}.bin`));
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  });
  const { input_ids } = tokenizer(await g2p(text), { truncation: true });
  // A voice holds one 256-value style for each input length; the one for this line's length is used.
  const at = Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509) * 256;
  const { waveform } = await tts({ input_ids, style: new Tensor('float32', style.slice(at, at + 256), [1, 256]), speed: new Tensor('float32', [1], [1]) });
  // 24 kHz float samples to the app's 16-bit PCM at the same rate.
  const pcm = Buffer.alloc(waveform.data.length * 2);
  for (let i = 0; i < waveform.data.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(waveform.data[i] * 32767))), i * 2);
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length);
}

// The desktop app starts this file as an Electron utility process (messages on process.parentPort);
// plain Node forks it with child_process.
const port = process.parentPort;
const reply = message => port ? port.postMessage(message) : process.send(message);
let queue = Promise.resolve();
function receive({ id, voice, text }) {
  queue = queue.then(async () => {
    try { reply({ id, pcm: await speak(voice, text) }); }
    catch (error) { reply({ id, error: `Built-in voices could not read this line: ${error.message}` }); }
  });
}
if (port) port.on('message', event => receive(event.data)); else process.on('message', receive);
// Under plain Node the worker goes when the server does.
process.on('disconnect', () => process.exit(0));
```

- [ ] **Step 7: Speak with the real model, and prove espeak never loads**

Create `verification/no-espeak-hook.mjs`:

```js
// Fails any import of espeak-ng or of the packages that carry it (GPL). Loaded through NODE_OPTIONS,
// so it also runs inside the worker process. Used with verification/kokoro-speak.mjs.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (/node_modules\/(phonemizer|espeak[^/]*|kokoro-js)\//.test(result.url)) throw new Error(`GPL code was loaded: ${result.url}`);
    return result;
  },
});
```

Create `verification/kokoro-speak.mjs`:

```js
// Speaks three lines with the real worker and model files, in US and UK voices, and saves them as
// WAV files to listen to. Run it with the hook, which fails the run if espeak-ng is ever loaded:
//   NODE_OPTIONS="--import ./verification/no-espeak-hook.mjs" node verification/kokoro-speak.mjs <models>/kokoro-v1
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeWav, SAMPLE_RATE } from '../server/audio.js';
import { createKokoroClient } from '../server/kokoro/client.js';

const dir = process.argv[2];
assert.ok(dir, 'Usage: node verification/kokoro-speak.mjs <models>/kokoro-v1');
const voices = createKokoroClient({ args: [path.resolve(dir)] });
const out = mkdtempSync(path.join(os.tmpdir(), 'script-glow-kokoro-speak-'));
const lines = [['af_heart', "I'd've told you, if you'd asked."], ['bm_george', 'Tomorrow, and tomorrow, and tomorrow.'], ['am_michael', 'Meet me at 3:15, not a minute later.']];
for (const [i, [voice, text]] of lines.entries()) {
  const started = performance.now();
  const pcm = await voices.speak(voice, text);
  const seconds = pcm.length / 2 / SAMPLE_RATE;
  assert.ok(seconds > 0.5 && seconds < 15, `${voice} made ${seconds} s of audio`);
  const file = path.join(out, `${i + 1}-${voice}.wav`);
  writeFileSync(file, encodeWav(pcm));
  console.log(`${voice}: ${seconds.toFixed(2)} s of audio in ${((performance.now() - started) / 1000).toFixed(2)} s, ${file}`);
}
voices.stop();
console.log('PASS: the real worker spoke US and UK voices, and nothing loaded espeak-ng.');
```

Run: `NODE_OPTIONS="--import ./verification/no-espeak-hook.mjs" node verification/kokoro-speak.mjs "$KOKORO_FILES"`
Expected: three lines such as `af_heart: 2.10 s of audio in 1.9 s, /tmp/.../1-af_heart.wav` (the first includes loading the model, the others well under 1 s on an Apple M2 Pro), then `PASS: the real worker spoke US and UK voices, and nothing loaded espeak-ng.` Play the three WAV files: the UK line must sound British, and "3:15" must be "three fifteen".

- [ ] **Step 8: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; the build ends without errors.

- [ ] **Step 9: Commit**

```bash
git add server/kokoro/worker.js server/kokoro/client.js tests/kokoro-client.test.js tests/fixtures/fake-kokoro-worker.js verification/kokoro-speak.mjs verification/no-espeak-hook.mjs
git commit -m "feat: Kokoro worker process with an ordered queue, time limit, crash restart and idle stop

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The `kokoro` engine in the server

**Files:**
- Modify: `server/connections.js:9` and `server/connections.js:18`
- Modify: `server/app.js` (imports, `createApp` options, engine helpers, `/api/connections/test`, `getVoices`, `/api/health`, `/api/voices/preview`, `lineAudio`, `renderTracks`, new `/api/kokoro` routes)
- Create: `tests/kokoro-engine.test.js`

**Interfaces:**
- Consumes: `MANIFEST`, `assetsReady`, `cacheIdentity`, `createDownloader`, `voiceList` (Tasks 3 and 4); `WORKER_FILE`, `createKokoroClient` (Task 5); `tests/fixtures/fake-kokoro-worker.js` (Task 5).
- Produces:
  - `VOICE_ENGINES` includes `'kokoro'`.
  - `createApp({ ..., modelsDir = <HOME>/models/kokoro-v1, kokoro: { manifest = MANIFEST, fetch = globalThis.fetch, workerFile = WORKER_FILE } = {} })`. Tests and browser checks pass fakes through `kokoro`.
  - `GET /api/kokoro` and `POST /api/kokoro/download` (202) answer `{ status: 'idle' | 'downloading' | 'ready' | 'error', received: number, total: number, error: string, ready: boolean }`; `DELETE /api/kokoro` removes the files (409 while audio is being made) and answers the same shape. Task 7's page reads exactly this shape as `KokoroState`.
  - `GET /api/voices` with the kokoro engine: `{ engine: 'kokoro', voices: ['kokoro:af_heart', ...], details: { 'kokoro:af_heart': { label, gender, accent } } }`.
  - `GET /api/health` `tts`: `{ ok: true, engine: 'kokoro' }` when the files are there or downloading.
  - A render that needs Kokoro while the files are missing fails its job with a message containing `Built-in voices are not downloaded`.

- [ ] **Step 1: Write the failing tests**

Create `tests/kokoro-engine.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS, validateConnections } from '../server/connections.js';

// Fake model files and the fake worker (tests/fixtures/fake-kokoro-worker.js), so no model runs.
const workerFile = fileURLToPath(new URL('./fixtures/fake-kokoro-worker.js', import.meta.url));
const FILES = { 'kokoro/onnx/model_fp16.onnx': Buffer.from('model v1'), 'kokoro/voices/af_heart.bin': Buffer.from('heart'), 'kokoro/voices/bm_george.bin': Buffer.from('george'), 'g2p/us_gold.json': Buffer.from('{}') };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestOf = files => ({ version: 1, tag: 'test', base: 'https://example.invalid/kokoro', files: Object.entries(files).map(([file, bytes]) => ({ path: file, size: bytes.length, sha256: sha(bytes) })) });
const post = (base, route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function kokoroServer(t, { downloaded = true, files = FILES, cacheDir } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-kokoro-engine-'));
  const modelsDir = path.join(temp, 'models');
  if (downloaded) for (const [file, bytes] of Object.entries(files)) { await mkdir(path.dirname(path.join(modelsDir, file)), { recursive: true }); await writeFile(path.join(modelsDir, file), bytes); }
  // The download is served from memory, so it works without the internet.
  const kokoroFetch = async url => { const found = Object.entries(files).find(([file]) => url.endsWith(`/${file.replaceAll('/', '--')}`)); return found ? new Response(found[1]) : new Response('missing', { status: 404 }); };
  const server = createApp({ cacheDir: cacheDir ?? path.join(temp, 'cache'), previewDir: path.join(temp, 'previews'), connectionsFile: path.join(temp, 'connections.json'), secretsFile: path.join(temp, 'secrets.json'), modelsDir,
    connections: { ...DEFAULT_CONNECTIONS, voice: { engine: 'kokoro', model: '' } }, serviceFetch: async url => { throw new Error(`no network in this test: ${url}`); },
    kokoro: { manifest: manifestOf(files), fetch: kokoroFetch, workerFile } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const calls = async () => (await readFile(path.join(modelsDir, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { base, calls };
}
async function render(base, body) {
  const { jobId } = await (await post(base, '/api/render', body)).json();
  for (let i = 0; i < 500; i++) {
    const job = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    if (['complete', 'error'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('The render did not finish');
}
const scene = (lines = [{ id: 'a', character: 'ME', text: 'I have the key.', kind: 'dialogue' }, { id: 'b', character: 'PARTNER', text: 'Then open it.', kind: 'dialogue' }]) =>
  ({ scene: { id: 's1', title: 'Kitchen', lines }, voices: { ME: 'kokoro:af_heart', PARTNER: 'kokoro:bm_george' }, myCharacter: 'ME', gapSeconds: 0, includeDirections: false });

test('built-in voices are local: no key, listed with gender and accent, and checked on this computer', async t => {
  assert.equal(validateConnections({ ...DEFAULT_CONNECTIONS, voice: { engine: 'kokoro', model: '' } }).voice.engine, 'kokoro');
  const { base } = await kokoroServer(t);
  assert.deepEqual((await (await fetch(`${base}/api/health`)).json()).tts, { ok: true, engine: 'kokoro' });
  const { engine, voices, details } = await (await fetch(`${base}/api/voices`)).json();
  assert.equal(engine, 'kokoro');
  assert.deepEqual(voices, ['kokoro:af_heart', 'kokoro:bm_george']);
  assert.deepEqual(details['kokoro:bm_george'], { label: 'George', gender: 'male', accent: 'UK' });
  const checked = await (await post(base, '/api/connections/test', { ...DEFAULT_CONNECTIONS, voice: { engine: 'kokoro', model: '' }, only: 'voice' })).json();
  assert.deepEqual([checked.results[0].ok, checked.results[0].detail], [true, 'Ready. 2 voices on this computer.']);
});

test('a render speaks each line once, reuses the line cache, and speaks the directions ahead like Chatterbox', async t => {
  const { base, calls } = await kokoroServer(t);
  const body = scene();
  body.scene.lines.splice(1, 0, { id: 'd', character: 'Narrator', text: 'She crosses to the door.', kind: 'direction' });
  body.directionVoice = 'kokoro:bm_george';
  const first = await render(base, body);
  assert.equal(first.status, 'complete', first.error);
  assert.equal(first.total, 3, 'The direction is spoken ahead, because it costs nothing');
  assert.deepEqual(await calls(), ['af_heart|I have the key.', 'bm_george|She crosses to the door.', 'bm_george|Then open it.']);
  assert.equal((await render(base, body)).status, 'complete');
  assert.equal((await calls()).length, 3, 'The second render comes from the line cache');
});

test('a new model file never reuses audio made with the old one', async t => {
  const shared = await mkdtemp(path.join(os.tmpdir(), 'script-glow-kokoro-cache-'));
  t.after(() => rm(shared, { recursive: true, force: true }));
  const before = await kokoroServer(t, { cacheDir: shared });
  assert.equal((await render(before.base, scene())).status, 'complete');
  const same = await kokoroServer(t, { cacheDir: shared });
  assert.equal((await render(same.base, scene())).status, 'complete');
  assert.deepEqual(await same.calls(), [], 'The same model reuses the cached lines');
  const updated = await kokoroServer(t, { cacheDir: shared, files: { ...FILES, 'kokoro/onnx/model_fp16.onnx': Buffer.from('model v2') } });
  assert.equal((await render(updated.base, scene())).status, 'complete');
  assert.equal((await updated.calls()).length, 2, 'Both lines are made again with the new model');
});

test('without the files a render says so; a download makes them ready, and a render waits for it', async t => {
  const { base, calls } = await kokoroServer(t, { downloaded: false });
  assert.deepEqual((await (await fetch(`${base}/api/kokoro`)).json()).ready, false);
  assert.equal((await (await fetch(`${base}/api/health`)).json()).tts.ok, false);
  const refused = await render(base, scene());
  assert.equal(refused.status, 'error');
  assert.match(refused.error, /Built-in voices are not downloaded/);
  assert.deepEqual(await calls(), []);
  assert.equal((await post(base, '/api/kokoro/download', {})).status, 202);
  const waited = await render(base, scene());
  assert.equal(waited.status, 'complete', waited.error);
  assert.equal((await (await fetch(`${base}/api/kokoro`)).json()).ready, true);
  const removed = await fetch(`${base}/api/kokoro`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).ready, false);
});

test('a preview is made on this computer, once', async t => {
  const { base, calls } = await kokoroServer(t);
  const { session } = await (await fetch(`${base}/api/session`)).json();
  const preview = await fetch(`${base}/api/voices/preview?voice=${encodeURIComponent('kokoro:af_heart')}&session=${session}`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /audio\/wav/);
  await fetch(`${base}/api/voices/preview?voice=${encodeURIComponent('kokoro:af_heart')}&session=${session}`);
  assert.deepEqual(await calls(), ['af_heart|Hello. This is how I sound when I read your scene with you.']);
});

test('a long speech reaches the model in pieces short enough for it', async t => {
  const { base, calls } = await kokoroServer(t);
  const speech = Array.from({ length: 20 }, (_, i) => `This is sentence number ${i + 1} of a long speech.`).join(' ');
  const job = await render(base, scene([{ id: 'a', character: 'ME', text: speech, kind: 'dialogue' }]));
  assert.equal(job.status, 'complete', job.error);
  const pieces = (await calls()).map(call => call.split('|')[1]);
  assert.ok(pieces.length >= 3 && pieces.every(piece => piece.length <= 350), pieces.map(piece => piece.length).join(', '));
  assert.equal(pieces.join(' '), speech);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test tests/kokoro-engine.test.js`
Expected: FAIL, all 6 tests, with `Choose a voice engine from the list` (the profile validator does not know `kokoro` yet).

- [ ] **Step 3: Let the profile choose Kokoro**

In `server/connections.js`:

1. Replace:

```js
export const VOICE_ENGINES = Object.freeze(['chatterbox', 'openai', 'gemini', 'elevenlabs']);
```

   with:

```js
export const VOICE_ENGINES = Object.freeze(['chatterbox', 'kokoro', 'openai', 'gemini', 'elevenlabs']);
```

2. Replace:

```js
  // Which engine speaks the cast. Chatterbox is local; the others are hosted and need a key.
```

   with:

```js
  // Which engine speaks the cast. Chatterbox and Kokoro (built in) are local; the others are hosted and need a key.
```

- [ ] **Step 4: Wire the engine into the server**

In `server/app.js`, make these replacements in order. Each `Replace` text appears exactly once in the file.

1. Replace:

```js
import { findFfmpeg } from './video.js';
```

   with:

```js
import { findFfmpeg } from './video.js';
import { MANIFEST, assetsReady, cacheIdentity, createDownloader, voiceList } from './kokoro/assets.js';
import { WORKER_FILE, createKokoroClient } from './kokoro/client.js';
```

2. Replace:

```js
serviceFetch = fetchBounded, firstRunScreen = false } = {}) {
```

   with:

```js
serviceFetch = fetchBounded, firstRunScreen = false, modelsDir = path.join(HOME, 'models', 'kokoro-v1'), kokoro: { manifest: kokoroManifest = MANIFEST, fetch: kokoroFetch = fetch, workerFile = WORKER_FILE } = {} } = {}) {
```

3. Replace:

```js
  const engine = () => profile.voice.engine, isHosted = () => engine() !== 'chatterbox';
```

   with:

```js
  const engine = () => profile.voice.engine, isHosted = () => !['chatterbox', 'kokoro'].includes(engine());
  // Built-in voices: Kokoro on this computer's CPU. Its files are downloaded once into modelsDir.
  const kokoroFiles = createDownloader({ dir: modelsDir, manifest: kokoroManifest, fetchImpl: kokoroFetch });
  const kokoroVoice = createKokoroClient({ workerFile, args: [modelsDir] });
  const kokoroVoices = voiceList(kokoroManifest), kokoroKey = cacheIdentity(kokoroManifest);
  const kokoroReady = () => assetsReady(modelsDir, kokoroManifest);
  // Kokoro reads at most 510 phonemes at once, so its lines go in shorter pieces than a server's.
  const chunkLength = () => engine() === 'kokoro' ? 350 : 1000;
```

4. Replace:

```js
voice: () => tried.voice.engine === 'chatterbox' ? probe('voice', tried.chatterbox.url, list) : probe(
```

   with:

```js
voice: () => tried.voice.engine === 'chatterbox' ? probe('voice', tried.chatterbox.url, list) : tried.voice.engine === 'kokoro' ? probe('voice', 'Built-in voices', async () => { if (!await kokoroReady()) throw new Error('Not downloaded yet. Choose Download in Settings.'); return `Ready. ${kokoroVoices.length} voices on this computer.`; }) : probe(
```

5. Replace:

```js
  async function getVoices() {
```

   with:

```js
  async function getVoices() {
    if (engine() === 'kokoro') return { voices: kokoroVoices.map(item => item.id), details: Object.fromEntries(kokoroVoices.map(({ id, ...rest }) => [id, rest])) };
```

6. Replace:

```js
    const [tts, stt] = await Promise.all([isHosted() ? 
```

   with:

```js
    // Built-in voices count as ready while they download: a render waits for the files.
    const kokoroTts = async () => ({ ok: await kokoroReady() || kokoroFiles.state().status === 'downloading', engine: 'kokoro' });
    const [tts, stt] = await Promise.all([engine() === 'kokoro' ? kokoroTts() : isHosted() ? 
```

7. Replace:

```js
    if (!isHosted() || !(await getVoices()).voices.includes(voice)) throw fail('There is no such voice to preview.', 404);
```

   with:

```js
    if (engine() === 'chatterbox' || !(await getVoices()).voices.includes(voice)) throw fail('There is no such voice to preview.', 404);
```

8. Replace:

```js
    const identity = isHosted() ? { version: 3,
```

   with:

```js
    const identity = engine() === 'kokoro' ? { version: 4, engine: 'kokoro', ...kokoroKey, text, voice } : isHosted() ? { version: 3,
```

9. Replace:

```js
    const pcm = isHosted()
```

   with:

```js
    if (engine() === 'kokoro') {
      // The cast can be set up while the files arrive; making audio waits for them.
      await kokoroFiles.settled();
      if (!await kokoroReady()) throw fail('Built-in voices are not downloaded. Download them in Settings, under Who reads the other parts.', 503);
    }
    const pcm = engine() === 'kokoro'
      ? decodeWav(encodeWav(await kokoroVoice.speak(voice.slice('kokoro:'.length), text)))
      : isHosted()
```

10. Replace:

```js
        for (const chunk of speechChunks(line.text)) {
```

   with:

```js
        for (const chunk of speechChunks(line.text, chunkLength())) {
```

11. Replace:

```js
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
```

   with:

```js
  // Built-in voices: whether their files are here, a download that can be followed, and removal.
  app.get('/api/kokoro', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ...kokoroFiles.state(), ready: await kokoroReady() }); });
  app.post('/api/kokoro/download', async (req, res) => { void kokoroFiles.start(); res.status(202).json({ ...kokoroFiles.state(), ready: await kokoroReady() }); });
  app.delete('/api/kokoro', async (req, res) => {
    if (draining || queue.length > 0) throw fail('Audio is being made right now. Wait for it to finish, then remove the voices.', 409);
    kokoroVoice.stop();
    await kokoroFiles.remove();
    res.json({ ...kokoroFiles.state(), ready: await kokoroReady() });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
```

What each change does: Kokoro is local (`isHosted` is false), so a render still speaks the directions ahead (the `input.warm` map in `/api/render` only skips hosted engines) and the page shows no charge. Its voices come from the manifest. Its line cache identity is `version: 4` with the model and G2P hashes, so older audio never matches. A line waits for a running download, and fails plainly when the files are missing. Lines go to Kokoro in pieces of at most 350 characters, because it reads at most 510 phonemes at once.

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --test tests/kokoro-engine.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass, including `tests/hosted.test.js` (the hosted engines are unchanged) and `tests/backend.test.js` (Chatterbox is unchanged); the build ends without errors.

- [ ] **Step 7: Try it by hand**

Run:
```bash
mkdir -p models && cp -R "$KOKORO_FILES" models/kokoro-v1
npm run build && npm start
```
In another terminal: `curl -s http://127.0.0.1:3001/api/kokoro` prints `"ready":true`. Stop the server with Ctrl+C. The `models/` folder is ignored by git.

- [ ] **Step 8: Commit**

```bash
git add server/app.js server/connections.js tests/kokoro-engine.test.js
git commit -m "feat: built-in kokoro voice engine, local and free, with its own line cache key

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The welcome choice and the Settings card

**Files:**
- Modify: `src/main.ts` (engine helpers near line 48, `progressMarkup`, the render status line, `showFirstRun`, `settingsMarkup`, `connect`, the click and change handlers)
- Modify: `src/style.css` (append)
- Modify: `verification/first-run.mjs`
- Create: `verification/builtin-voices.mjs`

**Interfaces:**
- Consumes: the `/api/kokoro` routes and `KokoroState` shape from Task 6; `createApp({ modelsDir, kokoro })` for the browser check; `tests/fixtures/fake-kokoro-worker.js`.
- Produces: page state `kokoro: KokoroState`; `LOCAL_ENGINES = ['chatterbox', 'kokoro']`; `downloadKokoro()`, `removeKokoro()`, `pollKokoro()`, `kokoroPanel(off)`; actions `data-action="kokoro-download"` and `data-action="kokoro-remove"`; welcome choice `data-choice="builtin"`; progress elements `progress[data-kokoro-progress]` and `[data-kokoro-percent]`.

- [ ] **Step 1: Write the failing browser check**

Create `verification/builtin-voices.mjs`:

```js
// Browser check for the built-in voices: the welcome's first choice, the download progress in
// Settings, Ready, the voices in the cast, Remove, and Try again after a failed download. The model
// files and the worker are fakes, so nothing is downloaded from the internet and no model runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { launch, press, until } from './lib.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-builtin-'));
const file = path.join(temp, 'connections.json');
const voiceBytes = Buffer.alloc(1000, 1);
const files = { 'kokoro/onnx/model_fp16.onnx': Buffer.alloc(3_000_000, 7), 'kokoro/voices/af_heart.bin': voiceBytes, 'kokoro/voices/bm_george.bin': voiceBytes };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = { version: 1, tag: 'check', base: 'https://example.invalid/kokoro', files: Object.entries(files).map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: sha(bytes) })) };
let offline = false;
// Each file arrives in small pieces with pauses, so there is progress to show.
const kokoroFetch = async url => {
  if (offline) throw new TypeError('fetch failed');
  const bytes = Object.entries(files).find(([name]) => url.endsWith(`/${name.replaceAll('/', '--')}`))?.[1];
  if (!bytes) return new Response('missing', { status: 404 });
  return new Response(new ReadableStream({ async start(controller) {
    for (let at = 0; at < bytes.length; at += 200_000) { controller.enqueue(bytes.subarray(at, at + 200_000)); await new Promise(resolve => setTimeout(resolve, 150)); }
    controller.close();
  } }));
};
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'), connectionsFile: file, secretsFile: path.join(temp, 'secrets.json'), modelsDir: path.join(temp, 'models'), connections: DEFAULT_CONNECTIONS, firstRunScreen: true,
  serviceFetch: async url => { throw new Error(`nothing is listening on ${url}`); },
  kokoro: { manifest, fetch: kokoroFetch, workerFile: fileURLToPath(new URL('../tests/fixtures/fake-kokoro-worker.js', import.meta.url)) } });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const ready = async () => (await (await fetch(`${base}/api/kokoro`)).json()).ready;
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${base}/#rehearsal`);
  await until(page, 'the welcome', () => !!document.querySelector('dialog.first-run[open]'));
  assert.equal(await page.locator('dialog.first-run [data-choice]').first().getAttribute('data-choice'), 'builtin', 'Built-in voices come first');
  assert.match(await page.locator('[data-choice="builtin"]').innerText(), /Recommended[\s\S]*Downloads about 3 MB once/);

  // Choosing it saves the engine at once and starts the download.
  await page.click('[data-choice="builtin"]');
  for (let i = 0; i < 100 && !await stat(file).catch(() => null); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).voice.engine, 'kokoro', 'The choice is saved without a Save button');
  await page.goto(`${base}/#settings`);
  await until(page, 'the download progress', () => !!document.querySelector('progress[data-kokoro-progress]'));
  await until(page, 'Ready', () => document.querySelector('label.engine-card:has(#service-engine-kokoro)')?.textContent.includes('Ready'));
  assert.equal(await ready(), true);

  // The cast offers the built-in voices.
  await page.goto(`${base}/#cast`);
  await until(page, 'built-in voices in the cast', () => [...document.querySelectorAll('select[data-cast] option')].some(option => option.value === 'kokoro:af_heart'));

  // Remove frees the space.
  await page.goto(`${base}/#settings`);
  await until(page, 'the Remove link', () => !!document.querySelector('[data-action="kokoro-remove"]'));
  await press(page, '[data-action="kokoro-remove"]');
  await until(page, 'Not downloaded', () => document.querySelector('label.engine-card:has(#service-engine-kokoro)')?.textContent.includes('Not downloaded'));
  assert.equal(await ready(), false);

  // A failed download says what happened and offers Try again, which then works.
  offline = true;
  await press(page, '[data-action="kokoro-download"]');
  await until(page, 'the failure message', () => /internet connection/.test(document.querySelector('.kokoro-panel [role="alert"]')?.textContent ?? ''));
  assert.equal((await page.locator('.kokoro-panel [data-action="kokoro-download"]').innerText()).trim(), 'Try again');
  offline = false;
  await press(page, '.kokoro-panel [data-action="kokoro-download"]');
  await until(page, 'Ready again', () => document.querySelector('label.engine-card:has(#service-engine-kokoro)')?.textContent.includes('Ready'));
  console.log('PASS: the welcome offers built-in voices first, Settings shows the download and Ready, and Remove and Try again work.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
```

In `verification/first-run.mjs`:

1. Replace:

```js
  assert.equal(await page.locator('dialog.first-run [data-choice]').count(), 3);
```

   with:

```js
  assert.equal(await page.locator('dialog.first-run [data-choice]').count(), 4);
```

- [ ] **Step 2: Run the check and see it fail**

Run: `npm run build && node verification/builtin-voices.mjs`
Expected: FAIL with `AssertionError` on `Built-in voices come first` (`'hosted' !== 'builtin'`).

- [ ] **Step 3: Add the Kokoro state, the download, the panel and the welcome choice**

In `src/main.ts`, make these replacements. Each `Replace` text appears exactly once.

1. Replace:

```ts
const hostedEngine = () => voiceEngine !== 'chatterbox';
```

   with:

```ts
const LOCAL_ENGINES = ['chatterbox', 'kokoro'];
const hostedEngine = () => !LOCAL_ENGINES.includes(voiceEngine);
// Built-in voices: whether their files are on this computer, and how far a download has got.
interface KokoroState { status: 'idle' | 'downloading' | 'ready' | 'error'; received: number; total: number; error: string; ready: boolean }
let kokoro: KokoroState = { status: 'idle', received: 0, total: 0, error: '', ready: false };
let kokoroPolling = false;
const kokoroMB = () => Math.max(1, Math.round(kokoro.total / 1e6));
const kokoroPercent = () => kokoro.total ? Math.floor(100 * kokoro.received / kokoro.total) : 0;
// Moves the progress bars in place, so the page is not redrawn every second while the actor types.
function syncKokoroProgress() {
  document.querySelectorAll<HTMLProgressElement>('progress[data-kokoro-progress]').forEach(bar => { bar.max = kokoro.total || 1; bar.value = kokoro.received; });
  document.querySelectorAll<HTMLElement>('[data-kokoro-percent]').forEach(label => { label.textContent = `${kokoroPercent()}%`; });
}
// Follows a running download once a second. When it ends, voices and health are read again.
async function pollKokoro() {
  if (kokoroPolling) return;
  kokoroPolling = true;
  try {
    for (;;) {
      const was = `${kokoro.status}/${kokoro.ready}`;
      kokoro = await api<KokoroState>('/api/kokoro');
      if (`${kokoro.status}/${kokoro.ready}` !== was) await connect(); else syncKokoroProgress();
      if (kokoro.status !== 'downloading') return;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch { /* the next action or a reload asks again */ } finally { kokoroPolling = false; }
}
async function downloadKokoro() {
  try { kokoro = await api<KokoroState>('/api/kokoro/download', { method: 'POST', body: '{}' }); }
  catch (error) { flash(error instanceof Error ? error.message : 'The download could not start.', true); return; }
  render(); void pollKokoro();
}
async function removeKokoro() {
  if (!confirm(`Remove the built-in voices? This frees about ${kokoroMB()} MB. You can download them again at any time.`)) return;
  try { kokoro = await api<KokoroState>('/api/kokoro', { method: 'DELETE' }); }
  catch (error) { flash(error instanceof Error ? error.message : 'The voices could not be removed.', true); return; }
  await connect();
}
// The Settings panel under the Built-in voices card: Ready, the download in progress, or a button to start it.
function kokoroPanel(off: string) {
  if (kokoro.ready) return `<div class="kokoro-panel"><p class="callout" role="note"><strong>Ready.</strong> ${voices.length} English voices, US and UK. Your scene is read on this computer and is never sent anywhere.</p><button type="button" class="text-link is-danger" data-action="kokoro-remove" ${off}>Remove downloaded voices</button></div>`;
  if (kokoro.status === 'downloading') return `<div class="kokoro-panel"><label for="kokoro-progress">Downloading the built-in voices, about ${kokoroMB()} MB · <span data-kokoro-percent>${kokoroPercent()}%</span></label><progress id="kokoro-progress" data-kokoro-progress max="${kokoro.total || 1}" value="${kokoro.received}"></progress><p class="library-note">You can set up the cast meanwhile. Making audio waits until the download is done.</p></div>`;
  return `<div class="kokoro-panel">${kokoro.error ? `<p class="callout is-warn" role="alert">${esc(kokoro.error)}</p>` : ''}<button type="button" class="button primary" data-action="kokoro-download" ${off}>${kokoro.error ? 'Try again' : `Download the voices (about ${kokoroMB()} MB)`}</button><p class="library-note">A one-time download. After that the voices work without an internet connection.</p></div>`;
}
```

2. Replace:

```ts
  if (job.status === 'error') return `<div class="job-error">${esc(job.error || 'The audio could not be made. Check the voice engine and try again.')}</div>`;
```

   with:

```ts
  if (job.status === 'error') return `<div class="job-error">${esc(job.error || 'The audio could not be made. Check the voice engine and try again.')}${voiceEngine === 'kokoro' && !kokoro.ready && kokoro.status !== 'downloading' ? ' <button type="button" class="button secondary small" data-action="kokoro-download">Download the built-in voices</button>' : ''}</div>`;
```

3. Replace:

```ts
(hostedEngine() ? `Queued for ${engineName()}` : 'Queued for the local GPU')
```

   with:

```ts
(hostedEngine() ? `Queued for ${engineName()}` : voiceEngine === 'kokoro' ? 'Queued' : 'Queued for the local GPU')
```

4. Replace:

```ts
  else if (!result) status.textContent = busy() ? `Making audio: ${job?.completed || 0} of ${job?.total || 0} lines` : canGenerate ? 'Press Play to make the audio and listen' : 'Voices are not connected yet';
```

   with:

```ts
  else if (!result) status.textContent = busy() ? `Making audio: ${job?.completed || 0} of ${job?.total || 0} lines`
    : voiceEngine === 'kokoro' && kokoro.status === 'downloading' ? 'Downloading the built-in voices. Press Play and the audio is made once they arrive.'
    : canGenerate ? 'Press Play to make the audio and listen'
    : voiceEngine === 'kokoro' ? 'The built-in voices are not downloaded yet. Download them in Settings.' : 'Voices are not connected yet';
```

5. Replace:

```ts
      <button type="button" data-choice="hosted">
```

   with:

```ts
      <button type="button" data-choice="builtin"><strong>Free voices on this computer <em>Recommended</em></strong><span>No setup. Works on any laptop. Downloads about ${kokoroMB()} MB once.</span></button>
      <button type="button" data-choice="hosted">
```

6. Replace:

```ts
    if (!choice) return;
    dialog.close();
    await loadSettings(true);
```

   with:

```ts
    if (!choice) return;
    dialog.close();
    await loadSettings(true);
    // Built-in voices: the choice is saved at once and the download starts; the cast can be set up meanwhile.
    if (choice === 'builtin') {
      if (settingsDraft) settingsDraft.voice = { engine: 'kokoro', model: '' };
      await saveSettingsNow();
      if (settingsError) { flash(settingsNotice || 'The built-in voices could not be chosen.', true); return; }
      await downloadKokoro();
      return;
    }
```

7. Replace:

```ts
    ['chatterbox', 'Chatterbox', 'Free and private. Runs on this computer or on your own voice server.', 'Free · Private'],
```

   with:

```ts
    ['kokoro', 'Built-in voices', 'Runs inside Script Glow on any laptop. No voice server and no key.', 'Free · Private · No setup'],
    ['chatterbox', 'Chatterbox', 'Free and private. Runs on this computer or on your own voice server.', 'Free · Private'],
```

8. Replace:

```ts
    const needsKey = value !== 'chatterbox';
    const status = needsKey ?
```

   with:

```ts
    const needsKey = !LOCAL_ENGINES.includes(value);
    const status = value === 'kokoro' ? kokoro.ready ? '<span class="pill is-ok">✓ Ready</span>' : kokoro.status === 'downloading' ? `<span class="pill">Downloading <span data-kokoro-percent>${kokoroPercent()}%</span></span>` : '<span class="pill is-warn">Not downloaded</span>'
      : needsKey ?
```

9. Replace:

```ts
        ${engine === 'chatterbox' ? row('service-chatterbox', 'Your Chatterbox server address', 'For example http://192.168.1.20:8095.
```

   with:

```ts
        ${engine === 'kokoro' ? kokoroPanel(off) : engine === 'chatterbox' ? row('service-chatterbox', 'Your Chatterbox server address', 'For example http://192.168.1.20:8095.
```

10. Replace:

```ts
api<{ casting: typeof castingConfig; voice?: { engine: string }; firstRun?: boolean }>('/api/connections')]);
```

   with:

```ts
api<{ casting: typeof castingConfig; voice?: { engine: string }; firstRun?: boolean }>('/api/connections'), api<KokoroState>('/api/kokoro')]);
  if (responses[3].status === 'fulfilled') kokoro = responses[3].value;
  if (kokoro.status === 'downloading') void pollKokoro();
```

11. Replace:

```ts
  if (action === 'test-service') { await testService(target.dataset.service!); return; }
```

   with:

```ts
  if (action === 'test-service') { await testService(target.dataset.service!); return; }
  if (action === 'kokoro-download') { await downloadKokoro(); return; }
  if (action === 'kokoro-remove') { await removeKokoro(); return; }
```

12. Replace:

```ts
  if (target.name === 'service-engine' && settingsDraft) { settingsDraft.voice = { engine: target.value, model: '' }; settingsResults = []; settingsNotice = ''; render(); queueSettingsSave(true); return; }
```

   with:

```ts
  if (target.name === 'service-engine' && settingsDraft) {
    settingsDraft.voice = { engine: target.value, model: '' }; settingsResults = []; settingsNotice = ''; render(); queueSettingsSave(true);
    // Choosing the built-in voices is all the setup there is: their download starts right away.
    if (target.value === 'kokoro' && !kokoro.ready && kokoro.status !== 'downloading') void downloadKokoro();
    return;
  }
```

Append to `src/style.css`:

```css
/* Built-in voices: the welcome's recommended badge and the download panel in Settings. */
.first-run-choices em{font-style:normal;font-size:11px;font-weight:600;margin-left:8px;padding:2px 7px;border-radius:20px;background:#e3eed9;color:#3f5f2d;vertical-align:1px}
.kokoro-panel{display:grid;gap:10px;margin-top:14px;justify-items:start}.kokoro-panel label{font-size:14px}.kokoro-panel progress{width:100%;height:10px;accent-color:#4f7040}.kokoro-panel .callout{margin:0}
```

What changes for the actor: the welcome's first choice is **Free voices on this computer** (Recommended); choosing it saves the engine at once and starts the download. Settings shows a fourth card, **Built-in voices**, with its state (**Ready**, **Downloading 42%**, **Not downloaded**), a progress bar while the files arrive, **Remove downloaded voices** once they are there, and **Try again** after a failure. Choosing the card starts the download. A render that failed because the files are missing offers **Download the built-in voices**.

- [ ] **Step 4: Run the checks and see them pass**

Run:
```bash
npm run build
node verification/builtin-voices.mjs
node verification/first-run.mjs
node verification/settings.mjs
```
Expected: `PASS: the welcome offers built-in voices first, Settings shows the download and Ready, and Remove and Try again work.`, then the three `PASS` lines of `first-run.mjs`, then the `PASS: settings save by themselves ...` line of `settings.mjs`.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; `tsc --noEmit` and the Vite build end without errors.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/style.css verification/builtin-voices.mjs verification/first-run.mjs
git commit -m "feat: welcome and Settings offer the built-in voices, with download progress

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Say it like

**Files:**
- Modify: `src/parser.ts` (add `sayItLike` above `spokenText`)
- Modify: `server/projects.js` (`validatePreferences`)
- Modify: `src/main.ts` (import, `Preferences`, `defaults`, `restored`, `renderInputs`, `castMarkup`, the change handler)
- Modify: `src/style.css` (append), `tests/parser.test.ts`, `tests/projects.test.js`
- Create: `verification/say-it-like.mjs`

**Interfaces:**
- Consumes: the respelling rule in `createG2P` (Task 1), so Kokoro stresses the capitalized part; `choose`, `launch`, `preferences`, `press`, `tone`, `until` from `verification/lib.mjs` (exist).
- Produces: `sayItLike(lines: ScriptLine[], sayAs: Record<string, string>): ScriptLine[]` in `src/parser.ts`; project preference `sayAs: Record<string, string>` (character name to respelling, at most 100 characters, one line), saved with the project; input `data-say-as="<CHARACTER>"` on each character card except the Narrator.

- [ ] **Step 1: Write the failing tests**

In `tests/parser.test.ts`:

1. Replace:

```ts
import { parseScript, SAMPLE, sceneIncludes, spokenText, spokenLines } from '../src/parser.ts';
```

   with:

```ts
import { parseScript, SAMPLE, sayItLike, sceneIncludes, spokenText, spokenLines, type ScriptLine } from '../src/parser.ts';
```

Append to `tests/parser.test.ts`:

```ts
test('say it like: the respelling replaces the name in the spoken text, whole words only', () => {
  const lines: ScriptLine[] = [
    { id: 'a', character: 'MARCUS', text: "SIOBHAN! Siobhan's keys are here.", kind: 'dialogue' },
    { id: 'b', character: 'SIOBHAN', text: 'Ann and Anna met Joanne.', kind: 'dialogue' },
    { id: 'c', character: 'Narrator', text: 'Siobhan turns to Mary Ann.', kind: 'direction' },
  ];
  const said = sayItLike(lines, { SIOBHAN: 'shi-VAWN', ANN: 'AN', 'MARY ANN': 'MAIR-ee an', ELENA: ' ' });
  assert.deepEqual(said.map(line => line.text), ["shi-VAWN! shi-VAWN's keys are here.", 'AN and Anna met Joanne.', 'shi-VAWN turns to MAIR-ee an.']);
  assert.equal(sayItLike(lines, {}), lines, 'No respellings: the same lines');
  assert.equal(sayItLike(lines, { ELENA: 'eh-LAY-nah' })[1], lines[1], 'A line without the name is the same object');
  assert.equal(sayItLike([{ id: 'd', character: 'X', text: 'Price is right.', kind: 'dialogue' }], { PRICE: '$& dollars' })[0].text, '$& dollars is right.', 'A respelling is taken as written');
});
```

Append to `tests/projects.test.js`:

```js
test('say it like respellings are kept per character and checked', () => {
  assert.deepEqual(validatePreferences({ ...preferences(), sayAs: { SIOBHAN: 'shi-VAWN' } }).sayAs, { SIOBHAN: 'shi-VAWN' });
  assert.deepEqual(validatePreferences(preferences()).sayAs, {}, 'Projects saved before this feature have none');
  for (const how of ['x'.repeat(101), 'a\nb', '', 3]) assert.throws(() => validatePreferences({ ...preferences(), sayAs: { SIOBHAN: how } }), /casting preferences/);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test tests/parser.test.ts tests/projects.test.js`
Expected: FAIL. `parser.test.ts` stops with `does not provide an export named 'sayItLike'`; in `projects.test.js` the new test fails with `undefined` where `{ SIOBHAN: 'shi-VAWN' }` was expected.

- [ ] **Step 3: Write `sayItLike` and keep `sayAs` with the project**

In `src/parser.ts`:

1. Replace:

```ts
// A parenthetical is a note to the actor, not a line.
```

   with:

```ts
// Say it like: the actor's plain respelling of a name ("shi-VAWN" for Siobhan) replaces the name in
// what every engine is sent. The page still shows the script as written. Whole words only, any case.
export const sayItLike = (lines: ScriptLine[], sayAs: Record<string, string>): ScriptLine[] => {
  // Longest names first, so "MARY ANN" is replaced before "MARY" could take part of it.
  const rules = Object.entries(sayAs).map(([name, how]) => [name.trim(), how.trim()]).filter(([name, how]) => name && how)
    .sort(([a], [b]) => b.length - a.length)
    .map(([name, how]) => [new RegExp(`(?<![\\p{L}\\p{N}'])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu'), how] as const);
  if (!rules.length) return lines;
  return lines.map(line => {
    const text = rules.reduce((out, [name, how]) => out.replace(name, () => how), line.text);
    return text === line.text ? line : { ...line, text };
  });
};
// A parenthetical is a note to the actor, not a line.
```

In `server/projects.js`:

1. Replace:

```js
manualVoices: map(value.manualVoices ?? {}, item => typeof item === 'boolean'),
```

   with:

```js
manualVoices: map(value.manualVoices ?? {}, item => typeof item === 'boolean'),
    // Say it like: how each character's name sounds, in plain spelling (shi-VAWN). One line of text.
    sayAs: map(value.sayAs ?? {}, item => text(item, 100) && !/[\u0000-\u001f\u007f]/.test(item)),
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/parser.test.ts tests/projects.test.js`
Expected: PASS, every test in both files.

- [ ] **Step 5: Write the failing browser check**

Create `verification/say-it-like.mjs`:

```js
// Browser check for Say it like: the respelling is what the voice engine is sent (here a fake
// Chatterbox), it is saved with the project, and changing it re-makes only the lines with the name.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';
import { choose, launch, preferences, press, tone, until } from './lib.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-say-it-like-'));
const spoken = [];
const app = createApp({ cacheDir: path.join(temp, 'cache'), projectsDir: path.join(temp, 'projects'), previewDir: path.join(temp, 'previews'), connectionsFile: path.join(temp, 'connections.json'), secretsFile: path.join(temp, 'secrets.json'), connections: DEFAULT_CONNECTIONS,
  serviceFetch: async (url, options = {}) => {
    if (url.endsWith('/v1/voices')) return Buffer.from(JSON.stringify(['Stock-Amber', 'Stock-Ash', 'Stock-Mica']));
    if (url.endsWith('/health')) return Buffer.from('{}');
    if (url.endsWith('/v1/tts')) { spoken.push(JSON.parse(options.body).text); return tone(0.3); }
    throw new Error(`nothing is listening on ${url}`);
  } });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const source = 'SCENE 1\n\nMARCUS: Siobhan, listen to me.\n\nSIOBHAN: No.\n\nMARCUS: Fine. Go.\n';
const browser = await launch();
try {
  assert.equal((await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: preferences(source, { role: 'MARCUS' }) }) })).status, 201);
  const page = await browser.newPage();
  const makeAudio = async () => {
    await page.goto(`${base}/#rehearsal`);
    await until(page, 'the Make audio button', () => document.querySelector('[data-action="render"]') && !document.querySelector('[data-action="render"]').disabled);
    await press(page, '[data-action="render"]');
    await until(page, 'the audio', () => /Both tracks ready/.test(document.body.textContent));
  };
  await page.goto(`${base}/#cast`);
  await until(page, 'the Say it like box', () => !!document.querySelector('[data-say-as="SIOBHAN"]'));
  await choose(page, '[data-say-as="SIOBHAN"]', 'shi-VAWN');
  await makeAudio();
  assert.ok(spoken.includes('shi-VAWN, listen to me.'), spoken.join(' | '));
  assert.equal(spoken.some(text => /siobhan/i.test(text)), false, 'The name as written is never sent');
  const first = spoken.length;

  // Saved with the project: after a reload the box still holds it.
  await until(page, 'the project save', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await page.reload();
  await page.goto(`${base}/#cast`);
  await until(page, 'the project to open', () => document.querySelector('#project-save-status')?.textContent === 'Saved locally');
  await until(page, 'the saved respelling', () => document.querySelector('[data-say-as="SIOBHAN"]')?.value === 'shi-VAWN');

  // A new respelling re-makes only the line with the name; the others come from the line cache.
  await choose(page, '[data-say-as="SIOBHAN"]', 'shiv-AWN');
  await makeAudio();
  assert.deepEqual(spoken.slice(first), ['shiv-AWN, listen to me.']);
  console.log('PASS: Say it like changes what the engine is sent, is saved with the project, and re-makes only the lines with the name.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
```

Run: `npm run build && node verification/say-it-like.mjs`
Expected: FAIL, `Timed out waiting for the Say it like box`.

- [ ] **Step 6: Add the box to the character cards and send the respelling**

In `src/main.ts`:

1. Replace:

```ts
import { parseScript, sceneIncludes, spokenLines, SAMPLE, type Scene, type ScriptLine } from './parser';
```

   with:

```ts
import { parseScript, sayItLike, sceneIncludes, spokenLines, SAMPLE, type Scene, type ScriptLine } from './parser';
```

2. Replace:

```ts
interface Preferences extends HighlightPreferences { source: string; name: string; role: string; cast: Record<string, string>;
```

   with:

```ts
interface Preferences extends HighlightPreferences { source: string; name: string; role: string; cast: Record<string, string>; sayAs: Record<string, string>;
```

3. Replace:

```ts
const defaults: Preferences = { ...highlightDefaults, source: SAMPLE, name: 'The Last Light', role: 'MARCUS', cast: {},
```

   with:

```ts
const defaults: Preferences = { ...highlightDefaults, source: SAMPLE, name: 'The Last Light', role: 'MARCUS', cast: {}, sayAs: {},
```

4. Replace:

```ts
      manualVoices: record(saved.manualVoices, item => typeof item === 'boolean') as Record<string, boolean>,
```

   with:

```ts
      manualVoices: record(saved.manualVoices, item => typeof item === 'boolean') as Record<string, boolean>,
      sayAs: record(saved.sayAs, item => typeof item === 'string') as Record<string, string>,
```

5. Replace:

```ts
  if (spoken) current = { ...current, lines: spokenLines(current.lines) };
```

   with:

```ts
  // Say it like respellings are part of what is sent, so they are part of the render key too.
  if (spoken) current = { ...current, lines: sayItLike(spokenLines(current.lines), prefs.sayAs) };
```

6. Replace:

```ts
      <div class="voice-actions"><button type="button" data-action="voice-preview"
```

   with:

```ts
      ${name === 'Narrator' ? '' : `<label class="say-it-like" for="say-${index}">Say it like <input id="say-${index}" data-say-as="${esc(name)}" value="${esc(prefs.sayAs[name] ?? '')}" maxlength="100" placeholder="for example shi-VAWN" autocomplete="off" spellcheck="false" ${busy() ? 'disabled' : ''}></label><small class="say-it-like-note">How the name sounds, in plain spelling. Capitals mark the stressed part.</small>`}
      <div class="voice-actions"><button type="button" data-action="voice-preview"
```

7. Replace:

```ts
  if (target.dataset.gender) {
```

   with:

```ts
  if (target.dataset.sayAs !== undefined) {
    const how = target.value.trim().slice(0, 100);
    if (how) prefs.sayAs[target.dataset.sayAs] = how; else delete prefs.sayAs[target.dataset.sayAs];
    invalidate(true);
  }
  if (target.dataset.gender) {
```

Append to `src/style.css`:

```css
/* Say it like, on each character card. */
.say-it-like{display:flex;align-items:center;gap:8px;font-size:13px;margin-top:8px}.say-it-like input{flex:1;min-width:0;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:#fff}.say-it-like-note{display:block;color:#6b7169;font-size:12px;margin-top:2px}
```

Because `renderInputs` builds both the render request and the render key, the respelling is part of the key: changing it asks for new audio, and the server's line cache (keyed by the text sent) reuses every line that does not contain the name.

- [ ] **Step 7: Run the check and see it pass**

Run: `npm run build && node verification/say-it-like.mjs`
Expected: `PASS: Say it like changes what the engine is sent, is saved with the project, and re-makes only the lines with the name.`

- [ ] **Step 8: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; the build ends without errors.

- [ ] **Step 9: Commit**

```bash
git add src/parser.ts src/main.ts src/style.css server/projects.js tests/parser.test.ts tests/projects.test.js verification/say-it-like.mjs
git commit -m "feat: Say it like respells a character's name for every voice engine

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Packing the voice runtime, and the license notices

**Files:**
- Create: `scripts/third-party-notices.mjs`, `THIRD_PARTY_NOTICES.md` (generated)
- Modify: `desktop/builder.cjs`, `verification/desktop.mjs`, `tests/licenses.test.js`, `package.json`

**Interfaces:**
- Consumes: `MANIFEST.sources` (Task 4); `WORKER_FILE` resolving to `app.asar.unpacked` (Task 5).
- Produces: `npm run notices`; `node scripts/third-party-notices.mjs --check` (exit 1 when stale); in the packed app, `Resources/app.asar.unpacked/server/kokoro/**` with every package the worker imports, and `Resources/THIRD_PARTY_NOTICES.md` (`resources/` on Windows).

- [ ] **Step 1: Write the failing notices test**

In `tests/licenses.test.js`:

1. Replace:

```js
import { readFileSync } from 'node:fs';
```

   with:

```js
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
```

Append to `tests/licenses.test.js`:

```js
test('THIRD_PARTY_NOTICES.md is up to date and covers the voice files and the packages that run them', () => {
  execFileSync(process.execPath, ['scripts/third-party-notices.mjs', '--check'], { cwd: new URL('../', import.meta.url) });
  const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  for (const part of ['Kokoro-82M v1.0', 'Misaki English word lists', 'graphemes_to_phonemes_en_us', '### @huggingface/transformers ', '### onnxruntime-node ', '### number-to-words ', '### express '])
    assert.ok(notices.includes(part), part);
});
```

Run: `node --test tests/licenses.test.js`
Expected: the new test FAILS with `Cannot find module '.../scripts/third-party-notices.mjs'` in the `execFileSync` error; the other three pass.

- [ ] **Step 2: Write the notices generator**

Create `scripts/third-party-notices.mjs`:

```js
// Writes THIRD_PARTY_NOTICES.md: the built-in voice files downloaded on first use, and every package
// the app ships (from package-lock.json, development tools left out), each with its license text.
//   npm run notices     writes the file
//   --check             exits 1 when the file is out of date (tests/licenses.test.js runs this)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const { sources } = JSON.parse(readFileSync(path.join(root, 'server/kokoro/manifest.json'), 'utf8'));
const lf = text => text.replace(/\r\n?/g, '\n').trim();
// LICENSE, LICENCE.md, COPYING, NOTICE and similar files at the top of a package folder.
function licenseText(folder) {
  let names;
  try { names = readdirSync(path.join(root, folder)); } catch { return ''; }
  return names.filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name)).sort()
    .map(name => lf(readFileSync(path.join(root, folder, name), 'utf8'))).join('\n\n');
}
const fenced = text => ['````text', text, '````'];
const apache = licenseText('node_modules/@huggingface/transformers');
// Platform builds (os or cpu set) are installed only on their own system, so their text is not read:
// the file must come out the same on Mac, Windows and Linux.
const shipped = Object.entries(lock.packages)
  .filter(([where, entry]) => where.startsWith('node_modules/') && !entry.dev && !entry.link)
  .map(([where, entry]) => ({ where, name: where.slice(where.lastIndexOf('node_modules/') + 'node_modules/'.length), version: entry.version, license: entry.license ?? 'not stated', platform: Boolean(entry.os || entry.cpu) }))
  .sort((a, b) => a.where.localeCompare(b.where));
const lines = [
  '# Third-party notices',
  '',
  'Script Glow is MIT-licensed (see LICENSE). It ships, or downloads on first use, the components below, each under its own license. This file is generated by `npm run notices` from package-lock.json and server/kokoro/manifest.json.',
  '',
  '## Built-in voices (downloaded on first use)',
  '',
  `- Kokoro-82M v1.0 and its English voice packs, by hexgrad; ONNX export by onnx-community (\`${sources.kokoro.repo}\` at \`${sources.kokoro.revision}\`). Apache-2.0.`,
  `- Misaki English word lists us_gold, us_silver, gb_gold and gb_silver, by hexgrad (\`${sources.misaki.repo}\` at \`${sources.misaki.revision}\`). Apache-2.0.`,
  '- Misaki G2P, ported: `server/kokoro/g2p.js` is a JavaScript port of `misaki/en.py` (hexgrad/misaki, Apache-2.0), modified by Script Glow: no part-of-speech tagging, a respelling rule for Say it like, and word lists read from the downloaded folder.',
  `- Grapheme-to-phoneme fallback models by PeterReid (\`${sources.bart_us.repo}\` at \`${sources.bart_us.revision}\`, \`${sources.bart_gb.repo}\` at \`${sources.bart_gb.revision}\`), exported to ONNX by Script Glow. Apache-2.0.`,
  '- kokoro-js (Apache-2.0): about ten lines of its `generate_from_ids` are adapted in `server/kokoro/worker.js`. kokoro-js itself is not shipped.',
  '',
  'The Apache License 2.0, which covers all five:',
  '',
  ...fenced(apache),
  '',
  '## Packages in the app',
  '',
  ...shipped.flatMap(item => {
    const text = item.platform ? '' : licenseText(item.where);
    return [`### ${item.name} ${item.version}`, '', `License: ${item.license}`, '',
      ...(item.platform ? ['A build for one platform. Its license text is in its package folder and matches the package it belongs to.'] : text ? fenced(text) : ['The package has no license file.']), ''];
  }),
];
const out = `${lines.join('\n').trimEnd()}\n`;
const file = path.join(root, 'THIRD_PARTY_NOTICES.md');
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { /* missing counts as out of date */ }
  if (current !== out) { console.error('THIRD_PARTY_NOTICES.md is out of date. Run: npm run notices'); process.exit(1); }
  console.log('THIRD_PARTY_NOTICES.md is up to date.');
} else {
  writeFileSync(file, out);
  console.log(`THIRD_PARTY_NOTICES.md: ${shipped.length} packages and the built-in voice files.`);
}
```

In `package.json`:

1. Replace:

```json
    "dist:dir": "npm run build && electron-builder --config desktop/builder.cjs --dir --publish never"
```

   with:

```json
    "dist:dir": "npm run build && electron-builder --config desktop/builder.cjs --dir --publish never",
    "notices": "node scripts/third-party-notices.mjs"
```

Run:
```bash
npm run notices
node --test tests/licenses.test.js
```
Expected: `THIRD_PARTY_NOTICES.md: <n> packages and the built-in voice files.` (about 110 packages), then PASS, 4 tests. Open the file and check the first section names the four revisions from `server/kokoro/manifest.json` and holds the full Apache License 2.0 text. License texts are third-party data and stay exactly as their authors wrote them.

- [ ] **Step 3: Unpack the worker and its packages, and ship the notices**

In `desktop/builder.cjs`:

1. Replace:

```js
// Playwright's electron.launch drives the app through --inspect,
```

   with:

```js
// The Kokoro worker runs from app.asar.unpacked, like the PDF worker, so every package it can import
// is unpacked with it (onnxruntime-node also loads native libraries, which cannot load from an
// archive). The list follows package-lock.json, so a new dependency is never missed.
function unpackedTree(...roots) {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages;
  const found = new Set(), waiting = [...roots];
  while (waiting.length) {
    const name = waiting.shift(), entry = lock[`node_modules/${name}`];
    if (found.has(name) || !entry || entry.dev) continue;
    found.add(name);
    waiting.push(...Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }));
  }
  return [...found].sort().map(name => `node_modules/${name}/**`);
}

// Playwright's electron.launch drives the app through --inspect,
```

2. Replace:

```js
  asarUnpack: ['server/pdf-worker.js', 'server/pdf-text.js', 'node_modules/pdfjs-dist/**', 'node_modules/@napi-rs/**'],
```

   with:

```js
  asarUnpack: ['server/pdf-worker.js', 'server/pdf-text.js', 'node_modules/pdfjs-dist/**', 'node_modules/@napi-rs/**',
    'server/kokoro/**', ...unpackedTree('@huggingface/transformers', 'onnxruntime-node', 'number-to-words')],
  // Next to the app, where anyone can read it: the licenses of everything shipped or downloaded.
  extraResources: [{ from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' }],
```

Run: `node -e "console.log(require('./desktop/builder.cjs').asarUnpack.filter(p => /transformers|onnxruntime|number-to-words|sharp|kokoro/.test(p)))"`
Expected: a list with `server/kokoro/**`, `node_modules/@huggingface/transformers/**`, `node_modules/onnxruntime-common/**`, `node_modules/onnxruntime-node/**`, `node_modules/onnxruntime-web/**`, `node_modules/number-to-words/**` and `node_modules/sharp/**`, among the other packages transformers.js needs.

- [ ] **Step 4: Check the packed app holds them**

In `verification/desktop.mjs`:

1. Replace:

```js
assert.ok(executablePath, 'No packed app found. Run: npm run dist:dir');
```

   with:

```js
assert.ok(executablePath, 'No packed app found. Run: npm run dist:dir');
// Built-in voices: the worker and every package it imports sit outside app.asar, sharp is the empty
// stub, the LGPL image library is absent, and the license notices sit next to the app.
const resources = process.platform === 'darwin' ? path.join(path.dirname(executablePath), '..', 'Resources') : path.join(path.dirname(executablePath), 'resources');
for (const file of ['app.asar.unpacked/server/kokoro/worker.js', 'app.asar.unpacked/server/kokoro/g2p.js', 'app.asar.unpacked/node_modules/@huggingface/transformers/package.json', 'app.asar.unpacked/node_modules/onnxruntime-node/package.json', 'app.asar.unpacked/node_modules/number-to-words/package.json', 'app.asar.unpacked/node_modules/sharp/index.js', 'THIRD_PARTY_NOTICES.md'])
  assert.ok(existsSync(path.join(resources, file)), `${file} is in the packed app`);
assert.equal(existsSync(path.join(resources, 'app.asar.unpacked', 'node_modules', '@img')), false, 'No sharp image library is packed');
```

2. Replace:

```js
  console.log('PASS: the packed app starts, shows the welcome, its PDF worker extracts text, and it honors SCRIPT_GLOW_HOME.');
```

   with:

```js
  console.log('PASS: the packed app starts, shows the welcome, its PDF worker extracts text, it honors SCRIPT_GLOW_HOME, and the built-in voice runtime and notices are packed.');
```

Run: `npm run dist:dir && node verification/desktop.mjs`
Expected: `PASS: the packed app starts, shows the welcome, its PDF worker extracts text, it honors SCRIPT_GLOW_HOME, and the built-in voice runtime and notices are packed.`

If it fails on `app.asar.unpacked/node_modules/sharp/index.js`, electron-builder did not copy the `file:` link that npm made for the stub. Then add this entry to the `files` list in `desktop/builder.cjs`, run `npm run dist:dir` again and repeat the check:

```js
  files: ['desktop/**', 'server/**', 'dist/**', 'package.json', { from: 'stubs/sharp', to: 'node_modules/sharp' }],
```

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; the build ends without errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/third-party-notices.mjs THIRD_PARTY_NOTICES.md desktop/builder.cjs verification/desktop.mjs tests/licenses.test.js package.json
git commit -m "build: pack the built-in voice runtime outside the archive and ship license notices

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: End-to-end check in CI, and the release gate

**Files:**
- Create: `verification/kokoro-desktop.mjs`
- Modify: `.github/workflows/test.yml` (desktop job), `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the packed app (Task 9); `/api/connections`, `/api/kokoro`, `/api/kokoro/download`, `/api/render`, `/api/jobs/:id` (Task 6); `verification/kokoro-g2p.mjs` (Task 4); `server/kokoro/release-gate.json` (Task 4); the repository variable `KOKORO_ASSETS_PUBLISHED` (Task 4, Step 10).
- Produces: `verification/kokoro-desktop.mjs`, which honors `SCRIPT_GLOW_TEST_HOME` (reuse the files between runs) and `KOKORO_LOCAL_FILES` (seed them from a local folder before the release exists).

- [ ] **Step 1: Write the end-to-end check**

Create `verification/kokoro-desktop.mjs`:

```js
// Built-in voices end to end in the packed app, with the real model: download the files (or reuse
// them), then make a scene with a US and a UK voice and print the time per line. Build first with
// npm run dist:dir. The files come from the kokoro-assets-v1 release, or, before it is published,
// from a folder made in Task 4: KOKORO_LOCAL_FILES="$KOKORO_FILES" node verification/kokoro-desktop.mjs
// SCRIPT_GLOW_TEST_HOME keeps the downloaded files between runs (CI caches that folder).
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { DEFAULT_CONNECTIONS } from '../server/connections.js';

const candidates = process.platform === 'win32'
  ? ['release/win-unpacked/Script Glow.exe']
  : ['release/mac-arm64/Script Glow.app/Contents/MacOS/Script Glow', 'release/mac/Script Glow.app/Contents/MacOS/Script Glow'];
const executablePath = candidates.find(file => existsSync(file));
assert.ok(executablePath, 'No packed app found. Run: npm run dist:dir');
const home = process.env.SCRIPT_GLOW_TEST_HOME || mkdtempSync(path.join(os.tmpdir(), 'script-glow-kokoro-desktop-'));
const models = path.join(home, 'models', 'kokoro-v1');
if (process.env.KOKORO_LOCAL_FILES && !existsSync(models)) { mkdirSync(path.dirname(models), { recursive: true }); cpSync(process.env.KOKORO_LOCAL_FILES, models, { recursive: true }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = { 'Content-Type': 'application/json' };
const app = await electron.launch({ executablePath, env: { ...process.env, SCRIPT_GLOW_HOME: home } });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  const base = new URL(page.url()).origin;
  // Requests from here carry no Origin header, so they need no session, like any local tool.
  const call = async (route, options) => {
    const response = await fetch(base + route, options);
    const body = await response.json();
    assert.ok(response.ok, `${route}: ${body.error}`);
    return body;
  };
  await call('/api/connections', { method: 'PUT', headers: json, body: JSON.stringify({ ...DEFAULT_CONNECTIONS, voice: { engine: 'kokoro', model: '' } }) });
  await call('/api/kokoro/download', { method: 'POST', headers: json, body: '{}' });
  const downloadStarted = Date.now();
  let files;
  for (;;) {
    files = await call('/api/kokoro');
    if (files.ready || files.status === 'error') break;
    assert.ok(Date.now() - downloadStarted < 20 * 60000, 'The download took more than 20 minutes');
    await pause(2000);
  }
  assert.equal(files.ready, true, files.error);
  console.log(`Files ready after ${((Date.now() - downloadStarted) / 1000).toFixed(0)} s.`);

  const lines = [
    ['MARCUS', "I'd've told you, if you'd asked."], ['ELENA', 'Tomorrow, and tomorrow, and tomorrow.'],
    ['MARCUS', 'Meet me at 3:15, not a minute later.'], ['ELENA', 'Wait... did you hear that?'],
    ['MARCUS', 'We\'re gonna need a bigger boat.'], ['ELENA', 'Hmm. Maybe. We\'ll see.'],
  ].map(([character, text], i) => ({ id: `l${i}`, character, text, kind: 'dialogue' }));
  const body = { scene: { id: 'e2e', title: 'End to end', lines }, voices: { MARCUS: 'kokoro:am_michael', ELENA: 'kokoro:bf_emma' }, myCharacter: 'MARCUS', gapSeconds: 0.2, includeDirections: false };
  const renderStarted = Date.now();
  const { jobId } = await call('/api/render', { method: 'POST', headers: json, body: JSON.stringify(body) });
  let job;
  for (;;) {
    job = await call(`/api/jobs/${jobId}`);
    if (['complete', 'error'].includes(job.status)) break;
    await pause(250);
  }
  assert.equal(job.status, 'complete', job.error);
  const seconds = (Date.now() - renderStarted) / 1000;
  assert.ok(job.result.duration > lines.length * 0.5, `Every line has real audio (${job.result.duration} s in all)`);
  const wav = Buffer.from(await (await fetch(base + job.result.fullUrl)).arrayBuffer());
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  console.log(`PASS: built-in voices in the packed app. ${lines.length} lines in ${seconds.toFixed(1)} s, ${(seconds / lines.length).toFixed(2)} s per line (the first line includes loading the model).`);
} finally {
  await app.close();
  if (!process.env.SCRIPT_GLOW_TEST_HOME) rmSync(home, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run it against the packed app**

Run:
```bash
npm run dist:dir
KOKORO_LOCAL_FILES="$KOKORO_FILES" node verification/kokoro-desktop.mjs
```
Expected: `Files ready after 0 s.` (they were copied in, and each is still checked by size), then `PASS: built-in voices in the packed app. 6 lines in <n> s, <n> s per line ...`. This run is the one that proves the `utilityProcess` path: under Electron the worker cannot be forked with Node. On an Apple M2 Pro expect under 1 s per line after the first.

- [ ] **Step 3: Run the voices in CI once the files are published**

In `.github/workflows/test.yml`:

1. Replace:

```yaml
      - run: node verification/desktop.mjs
```

   with:

```yaml
      - run: node verification/desktop.mjs
      # Built-in voices end to end with the real model. The files come from the kokoro-assets-v1
      # release, which Mariano publishes by hand and then marks with the KOKORO_ASSETS_PUBLISHED
      # repository variable; until then these steps are skipped. The files are cached between runs.
      - name: Cache the built-in voice files
        if: vars.KOKORO_ASSETS_PUBLISHED == 'true'
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ${{ runner.temp }}/sg-home/models
          key: kokoro-${{ hashFiles('server/kokoro/manifest.json') }}
      - name: Built-in voices in the packed app
        if: vars.KOKORO_ASSETS_PUBLISHED == 'true'
        env:
          SCRIPT_GLOW_TEST_HOME: ${{ runner.temp }}/sg-home
        run: node verification/kokoro-desktop.mjs
      - name: The 20 actor lines through the real word lists
        if: vars.KOKORO_ASSETS_PUBLISHED == 'true'
        run: node verification/kokoro-g2p.mjs "${{ runner.temp }}/sg-home/models/kokoro-v1/g2p"
```

`actions/cache` is pinned to the commit of its v6.1.0 release, like the other actions in this workflow. Before committing, confirm the pin is still current: `gh api repos/actions/cache/releases/latest --jq .tag_name` prints `v6.1.0`, and `gh api repos/actions/cache/commits/v6.1.0 --jq .sha` prints `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`. If a newer release exists, pin that one the same way.

- [ ] **Step 4: Add the release gate**

In `.github/workflows/release.yml`:

1. Replace:

```yaml
      - run: npm ci
      - run: npm test
```

   with:

```yaml
      - run: npm ci
      # The built-in voices ship only once the Misaki word lists are confirmed permissive (release
      # gate in docs/superpowers/specs/2026-09-19-kokoro-engine-design.md). Mariano sets the flag.
      - name: Check the built-in voices release gate
        shell: bash
        run: |
          if [[ "$(node -p "require('./server/kokoro/release-gate.json').misakiProvenanceCleared")" != "true" ]]; then
            echo "Error: the built-in voices wait on the Misaki word-list provenance. See server/kokoro/release-gate.json." >&2
            exit 1
          fi
          echo "Release gate cleared."
      - run: npm test
```

Run: `node -p "require('./server/kokoro/release-gate.json').misakiProvenanceCleared"`
Expected: `false`. With that value a pushed `v*` tag stops at **Check the built-in voices release gate** with the error above, which is the point: no public release carries Kokoro until Mariano records the provenance answer and sets the flag to `true`.

- [ ] **Step 5: Run the whole suite and the build, then check the workflows**

Run: `npm test && npm run build && git diff --stat .github/workflows`
Expected: all tests pass, the build ends without errors, and the diff touches only `test.yml` and `release.yml`. After the push that Mariano makes, the `desktop` job on macOS and Windows shows the three new steps as skipped until `KOKORO_ASSETS_PUBLISHED` is `true`, and as passing after.

- [ ] **Step 6: MANUAL: measure a low-end Windows laptop**

The spec's open risk: speed on a low-end Windows laptop is unknown. Mariano builds on Windows (`npm run dist:dir`), runs `node verification/kokoro-desktop.mjs` there, and notes the `s per line` figure in the pull request. Above about 2 s per line, the spec's answer is to render a scene ahead in the background; that is a separate plan.

- [ ] **Step 7: Commit**

```bash
git add verification/kokoro-desktop.mjs .github/workflows/test.yml .github/workflows/release.yml
git commit -m "ci: built-in voices end to end in the desktop job, and a release gate for the word lists

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: README and changelog

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the UI names from Tasks 7 and 8 (**Free voices on this computer**, **Built-in voices**, **Remove downloaded voices**, **Try again**, **Say it like**), the routes from Task 6, `THIRD_PARTY_NOTICES.md` from Task 9.
- Produces: user documentation only.

- [ ] **Step 1: Update the README**

In `README.md`, make these replacements. "About 200 MB" is the manifest total from Task 4, Step 6, rounded to the nearest 10 MB; if that total rounds to another number, use it in all four places.

1. Replace:

```markdown
| Voice server or a hosted voice key | Yes, for audio | Reads the script aloud. Use the included
```

   with:

```markdown
| Built-in voices, a voice server, or a hosted voice key | Yes, for audio | Reads the script aloud. The built-in voices need nothing else: they run on this computer's CPU and download about 200 MB once. Or use the included
```

2. Replace:

```markdown
Pick one:
```

   with:

```markdown
Pick one:

- **Built-in voices (free, private, any laptop, no setup).** Choose **Free voices on this computer** on the welcome screen, or **Built-in voices** under **Who reads the other parts** in Settings. The voice files, about 200 MB, download once into your user folder and are checked before use; a broken download resumes when you press **Try again**. There are 28 English voices, US and UK. They cannot sound like you: **Record my voice** needs Chatterbox.
```

3. Replace:

```markdown
Pick and preview a voice for every other character.
```

   with:

```markdown
Pick and preview a voice for every other character. If a name comes out wrong, type how it sounds in **Say it like**, for example `shi-VAWN` for Siobhan. Capitals mark the stressed part, and it works with every voice engine.
```

4. Replace:

```markdown
The first render is slower while Chatterbox loads its model.
```

   with:

```markdown
The first render is slower while the voice engine loads its model.
```

5. Replace:

```markdown
| `.cache/` | Line audio cache (512 MiB) and export cache (1 GiB), oldest files removed first | Ignored |
```

   with:

```markdown
| `.cache/` | Line audio cache (512 MiB) and export cache (1 GiB), oldest files removed first | Ignored |
| `models/kokoro-v1/` | Built-in voice files, about 200 MB, downloaded once. **Remove downloaded voices** in Settings deletes them | Ignored |
```

6. Replace:

```markdown
| GET | `/api/voices/preview?voice=&session=` | A short sample of a hosted voice, made once and cached |
```

   with:

```markdown
| GET | `/api/voices/preview?voice=&session=` | A short sample of a hosted or built-in voice, made once and cached |
| GET | `/api/kokoro` | Whether the built-in voice files are here, and how far a download has got |
| POST | `/api/kokoro/download` | Start the download of the built-in voice files, or join the one running |
| DELETE | `/api/kokoro` | Remove the built-in voice files |
```

7. Replace:

```markdown
server/        Express API: rendering, projects, takes, PDF import, casting AI, hosted services, keys, FFmpeg, connection profile
```

   with:

```markdown
server/        Express API: rendering, projects, takes, PDF import, casting AI, hosted services, keys, FFmpeg, connection profile
server/kokoro/ Built-in voices: text to phonemes (Misaki port), model file download, the worker process
```

8. Replace:

```markdown
scripts/       Voice reference installers and manifests
```

   with:

```markdown
scripts/       Voice reference installers and manifests, built-in voice file preparation, license notices
```

9. Replace:

```markdown
                                           # self-tape, settings, studio-workspace, voice-library
```

   with:

```markdown
                                           # self-tape, settings, studio-workspace, voice-library,
                                           # builtin-voices, say-it-like
```

10. Replace:

```markdown
- Script Glow code: [MIT License](LICENSE).
```

   with:

```markdown
- Built-in voices: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad, the [Misaki](https://github.com/hexgrad/misaki) word lists and G2P (ported to JavaScript), and PeterReid's grapheme-to-phoneme models, all Apache-2.0. Nothing GPL is used: no espeak-ng. Every component that ships or is downloaded, with its license text: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Script Glow code: [MIT License](LICENSE).
```

- [ ] **Step 2: Update the changelog**

In `CHANGELOG.md`:

1. Replace:

```markdown
# Changelog
```

   with:

```markdown
# Changelog

## Unreleased

- **Built-in voices.** Kokoro-82M runs on this computer's CPU inside Script Glow: no voice server, no GPU, no key, no cost. Choose **Free voices on this computer** on the welcome screen, or **Built-in voices** in Settings. The voice files (about 200 MB) download once, resume after an interruption, and are checked before use. 28 English voices, US and UK.
- **Say it like** on each character card: type how a name sounds, for example `shi-VAWN`, and every voice engine says it that way.
- Run `npm install` again: `@huggingface/transformers`, `onnxruntime-node` and `number-to-words` are new. `sharp` is replaced by an empty stub, so no LGPL image library is installed.
- The license of every component that ships or is downloaded is in `THIRD_PARTY_NOTICES.md`.
```

- [ ] **Step 3: Check the wording**

Run:
```bash
node -e "const dash = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']'); for (const file of ['README.md', 'CHANGELOG.md']) if (dash.test(require('fs').readFileSync(file, 'utf8'))) { console.log('dash in', file); process.exit(1); } console.log('no dashes');"
grep -c 'Built-in voices' README.md
```
Expected: `no dashes` (the README and changelog use no em-dashes or en-dashes), and a count of at least 3.

- [ ] **Step 4: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; the build ends without errors.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: built-in voices, Say it like, and where the licenses are

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section or requirement | Where |
| --- | --- |
| Goal: free voices on the CPU, recommended for anyone without a voice server | Tasks 5, 6, 7 |
| Out of scope: cloning, other languages, GPU, part-of-speech rules | Global Constraints; Task 1 keeps `DEFAULT` readings |
| Licensing: nothing GPL or LGPL, no kokoro-js, about 10 lines of transformers.js calls | Task 2 (guard, stub), Task 5 (`worker.js`, espeak hook) |
| Licensing: `sharp` replaced by an empty stub through `overrides` | Task 2 |
| Licensing: `THIRD_PARTY_NOTICES.md` with every component and its license text | Task 9 |
| Release gate: Misaki word-list provenance | Global Constraints; Task 4 (`release-gate.json`, upload held by Mariano); Task 10 (release workflow step) |
| 1. Engine id `kokoro`, local not hosted, prespeak and free labels like Chatterbox | Task 6 (server), Task 7 (`LOCAL_ENGINES` in the page) |
| 1. Voice ids `kokoro:<name>`, label, accent, gender from the prefix, English only | Task 3 (`voiceList`), Task 4 (28 voices), Task 6 |
| 1. Cache key: engine, model hash, G2P version, voice, text | Task 3 (`cacheIdentity`), Task 6 (`version: 4` identity) |
| 2. One long-lived worker; `utilityProcess` under Electron, `fork` under Node | Task 5; proven in the packed app by Task 10 |
| 2. One request at a time, in order; 60 s limit with a clear message | Task 5 |
| 2. Unload after 10 minutes idle; stopped when the app quits | Task 5 (`idleMs`, the `exit` handler, `disconnect` in the worker) |
| 2. Files `worker.js`, `g2p.js`, `client.js` | Tasks 1 and 5 (plus `assets.js`, Task 3) |
| 3. Files and sizes; one pinned GitHub release; manifest with URL, size, SHA-256; refuse a bad hash | Tasks 3 and 4 |
| 3. Stored in `<SCRIPT_GLOW_HOME or userData>/models/kokoro-v1/`; resume; temporary name first | Task 3 (`.part` files, `Range`), Task 6 (`modelsDir`) |
| 3. Installer grows only by the runtime | Task 9 (runtime unpacked, no model files packed) |
| 4. Welcome: first choice, recommended, saves at once, starts the download with progress | Task 7 |
| 4. Cast can be set up while downloading; rendering waits | Task 6 (static voice list, `settled()`), Task 7 (status line) |
| 4. Settings card **Built-in voices**, "Free · Private · No setup", progress, Ready, **Remove downloaded voices** | Task 7 |
| 4. Slow or failed download: plain message and **Try again**; other engines stay available | Task 3 (messages), Task 7 (panel) |
| 5. **Say it like** box, capitals mark stress | Task 8 (box), Task 1 (respelling rule) |
| 5. Replaces the name in the text sent to every engine | Task 8 (`sayItLike` in `renderInputs`) |
| 5. Saved in the project, part of the render key, only lines with the name re-render | Task 8 (`validatePreferences`, browser check) |
| Error handling: network, full disk, hash mismatch; nothing partial loaded | Task 3 |
| Error handling: worker crash restarts once, second crash fails the render | Task 5 |
| Error handling: files missing at render time, with a button to download | Task 6 (message), Task 7 (button in the job error) |
| Tests: G2P (20 lines, stems, clitics, numbers, times, ALL CAPS, respelling) | Task 1; real word lists in Task 4 and CI (Task 10) |
| Tests: worker protocol with a fake model | Task 5 |
| Tests: downloads against a local fake server | Task 3 |
| Tests: license check in `npm test` | Task 2 |
| Tests: end-to-end with the real model in the CI desktop job, files cached; by hand on Mac and Windows | Task 10 (CI and the Windows laptop), Task 5 Step 7 (Mac) |
| Tests: browser checks for the welcome, progress, Settings card, Say it like | Tasks 7 and 8 |
| Risk: speed on a low-end Windows laptop | Task 10, Step 6 measures it. Rendering ahead in the background above 2 s per line is not planned here; it is a follow-up if the measurement calls for it |
| Risk: some voices sound flat | Task 3 (`RANK`, best-rated voices first) |
| Risk: large first download | Task 3 (resume), Task 7 (progress) |

## Self-review notes

- Placeholder scan: no step says "TBD", "handle errors" or "similar to". Values that only exist after a run (hashes, revisions, timings) are produced by the scripts in the same step and checked by a stated command.
- Type consistency: `KokoroState` in `src/main.ts` is the exact shape the `/api/kokoro` routes return (`createDownloader().state()` plus `ready`). `createKokoroClient().speak(voice, text)` takes the bare voice name; `server/app.js` strips `kokoro:` before calling it. `loadG2P(dir, { british })` reads the `g2p/` folder that Task 4 fills and the worker passes. `tests/fixtures/fake-kokoro-worker.js` speaks the same messages as `server/kokoro/worker.js` and is shared by Tasks 5, 6 and 7.
- Tested before writing: the code for Tasks 1, 3, 5, 6, 7 and 8 ran green in a scratch copy of this branch (G2P, downloader, client, engine tests, the Settings and first-run browser checks, the new browser checks). The model-dependent steps (Task 4 and the real-worker runs) need the downloaded files and have not been run.
