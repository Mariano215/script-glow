export interface HighlightPreferences {
  highlightCharacter: string;
  characterColor: string;
  spokenColor: string;
}
export const highlightDefaults: HighlightPreferences = { highlightCharacter: '@role', characterColor: '#60a5fa', spokenColor: '#f2b544' };
export function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}
export function readHighlights(value: Partial<HighlightPreferences>): HighlightPreferences {
  return {
    highlightCharacter: typeof value.highlightCharacter === 'string' && value.highlightCharacter.length <= 100 ? value.highlightCharacter : highlightDefaults.highlightCharacter,
    characterColor: safeColor(value.characterColor, highlightDefaults.characterColor),
    spokenColor: safeColor(value.spokenColor, highlightDefaults.spokenColor),
  };
}
export const highlightedCharacter = (preferences: HighlightPreferences, role: string): string => preferences.highlightCharacter === '@role' ? role : preferences.highlightCharacter;

export interface RevealPreferences { hide: boolean; listen: boolean }
// Listen only covers every character, so it already includes "hide my lines".
// ponytail: two booleans, not a level enum. Collapse them when a third level
// (first-letter hints) actually lands; a two-value enum is churn for no gain.
export const lineHidden = (preferences: RevealPreferences, mine: boolean, revealed: boolean): boolean =>
  !revealed && (preferences.listen || (preferences.hide && mine));
