export interface Cue { lineId: string; start: number; end: number; character: string }
export interface RatePreferences { rate: number; mode: 'full' | 'practice'; role: string }
export interface WaitPreferences { mode: 'full' | 'practice'; role: string; wait: boolean }

// In practice mode the actor's own line is a baked silence. Playing the file faster
// would shorten the space they have to speak in, so that span always runs at 1x.
// Full cast reads their line aloud, so there it follows the chosen speed like any other line.
export const cueRate = (preferences: RatePreferences, cueCharacter: string | undefined): number =>
  preferences.mode === 'practice' && !!cueCharacter && cueCharacter === preferences.role ? 1 : preferences.rate;

export const cueAt = (cues: Cue[] | undefined, at: number): Cue | undefined =>
  cues?.find(cue => at >= cue.start && at < cue.end);

// Previous goes back to the start of the cue that is already under way, and only to the
// cue before it when the current one has barely begun. That is what a repeated press does
// on any player, and it saves a second press when the actor wants this line again.
export function stepCue(cues: Cue[] | undefined, at: number, direction: 1 | -1): number | null {
  if (!cues?.length) return null;
  if (direction === 1) return cues.find(cue => cue.start > at + 0.001)?.start ?? null;
  const earlier = cues.filter(cue => cue.start < at - 0.25);
  return earlier.length ? earlier[earlier.length - 1].start : at > 0.25 ? 0 : null;
}

// Wait only where the actor's line is silence. In full cast the app reads it aloud,
// so there is nothing to wait for. A cue already resumed is not waited on twice.
export const shouldWait = (preferences: WaitPreferences, cue: Cue | undefined, resumedLineId: string): boolean =>
  !!cue && preferences.wait && preferences.mode === 'practice' && !!preferences.role
  && cue.character === preferences.role && cue.lineId !== resumedLineId;

// Keep every space and mark, drop the rest of each word. Enough to prompt a line, not to read it.
export const firstLetters = (text: string): string => text.replace(/(\p{L})(\p{L}*)/gu, (_, first) => first);

// A and B name lines, not seconds, so the range survives a re-render at a different length.
export function loopRange(cues: Cue[] | undefined, a: string, b: string): { start: number; end: number } | null {
  const from = cues?.find(cue => cue.lineId === a);
  const to = cues?.find(cue => cue.lineId === b);
  if (!from || !to) return null;
  const [first, last] = from.start <= to.start ? [from, to] : [to, from];
  return { start: first.start, end: last.end };
}

// Additive rehearsal: learn line one, repeat it, then lines one and two, and so on. The block
// always starts at the beginning, because recalling from the top is the point of the method.
// The block grows by one of the actor's own lines, taking the cues before it along; a scene where
// the actor never speaks grows a line at a time instead.
export const buildTargets = (cues: Cue[] | undefined, role: string): Cue[] => {
  const all = cues ?? [];
  const mine = role ? all.filter(cue => cue.character === role) : [];
  return mine.length ? mine : all;
};
export const buildEnd = (targets: Cue[], step: number): number | null =>
  targets.length ? targets[Math.min(Math.max(step, 0), targets.length - 1)].end : null;
// One pass finished. Repeat the same block until the count is met, then take in one more line.
export function buildNext(step: number, pass: number, repeats: number, total: number): { step: number; pass: number; done: boolean } {
  if (pass < Math.max(1, repeats)) return { step, pass: pass + 1, done: false };
  if (step + 1 < total) return { step: step + 1, pass: 1, done: false };
  return { step, pass, done: true };
}

// Listening mode. The actor's line in practice mode is baked silence, so while the app waits
// the only sound in the room is the actor, and the microphone level alone can say when they
// finished. A transcript cannot: the server needs the finished clip and answers about a second
// later, which is far too late to come in on. Space and Continue keep working either way.
export type ListenPhase = 'calibrating' | 'quiet' | 'speaking' | 'done';
export interface ListenState { phase: ListenPhase; floor: number; since: number; edge: number }
const SETTLE_MS = 150, CALIBRATE_MS = 300, SPEECH_MS = 120, MIN_FLOOR = 0.015, MAX_FLOOR = 0.25;
export const listenStart = (at: number): ListenState => ({ phase: 'calibrating', floor: 0, since: at, edge: at });

// One microphone level, between 0 and 1. `edge` is when the current run began: the run of
// loud samples while quiet, the run of silent ones while speaking.
export function listenStep(state: ListenState, level: number, at: number, holdMs: number): ListenState {
  if (state.phase === 'done') return state;
  if (state.phase === 'calibrating') {
    // The room sets its own floor, so a fan or a street outside does not read as a line.
    // Capped, because an actor who speaks straight away would otherwise raise the floor
    // above their own voice and never be heard.
    // A microphone that has just opened gives a loud burst before the room (seen on iOS at about
    // 100 ms). Read into the floor, it lifts it to the cap and speech is never heard, so it is skipped.
    if (at - state.since < SETTLE_MS) return state;
    if (at - state.since < CALIBRATE_MS) return { ...state, floor: Math.max(state.floor, level) };
    return { phase: 'quiet', floor: Math.min(Math.max(state.floor * 2, MIN_FLOOR), MAX_FLOOR), since: state.since, edge: at };
  }
  const loud = level > state.floor;
  if (state.phase === 'quiet') {
    if (!loud) return { ...state, edge: at };
    return at - state.edge >= SPEECH_MS ? { ...state, phase: 'speaking', edge: at } : state;
  }
  if (loud) return { ...state, edge: at };
  return at - state.edge >= holdMs ? { ...state, phase: 'done' } : state;
}

// What the actor said, against the line as written. The transcript arrives about a second after
// the wait has already been released, so this never decides timing: it only marks the line as
// said, half said, or not this line at all. An actor is not judged on spelling or punctuation,
// and the transcription server labels the speaker, so both sides are reduced to bare words.
export type LineVerdict = 'said' | 'partial' | 'different';
const words = (text: string): string[] =>
  text.replace(/^\s*SPEAKER_\d+\s*:\s*/i, '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);

export function lineMatch(spoken: string, expected: string): { score: number; verdict: LineVerdict } {
  const wanted = words(expected);
  if (!wanted.length) return { score: 1, verdict: 'said' };
  // A word the actor said is spent, so repeating one word does not cover a line.
  const heard = words(spoken);
  const pool = new Map<string, number>();
  for (const word of heard) pool.set(word, (pool.get(word) ?? 0) + 1);
  let found = 0;
  for (const word of wanted) {
    const left = pool.get(word) ?? 0;
    if (left > 0) { pool.set(word, left - 1); found++; }
  }
  const score = found / wanted.length;
  return { score, verdict: score >= 0.7 ? 'said' : score >= 0.4 ? 'partial' : 'different' };
}
