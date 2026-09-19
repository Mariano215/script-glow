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
const PUNCT = ';:,.!?—…"“”()';
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
    const tokens = (text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*'?|[;:,.!?—…"“”()]+|\S/g) ?? [])
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
