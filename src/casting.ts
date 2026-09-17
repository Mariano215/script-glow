import type { ParsedScript } from './parser.ts';
import { voiceCatalog } from './voice-catalog.ts';

export type VoiceGender = 'female' | 'male' | 'unknown';
export type GenderChoice = VoiceGender | 'auto';
export interface CharacterProfile { gender: VoiceGender; evidence: string; source?: 'script' | 'ai' | 'none' | 'conflict' }
export type NameGuesses = Record<string, VoiceGender>;
export function validGuesses(value: unknown): NameGuesses {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([name, gender]) => name.length > 0 && name.length <= 100 && typeof gender === 'string' && ['female', 'male', 'unknown'].includes(gender)).slice(0, 500));
}
export function withNameGuesses(profiles: Record<string, CharacterProfile>, guesses: NameGuesses): Record<string, CharacterProfile> {
  return Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name,
    profile.source === 'none' && Object.hasOwn(guesses, name)
      ? { gender: guesses[name], source: 'ai', evidence: guesses[name] === 'unknown' ? 'AI name guess inconclusive. Choose a voice type.' : `AI name guess: ${guesses[name]}. Names can be ambiguous; override if needed.` }
      : profile]));
}
export interface CastingConfig { preferredActorVoice: string; aliases: Record<string, string> }
export const defaultCastingConfig: CastingConfig = { preferredActorVoice: '', aliases: {} };
export const voiceIdentity = (voice: string, aliases: Record<string, string> = {}) => Object.hasOwn(aliases, voice) ? aliases[voice] : voice;
export function voiceOwners(voice: string, name: string, characters: string[], cast: Record<string, string>, aliases: Record<string, string> = {}): string[] {
  return characters.filter(other => other !== name && cast[other] && voiceIdentity(cast[other], aliases) === voiceIdentity(voice, aliases));
}
// Hosted engines add their voices here when they are listed.
export const voiceGenders: Record<string, VoiceGender> = {
  'Stock-Mica': 'female', 'Stock-Amber': 'female',
  'Stock-Granite': 'male', 'Stock-Ash': 'male',
  ...Object.fromEntries(Object.entries(voiceCatalog).map(([id, voice]) => [id, voice.gender])),
};
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const namePattern = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${escaped(name)}(?![\\p{L}\\p{N}_])`, 'iu');

// Extract script evidence separately; optional local AI guesses are merged later.
export function inferCharacters(source: string, script: ParsedScript): Record<string, CharacterProfile> {
  const directions = script.scenes.flatMap(scene => scene.lines.filter(line => line.kind === 'direction').map(line => line.text));
  const names = script.characters.map(name => ({ name, pattern: namePattern(name) }));
  return Object.fromEntries(names.map(({ name, pattern }) => {
    const evidence: { gender: VoiceGender; text: string }[] = [];
    const intro = new RegExp(`^\\s*${escaped(name)}\\s*(?:[,:(—–-]\\s*)?(?:(?:age[ds]?\\s*)?\\d{1,3}s?\\s*[,;):—–-]?\\s*)?(?:is\\s+)?(?:(?:a|an|the)\\s+)?(?:(?:young|older|old|elderly|middle-aged|teenage)\\s+)?(female|male|woman|man|girl|boy)\\b`, 'iu');
    for (const row of source.split(/\r?\n/)) {
      const found = row.match(intro);
      if (found) evidence.push({ gender: /^(female|woman|girl)$/i.test(found[1]) ? 'female' : 'male', text: row.trim() });
      // Pronoun declarations in cast lists, e.g. ALEX (she/her).
      if (new RegExp(`^\\s*${escaped(name)}\\s*[(,:—–-]\\s*(?:she\\s*[/,]\\s*her|he\\s*[/,]\\s*him)\\b`, 'iu').test(row)) {
        evidence.push({ gender: /\bshe\b/i.test(row) ? 'female' : 'male', text: row.trim() });
      }
    }
    for (const text of directions) {
      if (!pattern.test(text) || names.filter(candidate => candidate.pattern.test(text)).length !== 1) continue;
      // Subject/reflexive pronouns in a one-character direction are usable cues;
      // dialogue and ambiguous multi-character descriptions are excluded.
      if (/\b(?:she|herself)\b/i.test(text)) evidence.push({ gender: 'female', text });
      if (/\b(?:he|himself)\b/i.test(text)) evidence.push({ gender: 'male', text });
    }
    const genders = new Set(evidence.map(item => item.gender));
    return [name, genders.size === 1 ? { gender: evidence[0].gender, evidence: evidence[0].text.slice(0, 180), source: 'script' } : { gender: 'unknown', source: genders.size > 1 ? 'conflict' : 'none', evidence: genders.size > 1 ? 'Conflicting script cues. Choose a voice type.' : 'No clear gender cues in the script. Choose a voice type.' }];
  }));
}

export function resolvedGender(profile: CharacterProfile | undefined, choice: GenderChoice | undefined): VoiceGender {
  return choice && choice !== 'auto' ? choice : profile?.gender || 'unknown';
}
export function partnerVoices(available: string[], gender: VoiceGender, config: CastingConfig = defaultCastingConfig): string[] {
  const identity = (voice: string) => voiceIdentity(voice, config.aliases);
  const actorIdentity = config.preferredActorVoice ? identity(config.preferredActorVoice) : '';
  const seen = new Set<string>();
  const partners = available.filter(voice => {
    const canonical = identity(voice);
    if (canonical === actorIdentity || seen.has(canonical)) return false;
    // Prefer the actual voice ID to an alias when both are advertised.
    if (voice !== canonical && available.includes(canonical)) return false;
    seen.add(canonical);
    return true;
  });
  const preferred = partners.filter(voice => gender === 'unknown' || voiceGenders[identity(voice)] === gender);
  return preferred.sort((a, b) => Number(b.startsWith('Stock-')) - Number(a.startsWith('Stock-')) || a.localeCompare(b));
}
export function assignCast(characters: string[], available: string[], role: string, current: Record<string, string>, profiles: Record<string, CharacterProfile>, choices: Record<string, GenderChoice>, manual: Record<string, boolean>, config: CastingConfig = defaultCastingConfig): Record<string, string> {
  const cast = { ...current };
  if (!available.length) return cast;
  const identity = (voice: string) => voiceIdentity(voice, config.aliases);
  const actorIdentity = config.preferredActorVoice ? identity(config.preferredActorVoice) : '';
  const actorVoice = available.includes(config.preferredActorVoice) ? config.preferredActorVoice : available.find(voice => identity(voice) === actorIdentity);
  const needsVoice = (name: string) => {
    const gender = resolvedGender(profiles[name], choices[name]);
    return !available.includes(cast[name]) || (!manual[name] && ((name !== role && identity(cast[name]) === actorIdentity) || (gender !== 'unknown' && voiceGenders[identity(cast[name])] !== gender)));
  };
  if (characters.includes(role) && actorVoice && !manual[role]) cast[role] = actorVoice;
  // Reserve choices across the whole cast before filling any gaps.
  const used = new Set(characters.filter(name => !needsVoice(name) || name === role && cast[name] === actorVoice).map(name => identity(cast[name])));
  for (const name of characters) {
    const gender = resolvedGender(profiles[name], choices[name]);
    if (name === role && actorVoice && !manual[name]) cast[name] = actorVoice;
    else if (needsVoice(name)) {
      const pool = partnerVoices(available, gender, config);
      const candidates = pool.length ? pool : partnerVoices(available, 'unknown', config);
      cast[name] = candidates.find(voice => !used.has(identity(voice))) || partnerVoices(available, 'unknown', config).find(voice => !used.has(identity(voice))) || candidates[0] || available[0];
    }
    used.add(identity(cast[name]));
  }
  return cast;
}
