// A .sgbackup made by the desktop app: 8-byte magic, a big-endian uint32 metadata length, the
// metadata JSON, then each WAV named in `files`, in order. The phone only reads it. The desktop
// writer and its full validation live in server/projects.js (backup, restore).
import { parseScript, type ScriptLine } from '../../src/parser.ts';
import type { Cue } from '../../src/playback.ts';

export interface Preferences { name: string; role: string; source: string; mode: 'full' | 'practice'; rate: number; hide: boolean; hint: boolean; wait: boolean; autoContinue: boolean; holdMs: number; loop: boolean }
export interface Render { key: string; title?: string; result: { fullUrl: string; practiceUrl: string; duration: number; cues: Cue[] } }
export interface Project { id: string; updatedAt: string; preferences: Preferences; renders: Render[] }
export interface Backup { project: Project; audio: Map<string, Blob> }
export interface SceneTrack { key: string; title: string; duration: number; cues: Cue[]; full: string; practice: string; lines: ScriptLine[] }

const MAGIC = 'SGLOWB01';
const AUDIO_NAME = /^[a-f0-9-]{36}-(full|practice)\.wav$/;
const fail = (message: string) => new Error(message);
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

export async function readBackup(buffer: ArrayBuffer): Promise<Backup> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) throw fail('This is not a Script Glow backup.');
  const metaSize = new DataView(buffer).getUint32(8);
  if (!metaSize || 12 + metaSize > bytes.length) throw fail('The backup is cut short. Send it again from your Mac.');
  let meta: { version?: number; project?: Project; files?: { name: string; size: number; sha256: string }[] };
  try { meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + metaSize))); } catch { throw fail('The backup is damaged. Send it again from your Mac.'); }
  const project = meta.project;
  if (meta.version !== 1 || !Array.isArray(meta.files) || !project?.preferences || !Array.isArray(project.renders)) throw fail('This backup comes from a newer Script Glow. Update the app.');
  const audio = new Map<string, Blob>();
  let offset = 12 + metaSize;
  for (const file of meta.files) {
    if (!AUDIO_NAME.test(file.name) || !Number.isSafeInteger(file.size) || offset + file.size > bytes.length) throw fail('The backup is cut short. Send it again from your Mac.');
    const wav = bytes.subarray(offset, offset + file.size);
    if (hex(await crypto.subtle.digest('SHA-256', wav)) !== file.sha256) throw fail('The backup audio is damaged. Send it again from your Mac.');
    audio.set(file.name, new Blob([wav], { type: 'audio/wav' }));
    offset += file.size;
  }
  if (offset !== bytes.length) throw fail('The backup is damaged. Send it again from your Mac.');
  return { project, audio };
}

const fileName = (url: string) => url.slice(url.lastIndexOf('/') + 1);

// Each render is one playable scene. The desktop keeps older renders of the same lines (another
// voice, another pause), newest last, so only the newest of each span is shown.
export function sceneTracks(project: Project): SceneTrack[] {
  const scenes = parseScript(project.preferences.source).scenes;
  const all = scenes.flatMap(scene => scene.lines);
  const tracks = new Map<string, SceneTrack>();
  for (const render of project.renders) {
    const { cues, duration, fullUrl, practiceUrl } = render.result;
    const first = all.findIndex(line => line.id === cues[0]?.lineId);
    const last = all.findIndex(line => line.id === cues[cues.length - 1]?.lineId);
    const title = render.title ?? scenes.find(scene => scene.lines.some(line => line.id === cues[0]?.lineId))?.title ?? 'Scene';
    const lines = first >= 0 && last >= first ? all.slice(first, last + 1) : [];
    const span = `${cues[0]?.lineId}:${cues[cues.length - 1]?.lineId}`;
    tracks.delete(span);
    tracks.set(span, { key: render.key, title, duration, cues, full: fileName(fullUrl), practice: fileName(practiceUrl), lines });
  }
  return [...tracks.values()];
}
