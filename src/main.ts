// Local project boundary: imported text and backups are untrusted; escape UI text,
// use server-issued UUID paths, retain recovery drafts, and never overwrite a
// newer preference revision. Completed audio is published by the local API only.
import './style.css';
import './screenplay.css';
import './casting.css';
import './projects.css';
import './studio.css';
import { highlightDefaults, readHighlights, highlightedCharacter, lineHidden, safeColor, type HighlightPreferences } from './highlights';
import { parseScript, sceneIncludes, spokenLines, SAMPLE, type Scene, type ScriptLine } from './parser';
import { buildEnd, buildNext, buildTargets, cueAt, cueRate, firstLetters, loopRange, shouldWait, stepCue, type Cue } from './playback';
import { browserMp4, browserMp4Type, castingFileName, castingFit, countBeep, monoWav, setReaderLevel, mixerState, openRecorder, resumeMixer, takeClock, takeContainer, takeLabel, takeNeedsConverting, type Take, type TakeRecorder } from './selftape';
import { inferCharacters, assignCast, resolvedGender, voiceGenders, voiceOwners, validGuesses, withNameGuesses, type NameGuesses, type GenderChoice } from './casting';
import { voiceCatalog } from './voice-catalog';
import { openHelp } from './help';

interface RenderResult { fullUrl: string; practiceUrl: string; duration: number; cues: Cue[] }
interface Job { id: string; status: 'queued' | 'running' | 'complete' | 'error'; completed: number; total: number; error?: string; result?: RenderResult }
interface Preferences extends HighlightPreferences { source: string; name: string; role: string; cast: Record<string, string>; guesses: NameGuesses; genders: Record<string, GenderChoice>; manualVoices: Record<string, boolean>; sceneId: string; gap: number; directions: boolean; hide: boolean; listen: boolean; hint: boolean; wait: boolean; build: boolean; buildRepeats: number; tapeW: number; tapeH: number; loopA: string; loopB: string; tapeOverlay: boolean; tapeX: number; tapeY: number; follow: boolean; loop: boolean; rate: number; mode: 'full' | 'practice' ; readerLevel: number }
const defaults: Preferences = { ...highlightDefaults, source: SAMPLE, name: 'The Last Light', role: 'MARCUS', cast: {}, guesses: {}, genders: {}, manualVoices: {}, sceneId: 'scene-1', gap: 1, directions: false, hide: false, listen: false, hint: false, wait: false, build: false, buildRepeats: 2, loopA: '', loopB: '', tapeOverlay: false, readerLevel: 1, tapeX: 50, tapeY: 78, tapeW: 0, tapeH: 0, follow: true, loop: false, rate: 1, mode: 'full' };
// Defined before restored() runs: used any earlier, they throw, and the catch in restored() would
// quietly replace a saved draft with the sample script.
// The script can sit over the camera so the actor's eyeline stays near the lens. Its place is
// kept as a percentage of the frame, so it lands in the same spot on any screen size.
// Nought means "whatever the stylesheet says". Anything else is the size the actor dragged to.
const tapeSize = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(2000, Math.round(value)) : 0;
const tapePercent = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(98, Math.max(2, value)) : fallback;
function restored(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem('script-glow:v1') || '{}') as Partial<Preferences>;
    const text = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback;
    const record = (value: unknown, valid: (item: unknown) => boolean) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, item]) => valid(item))) : {};
    return { ...defaults, ...saved, ...readHighlights(saved), guesses: validGuesses(saved.guesses),
      name: text(saved.name, defaults.name), role: text(saved.role, defaults.role), sceneId: text(saved.sceneId, defaults.sceneId), mode: saved.mode === 'practice' ? 'practice' : 'full',
      genders: record(saved.genders, item => ['auto', 'male', 'female', 'unknown'].includes(item as string)) as Record<string, GenderChoice>,
      manualVoices: record(saved.manualVoices, item => typeof item === 'boolean') as Record<string, boolean>,
      directions: saved.directions === true, follow: saved.follow !== false, loop: saved.loop === true, source: typeof saved.source === 'string' ? saved.source : SAMPLE, cast: record(saved.cast, item => typeof item === 'string') as Record<string, string>, hide: saved.hide === true, listen: saved.listen === true, hint: saved.hint === true, wait: saved.wait === true, build: saved.build === true, buildRepeats: [1, 2, 3, 4, 5].includes(Number(saved.buildRepeats)) ? Number(saved.buildRepeats) : 2, loopA: typeof saved.loopA === 'string' ? saved.loopA : '', loopB: typeof saved.loopB === 'string' ? saved.loopB : '', tapeOverlay: saved.tapeOverlay === true, readerLevel: typeof saved.readerLevel === 'number' && Number.isFinite(saved.readerLevel) ? Math.min(1.5, Math.max(0, saved.readerLevel)) : 1, tapeX: tapePercent(saved.tapeX, 50), tapeY: tapePercent(saved.tapeY, 78), tapeW: tapeSize(saved.tapeW), tapeH: tapeSize(saved.tapeH), gap: Math.min(5, Math.max(0, Number(saved.gap ?? 1))), rate: [0.75, 1, 1.25, 1.5].includes(Number(saved.rate)) ? Number(saved.rate) : 1 };
  } catch { return { ...defaults }; }
}
let prefs = restored();
let parsed = parseScript(prefs.source);
let profiles = inferCharacters(prefs.source, parsed);
let voices: string[] = [];
// Which engine speaks the cast, and what a hosted engine says about each of its voices.
let voiceEngine = 'chatterbox';
let liveVoices: Record<string, { label: string; gender: string; accent?: string }> = {};
const hostedEngine = () => voiceEngine !== 'chatterbox';
const engineName = () => PROVIDERS[voiceEngine]?.label ?? 'Chatterbox';
let castingConfig = { preferredActorVoice: '', aliases: {} as Record<string, string>, previewUrl: '' };
let profileReady = false;
const SCREENS = ['rehearsal', 'cast', 'selftape', 'projects', 'settings'] as const;
type Screen = typeof SCREENS[number];
const screenFromHash = (): Screen => SCREENS.find(name => location.hash === `#${name}`) ?? 'rehearsal';
let screen: Screen = screenFromHash();
// Self-tape state. The camera is off until the actor turns it on and is released on every exit.
const TAKE_LIMIT_MS = 5 * 60 * 1000;
let recorder: TakeRecorder | null = null;
let takes: Take[] = [];
let countdown = 0;
let countdownTimer: ReturnType<typeof setTimeout> | undefined;
// What the next recording is: a scene take with the cast, or a slate on its own.
let takeKind: 'scene' | 'slate' = 'scene';
const SLATE_LIMIT_MS = 60 * 1000;
// Trimming one take into a finished MP4. Start and end are seconds in that take.
let trimming: { file: string; start: number; end: number; progress: number } | null = null;
let tools = { ffmpeg: false, ffmpegVersion: '' };
async function loadTools() { try { tools = await (await fetch('/api/tools')).json(); } catch { /* the page offers the browser fallback */ } }
const actorNameKey = 'script-glow:actor-name';
const actorName = () => { try { return localStorage.getItem(actorNameKey) ?? ''; } catch { return ''; } };
let takeNotice = '';
let takeError = false;
let reviewing = '';
let takeBusy = false;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let modeBeforeTake: 'full' | 'practice' | null = null;
// True when the scene is playing audio made before parentheticals were silenced.
let legacyAudio = false;
// Filling the screen puts the class on <body>, not on the self-tape section, because that
// section is rebuilt on every render and a rebuilt element drops out of fullscreen.
let takeFocus = false;
function setTakeFocus(on: boolean) {
  takeFocus = on;
  document.body.classList.toggle('tape-focus', on);
  if (on) void document.documentElement.requestFullscreen?.().catch(() => { /* the class alone still fills the page */ });
  else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  render();
}
addEventListener('fullscreenchange', () => { if (takeFocus && !document.fullscreenElement) setTakeFocus(false); });
// Additive rehearsal state: which block is being learned, and which pass through it.
let buildStep = 0;
let buildPass = 1;
let buildDone = false;
const buildList = () => buildTargets(result?.cues, prefs.role);
const restartBuild = () => { buildStep = 0; buildPass = 1; buildDone = false; };
let ttsOnline = false;
let connectionChecked = false;
let notice = '';
let noticeError = false;
let importing = false;
let aiLoading = false;
let aiMessage = '';
let aiSource = prefs.source;
let aiEpoch = 0;
let stagedGuesses: NameGuesses = {};
let job: Job | null = null;
let result: RenderResult | null = null;
interface ProjectSummary { id: string; name: string; updatedAt: string; renderCount: number }
interface ProjectDocument { id: string; revision: number; createdAt: string; updatedAt: string; preferences: Preferences; renders: { key: string; result: RenderResult }[]; warnings?: string[] }
interface RecoveryDraft { id: string; revision: number; synced: string; preferences: Preferences; migrating?: boolean }
let projectId = '';
let projectRevision = 0;
let projectList: ProjectSummary[] = [];
let libraryReady = false;
let libraryBusy = true;
let libraryError = '';
let saveError = '';
let saveConflict = false;
let lastSynced = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savePromise: Promise<boolean> | null = null;
const projectMarkerKey = 'script-glow:project:v1';
const legacyWasPresent = (() => { try { return !!localStorage.getItem('script-glow:v1'); } catch { return false; } })();
const renderStorageKey = 'script-glow:renders:v1';
let cacheSource = prefs.source;
function isRenderResult(value: unknown): value is RenderResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RenderResult>;
  const localAudio = (url: unknown) => typeof url === 'string' && /^(?:\/audio|\/api\/projects\/[a-f0-9-]{36}\/audio)\/[a-zA-Z0-9-]+-(full|practice)\.wav$/.test(url);
  if (!localAudio(candidate.fullUrl) || !localAudio(candidate.practiceUrl) || typeof candidate.duration !== 'number' || !Number.isFinite(candidate.duration) || candidate.duration <= 0 || candidate.duration > 86400 || !Array.isArray(candidate.cues) || candidate.cues.length > 5000) return false;
  const duration = candidate.duration;
  return candidate.cues.every((value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const cue = value as Partial<Cue>;
    return typeof cue.lineId === 'string' && cue.lineId.length <= 300 && typeof cue.character === 'string' && cue.character.length <= 300 && typeof cue.start === 'number' && Number.isFinite(cue.start) && cue.start >= 0 && typeof cue.end === 'number' && Number.isFinite(cue.end) && cue.end >= cue.start && cue.end <= duration + 0.01;
  });
}
function restoredRenders(): Map<string, RenderResult> {
  const restored = new Map<string, RenderResult>();
  try {
    const raw = localStorage.getItem(renderStorageKey);
    if (!raw || raw.length > 1_000_000) return restored;
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== 'object' || !('source' in stored) || stored.source !== prefs.source || !('entries' in stored) || !Array.isArray(stored.entries)) return restored;
    for (const entry of stored.entries.slice(-20)) {
      if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && entry[0].length <= 500_000 && isRenderResult(entry[1])) restored.set(entry[0], entry[1]);
    }
  } catch { /* A malformed audio index must never prevent opening the saved script. */ }
  return restored;
}
const completedScenes = restoredRenders();
function persistRenders() {
  const entries = [...completedScenes.entries()].slice(-20);
  while (entries.length) {
    const serialized = JSON.stringify({ source: prefs.source, entries });
    if (serialized.length <= 1_000_000) {
      try { localStorage.setItem(renderStorageKey, serialized); return; } catch { /* Keep script preferences intact; evict only optional audio references. */ }
    }
    entries.shift();
  }
  try { localStorage.removeItem(renderStorageKey); } catch { /* Browser storage can be unavailable. Audio remains usable this session. */ }
}
let generation = 0;
let revealed = new Set<string>();
let activeLine = '';
let loadedMode: Preferences['mode'] | null = null;
let audioLoadVersion = 0;
let displayedSceneId = '';
let displayedSource = '';
const app = document.querySelector<HTMLDivElement>('#app')!;
const audio = document.querySelector<HTMLAudioElement>('#scene-audio')!;
const currentCue = (at = audio.currentTime) => cueAt(result?.cues, at);
// A marked exchange and the element's own loop cannot both run: one repeats a span, the other the file.
const markedRange = () => prefs.loop && prefs.loopA && prefs.loopB ? loopRange(result?.cues, prefs.loopA, prefs.loopB) : null;
const applyRate = () => { audio.playbackRate = cueRate(prefs, currentCue()?.character); audio.loop = prefs.loop && !prefs.build && !markedRange(); };
// The app pauses on the actor's silent turn and waits to be released; resuming skips that span.
let waitingFor = '';
let resumedLine = '';
function releaseWait() {
  const cue = result?.cues.find(item => item.lineId === waitingFor);
  resumedLine = waitingFor; waitingFor = '';
  if (cue) audio.currentTime = cue.end;
  void audio.play().catch(error => flash(`Playback could not start: ${error.message}`, true));
}
let previewAudio: HTMLAudioElement | null = null;
let previewVoice = '';
let previewVersion = 0;
let previewMessage = '';
let previewLoading = false;
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const pretty = (value: string) => value.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
const time = (seconds: number) => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;
const icon = (name: string, size = 20) => {
  const paths: Record<string, string> = { play: '<path d="m9 5 11 7-11 7Z"/>', pause: '<path d="M8 5v14M16 5v14"/>', upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>', download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>', edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>', chevron: '<path d="m9 5 7 7-7 7"/>', back: '<path d="M5 4v16m15-16L8 12l12 8Z"/>', forward: '<path d="M19 4v16M4 4l12 8L4 20Z"/>', loop: '<path d="m16 2 4 4-4 4M4 11V9a3 3 0 0 1 3-3h13M8 22l-4-4 4-4m12-1v2a3 3 0 0 1-3 3H4"/>', book: '<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15"/>', check: '<path d="m5 12 4 4L20 5"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', wave: '<path d="M3 10v4m4-8v12m5-16v20m5-16v12m4-8v4"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
};
function persist() {
  try {
    localStorage.setItem('script-glow:v1', JSON.stringify(prefs));
    if (projectId) localStorage.setItem(projectMarkerKey, JSON.stringify({ id: projectId, revision: projectRevision, synced: lastSynced, preferences: prefs }));
  } catch { notice = 'Browser recovery storage is full. Check Saved locally before closing this tab.'; noticeError = true; }
  if (libraryReady && !libraryBusy && JSON.stringify(prefs) !== lastSynced && !saveConflict) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void saveProjectNow(); }, 350);
  }
  updateSaveUI();
}
function saveLabel() {
  if (libraryError) return 'Library unavailable — browser recovery only';
  if (libraryBusy || !libraryReady) return 'Opening local library…';
  if (saveConflict) return 'Save conflict — keep this draft as a new project';
  if (saveError) return 'Save failed — changes kept in this browser';
  return savePromise || JSON.stringify(prefs) !== lastSynced ? 'Saving to disk…' : 'Saved locally';
}
function updateSaveUI() {
  const status = document.querySelector('#project-save-status');
  if (status) { status.textContent = saveLabel(); status.classList.toggle('save-error', !!(saveError || libraryError || saveConflict)); }
  const retry = document.querySelector<HTMLButtonElement>('[data-action="retry-save"]');
  if (retry) retry.hidden = !(saveError || libraryError);
  const copy = document.querySelector<HTMLButtonElement>('[data-action="recover-project"]');
  if (copy) copy.hidden = !saveConflict;
}
async function saveProjectNow(): Promise<boolean> {
  clearTimeout(saveTimer);
  if (savePromise) return savePromise;
  if (!libraryReady || !projectId || saveConflict) return false;
  saveError = '';
  savePromise = (async () => {
    try {
      while (JSON.stringify(prefs) !== lastSynced) {
        const snapshot = JSON.stringify(prefs);
        const document = await api<ProjectDocument>(`/api/projects/${projectId}`, { method: 'PUT', body: JSON.stringify({ revision: projectRevision, preferences: JSON.parse(snapshot) as Preferences }) });
        projectRevision = document.revision; lastSynced = snapshot;
        const summary = projectList.find(item => item.id === projectId);
        if (summary) { summary.name = document.preferences.name; summary.updatedAt = document.updatedAt; }
        persist();
      }
      return true;
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Could not save the project.';
      saveConflict = error instanceof Error && 'status' in error && error.status === 409;
      return false;
    }
  })();
  updateSaveUI();
  const success = await savePromise;
  savePromise = null; updateSaveUI();
  return success;
}
async function refreshProjectList() {
  const listing = await api<{ projects: ProjectSummary[]; warnings?: string[] }>('/api/projects');
  projectList = listing.projects;
  if (listing.warnings?.length) { notice = listing.warnings.join(' '); noticeError = true; }
}
function adoptProject(document: ProjectDocument) {
  libraryReady = false;
  prefs = { ...defaults, ...document.preferences, ...readHighlights(document.preferences), guesses: validGuesses(document.preferences.guesses) };
  projectId = document.id; projectRevision = document.revision; lastSynced = JSON.stringify(prefs);
  // Takes belong to one project: drop the old list, release the camera, and read the new one.
  takes = []; reviewing = ''; takeNotice = ''; takeError = false; void closeCamera(); void loadTakes().then(render);
  saveError = ''; saveConflict = false; libraryError = ''; aiEpoch++; stagedGuesses = {}; aiMessage = '';
  parsed = parseScript(prefs.source); cacheSource = prefs.source;
  completedScenes.clear();
  for (const entry of document.renders) if (typeof entry.key === 'string' && isRenderResult(entry.result)) completedScenes.set(entry.key, entry.result);
  castDefaults(); invalidate(true);
  if (document.warnings?.length) { notice = document.warnings.join(' '); noticeError = true; }
  libraryReady = true;
}
async function createProject(preferences: Preferences, id: string = crypto.randomUUID()) {
  return api<ProjectDocument>('/api/projects', { method: 'POST', body: JSON.stringify({ id, preferences }) });
}
async function migrateRenders(id: string, entries: [string, RenderResult][]) {
  let missing = 0;
  for (const [key, legacyResult] of entries) {
    if (!legacyResult.fullUrl.startsWith('/audio/')) continue;
    try { await api(`/api/projects/${id}/renders`, { method: 'POST', body: JSON.stringify({ key, result: legacyResult }) }); }
    catch (error) { if (error instanceof Error && 'status' in error && error.status === 404) missing++; else throw error; }
  }
  return missing;
}
async function openLibrary() {
  if (libraryReady) return;
  libraryBusy = true; libraryError = ''; render();
  const legacyEntries = [...completedScenes.entries()];
  try {
    let marker: RecoveryDraft | null = null;
    try { marker = JSON.parse(localStorage.getItem(projectMarkerKey) || 'null') as RecoveryDraft | null; } catch { /* Keep the legacy draft available. */ }
    await refreshProjectList();
    if (marker?.id && projectList.some(item => item.id === marker.id)) {
      const missing = marker.migrating ? await migrateRenders(marker.id, legacyEntries) : 0;
      const saved = await api<ProjectDocument>(`/api/projects/${marker.id}`);
      const pending = !marker.migrating && marker.preferences && typeof marker.synced === 'string' && JSON.stringify(marker.preferences) !== marker.synced;
      adoptProject(saved);
      if (missing) { notice = `${missing} old cached render(s) could not be found. Your script is saved; make the audio for those scenes again.`; noticeError = true; }
      if (pending) {
        prefs = { ...defaults, ...marker.preferences, guesses: validGuesses(marker.preferences.guesses) };
        parsed = parseScript(prefs.source); castDefaults(); invalidate(true);
        if (marker.revision !== saved.revision) { saveConflict = true; saveError = 'Another tab changed this project. Save your recovered draft as a new project.'; }
      }
    } else if (legacyWasPresent || marker?.preferences) {
      const id = marker?.id && /^[a-f0-9-]{36}$/.test(marker.id) ? marker.id : crypto.randomUUID();
      try { localStorage.setItem(projectMarkerKey, JSON.stringify({ id, revision: 0, synced: '', preferences: prefs, migrating: true })); } catch { /* Existing source stays in memory. */ }
      const created = await createProject(prefs, id);
      const missing = await migrateRenders(created.id, legacyEntries);
      adoptProject(await api<ProjectDocument>(`/api/projects/${created.id}`));
      notice = missing ? `Project saved. ${missing} old cached render(s) are no longer available; make the audio for those scenes again.` : 'Existing script and available completed renders saved in your local project library.';
      noticeError = missing > 0;
    } else if (projectList.length) adoptProject(await api<ProjectDocument>(`/api/projects/${projectList[0].id}`));
    else adoptProject(await createProject(prefs));
    await refreshProjectList();
  } catch (error) {
    libraryError = error instanceof Error ? error.message : 'Local library unavailable.';
    notice = `${libraryError} Your browser draft has not been discarded. Retry the library connection.`; noticeError = true;
  } finally { libraryBusy = false; persist(); render(); }
}
async function switchProject(id: string) {
  if (!id || id === projectId || busy() || libraryBusy) return;
  if (recorder?.recording && !confirm('A take is still recording. Switch project and lose it?')) return;
  libraryBusy = true; render();
  try {
    if (!await saveProjectNow()) throw new Error(saveError || 'Save the current project before switching.');
    const document = await api<ProjectDocument>(`/api/projects/${encodeURIComponent(id)}`);
    notice = ''; noticeError = false; adoptProject(document);
  }
  catch (error) { flash(error instanceof Error ? error.message : 'Could not open project.', true); }
  finally { libraryBusy = false; persist(); render(); void guessNames(); }
}
async function saveRecoveryCopy() {
  if (libraryBusy || busy()) return;
  libraryBusy = true; render();
  try {
    const copy = await createProject({ ...prefs, name: `${prefs.name.slice(0, 85)} — recovered` });
    adoptProject(copy); await refreshProjectList();
    notice = 'Draft saved as a separate project. The other version is unchanged.'; noticeError = false;
  } catch (error) { flash(error instanceof Error ? error.message : 'Could not save recovery copy.', true); }
  finally { libraryBusy = false; persist(); render(); }
}
async function restoreProject(file: File) {
  if (libraryBusy || busy()) return;
  if (file.size > 4 * 1024 ** 3) { flash('Choose a Script Glow backup smaller than 4 GiB.', true); return; }
  libraryBusy = true; render();
  try {
    if (!await saveProjectNow()) throw new Error(saveError || 'Finish saving the current project before restoring a backup.');
    const restored = await api<ProjectDocument>('/api/projects/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file, signal: AbortSignal.timeout(600000) });
    notice = 'Backup restored as a new project. Existing projects were not changed.'; noticeError = false;
    adoptProject(restored); await refreshProjectList();
  } catch (error) { flash(error instanceof Error ? error.message : 'Backup restore failed.', true); }
  finally { libraryBusy = false; persist(); render(); void guessNames(); }
}
window.addEventListener('beforeunload', event => {
  if (libraryBusy || libraryError || savePromise || libraryReady && JSON.stringify(prefs) !== lastSynced) { event.preventDefault(); event.returnValue = ''; }
});
function scene(): Scene | undefined {
  if (prefs.sceneId === 'full-script' && parsed.scenes.length) return { id: 'full-script', title: prefs.name, lines: parsed.scenes.flatMap(item => [
    { id: `heading-${item.id}`, character: 'Narrator', text: item.title, kind: 'direction' as const, format: 'heading' as const }, ...item.lines,
  ]) };
  return parsed.scenes.find(item => item.id === prefs.sceneId) || parsed.scenes[0];
}
function renderInputs(current: Scene, spoken = true) {
  // What the engine is asked to say, not what the page shows: parentheticals are notes.
  if (spoken) current = { ...current, lines: spokenLines(current.lines) };
  return { scene: current, ...(current.id === 'full-script' ? { scope: 'script' } : {}), voices: Object.fromEntries(Object.entries(prefs.cast).sort(([a], [b]) => a.localeCompare(b))), myCharacter: prefs.role, gapSeconds: prefs.gap, includeDirections: prefs.directions };
}
// Audio made before parentheticals were silenced is keyed by the text as it was written.
// It still plays; only a fresh render uses the new text. Nobody loses a rendered scene to an
// upgrade, and nobody has to wait for a GPU to hear a scene they already made.
function cachedRender(current: Scene): { result: RenderResult; key: string; legacy: boolean } | null {
  const key = JSON.stringify(renderInputs(current));
  const found = completedScenes.get(key);
  if (found) return { result: found, key, legacy: false };
  const legacyKey = JSON.stringify(renderInputs(current, false));
  const older = legacyKey === key ? undefined : completedScenes.get(legacyKey);
  return older ? { result: older, key: legacyKey, legacy: true } : null;
}
function busy() { return job?.status === 'queued' || job?.status === 'running'; }
// Switching scope or saving the script cancels the running job, so ask first.
function mayCancelRender() { return !busy() || confirm('Audio is still being made. Stop it and switch?'); }
const castCharacters = () => [...parsed.characters, ...(prefs.directions && !parsed.characters.includes('Narrator') ? ['Narrator'] : [])];
function castDefaults() {
  if (aiSource !== prefs.source) { aiSource = prefs.source; aiEpoch++; stagedGuesses = {}; aiMessage = ''; }
  profiles = withNameGuesses(inferCharacters(prefs.source, parsed), prefs.guesses);
  if (!parsed.characters.includes(prefs.role)) prefs.role = parsed.characters[0] || '';
  if (prefs.highlightCharacter && prefs.highlightCharacter !== '@role' && !parsed.characters.includes(prefs.highlightCharacter)) prefs.highlightCharacter = '@role';
  if (!voices.length || !profileReady) return;
  prefs.cast = assignCast(castCharacters(), voices, prefs.role, prefs.cast, profiles, prefs.genders, prefs.manualVoices, castingConfig);
}
function missingGuesses() {
  return parsed.characters.filter(name => profiles[name]?.source === 'none' && !Object.hasOwn(prefs.guesses, name) && !Object.hasOwn(stagedGuesses, name) && (!prefs.genders[name] || prefs.genders[name] === 'auto'));
}
function applyGuesses() {
  if (busy()) return;
  prefs.guesses = { ...prefs.guesses, ...stagedGuesses }; stagedGuesses = {};
  const previous = JSON.stringify(prefs.cast);
  castDefaults();
  if (previous !== JSON.stringify(prefs.cast)) invalidate();
  persist(); render();
}
async function guessNames() {
  if (aiLoading || importing || libraryBusy || !libraryReady) return;
  const names = missingGuesses().slice(0, 40);
  if (!names.length) return;
  if (busy()) { aiMessage = 'Wait for the audio to finish, then try the name guesses again.'; render(); return; }
  const source = prefs.source, epoch = aiEpoch;
  aiLoading = true; aiMessage = 'The AI is guessing voice types from names… You can keep reading and choosing voices.'; render();
  let succeeded = false;
  try {
    const response = await api<{ guesses: { name: string; gender: string }[] }>('/api/casting/guess-genders', { method: 'POST', body: JSON.stringify({ names }), signal: AbortSignal.timeout(130000) });
    if (source !== prefs.source || epoch !== aiEpoch) return;
    if (!Array.isArray(response.guesses) || response.guesses.length !== names.length || new Set(response.guesses.map(item => item?.name)).size !== names.length || response.guesses.some(item => !item || !names.includes(item.name) || !['female', 'male', 'unknown'].includes(item.gender))) throw new Error('The AI returned invalid guesses. Retry or choose voice types manually.');
    stagedGuesses = { ...stagedGuesses, ...validGuesses(Object.fromEntries(response.guesses.map(item => [item.name, item.gender]))) };
    aiMessage = 'AI name guesses are suggestions, not facts. Script cues and your choices take priority.';
    if (!result && !busy()) applyGuesses();
    else aiMessage += ' Apply suggestions to update automatic casting; changed voices need the audio made again.';
    succeeded = true;
  } catch (error) {
    if (source === prefs.source && epoch === aiEpoch) aiMessage = error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'The AI timed out. Retry or choose voice types manually.';
  } finally {
    aiLoading = false; render();
    if (source !== prefs.source || epoch !== aiEpoch || succeeded && missingGuesses().length) void guessNames();
  }
}
// This launch's secret. A page on another local port cannot read it, so it cannot write here.
let sessionKey = '';
async function openSession() {
  try { sessionKey = (await (await fetch('/api/session')).json()).session ?? ''; } catch { sessionKey = ''; }
}
const sessionHeader = (): Record<string, string> => sessionKey ? { 'x-script-glow-session': sessionKey } : {};
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), ...options, headers: { 'Content-Type': 'application/json', ...sessionHeader(), ...options?.headers } });
  // A proxy or a crash can answer with a page instead of JSON; say that plainly.
  const body: unknown = await response.json().catch(() => ({ error: `The local server sent an unexpected reply (${response.status}). Check the terminal.` }));
  if (!response.ok) throw Object.assign(new Error(typeof body === 'object' && body && 'error' in body ? String(body.error) : `Request failed (${response.status})`), { status: response.status });
  return body as T;
}
function flash(message: string, error = false) { notice = message; noticeError = error; render(); }
function invalidate(restoreCompleted = false) {
  stopVoicePreview();
  generation++;
  audioLoadVersion++;
  if (busy() && job) void api(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' }).catch(() => {});
  job = null; result = null; loadedMode = null; legacyAudio = false; audio.pause(); audio.removeAttribute('src'); audio.load(); activeLine = ''; revealed.clear(); waitingFor = ''; resumedLine = '';
  if (cacheSource !== prefs.source) { if (!projectId) completedScenes.clear(); cacheSource = prefs.source; persistRenders(); }
  const current = scene();
  if (restoreCompleted && current) {
    const hit = cachedRender(current);
    if (hit) {
      const { result: cached, key } = hit;
      legacyAudio = hit.legacy;
      completedScenes.delete(key); completedScenes.set(key, cached);
      persistRenders();
      result = cached;
      const count = current.lines.filter(line => line.kind === 'dialogue' || prefs.directions).length;
      job = { id: '', status: 'complete', completed: count, total: count, result: cached };
      loadAudio(0, false);
    }
  }
  persist();
}
const voiceLabel = (id: string) => voiceCatalog[id]?.label || liveVoices[id]?.label || (id === castingConfig.preferredActorVoice ? `${id.replace(/[_-]/g, ' ')} · your voice` : id.replace(/[_-]/g, ' '));
const previewUrl = (id: string) => {
  if (id === castingConfig.preferredActorVoice && castingConfig.previewUrl === '/private-voice-preview.wav') return castingConfig.previewUrl;
  // A hosted voice is sampled by its service on first use, then served from the cache.
  if (Object.hasOwn(liveVoices, id)) return `/api/voices/preview?voice=${encodeURIComponent(id)}&session=${encodeURIComponent(sessionKey)}`;
  const url = voiceCatalog[id]?.previewUrl;
  return url && /^\/voice-previews\/[a-zA-Z0-9-]+\.wav$/.test(url) ? url : undefined;
};
function updatePreviewUI() {
  document.querySelectorAll<HTMLButtonElement>('[data-action="voice-preview"]').forEach(button => {
    const active = !!previewVoice && button.dataset.voice === previewVoice;
    button.textContent = active ? previewLoading ? 'Cancel preview' : 'Stop preview' : 'Preview voice';
    button.setAttribute('aria-label', `${active ? 'Stop' : 'Preview'} voice for ${button.dataset.character}`);
    button.setAttribute('aria-pressed', String(active));
  });
  const status = document.querySelector('#voice-preview-status');
  if (status) status.textContent = previewMessage;
}
function stopVoicePreview(message = '') {
  previewVersion++;
  const previous = previewAudio;
  previewAudio = null; previewVoice = ''; previewLoading = false; previewMessage = message;
  if (previous) { previous.pause(); previous.removeAttribute('src'); previous.load(); previous.remove(); }
  updatePreviewUI();
}
async function playVoicePreview(id: string) {
  if (previewVoice === id) { stopVoicePreview(); return; }
  const url = previewUrl(id);
  if (!url || busy()) return;
  stopVoicePreview();
  audio.pause();
  const version = previewVersion;
  const sample = new Audio(); sample.id = 'voice-preview-audio'; sample.hidden = true; sample.preload = 'none';
  previewAudio = sample; previewVoice = id; previewLoading = true;
  previewMessage = `Loading ${voiceLabel(id)} preview…`;
  document.body.append(sample);
  updatePreviewUI();
  const failed = () => { if (version === previewVersion) stopVoicePreview('Preview unavailable. Refresh the app and try again; your scene audio is unchanged.'); };
  sample.addEventListener('error', failed, { once: true });
  sample.addEventListener('ended', () => { if (version === previewVersion) stopVoicePreview('Preview finished. Press Play to resume your rehearsal.'); }, { once: true });
  sample.src = url;
  try {
    await sample.play();
    if (version !== previewVersion) return;
    previewLoading = false;
    previewMessage = `${voiceLabel(id)} preview · rehearsal paused`;
    updatePreviewUI();
  } catch (error) {
    if (version !== previewVersion) return;
    if (error instanceof DOMException && error.name === 'NotAllowedError') stopVoicePreview('Your browser blocked the preview. Tap Preview voice again.');
    else failed();
  }
}
function castMarkup() {
  return castCharacters().map((name, index) => {
    const profile = profiles[name];
    const gender = resolvedGender(profile, prefs.genders[name]);
    const choice = prefs.genders[name] || 'auto';
    const selectedVoice = prefs.cast[name] || '';
    const details = voiceCatalog[selectedVoice];
    const shared = voiceOwners(selectedVoice, name, castCharacters(), prefs.cast, castingConfig.aliases);
    const description = name === prefs.role ? 'Your selected role is silent in practice mode. Choose any available voice for full-cast playback.' : choice === 'auto' ? profile?.evidence || 'Choose a narrator voice.' : 'Voice type selected by you.';
    const sorted = [...voices].sort((a, b) => Number(voiceGenders[b] === gender) - Number(voiceGenders[a] === gender));
    return `<article class="cast-row" aria-label="${esc(pretty(name))} character card"><span class="cast-avatar color-${index % 4}">${esc(name.slice(0, 1))}</span><div><label for="cast-${index}">${esc(pretty(name))}${name === prefs.role ? ' <small>YOU</small>' : ''}</label>
      ${name === 'Narrator' ? '' : `<select data-gender="${esc(name)}" aria-label="Voice type for ${esc(name)}" ${busy() ? 'disabled' : ''}><option value="auto" ${choice === 'auto' ? 'selected' : ''}>${profile?.source === 'ai' ? 'AI name guess' : 'From script'}: ${profile?.gender === 'unknown' ? 'unspecified' : profile?.gender || 'unspecified'}</option>${(['female', 'male', 'unknown'] as const).map(value => `<option value="${value}" ${choice === value ? 'selected' : ''}>${value === 'unknown' ? 'Unspecified' : pretty(value)}</option>`).join('')}</select>`}
      <select id="cast-${index}" data-cast="${esc(name)}" aria-label="Voice for ${esc(name)}" ${busy() || !voices.length ? 'disabled' : ''}>${voices.length ? sorted.map(voice => { const owners = voiceOwners(voice, name, castCharacters(), prefs.cast, castingConfig.aliases); return `<option value="${esc(voice)}" ${voice === selectedVoice ? 'selected' : owners.length ? 'disabled' : ''}>${esc(voiceLabel(voice))}${voiceGenders[voice] ? ` · ${voiceGenders[voice]}` : ''}${voiceCatalog[voice]?.accent || liveVoices[voice]?.accent ? ` · ${esc(voiceCatalog[voice]?.accent || liveVoices[voice]?.accent || '')}` : ''}${owners.length ? ` — Assigned to ${esc(owners.map(pretty).join(', '))}` : ''}</option>`; }).join('') : '<option>Engine unavailable</option>'}</select>
      <small class="casting-evidence" title="${esc(description)}">${esc(name === prefs.role ? 'Your chosen role' : choice === 'auto' && profile?.source === 'ai' ? gender === 'unknown' ? 'AI name guess inconclusive — choose above' : `AI name guess: ${gender} · override if needed` : choice === 'auto' && gender === 'unknown' ? 'Gender unclear — choose above' : choice === 'auto' ? `Script cue: ${gender}` : `${gender === 'unknown' ? 'Unspecified' : pretty(gender)} voice type override`)}${prefs.manualVoices[name] ? ' · voice picked manually' : ''}</small>
      ${selectedVoice && gender !== 'unknown' && voiceGenders[selectedVoice] !== gender ? `<small class="casting-conflict">This voice is ${esc(voiceGenders[selectedVoice] || 'not labeled')}, but the script suggests ${esc(gender)}.${!prefs.manualVoices[name] && name !== prefs.role ? ' No unused ' + esc(gender) + ' voice was left, so check this choice.' : ' Your choice is kept.'}</small>` : ''}
      ${shared.length ? `<small class="casting-conflict">Shared with ${esc(shared.map(pretty).join(', '))}. Choose an unused voice to make this character distinct.</small>` : ''}
      ${details ? `<p class="voice-description">${esc(`${details.accent} · ${details.tone}`)}</p>` : ''}
      <div class="voice-actions"><button type="button" data-action="voice-preview" data-voice="${esc(selectedVoice)}" data-character="${esc(name)}" ${busy() || !previewUrl(selectedVoice) ? 'disabled' : ''} aria-label="Preview voice for ${esc(name)}" aria-pressed="false">Preview voice</button>${details?.sourceUrl ? `<a href="${esc(details.sourceUrl)}" target="_blank" rel="noopener noreferrer" title="Where this voice comes from and its license">Voice credits</a>` : ''}</div>${!previewUrl(selectedVoice) ? '<small class="preview-unavailable">No sample available for this voice.</small>' : ''}<div class="character-actions">${name === 'Narrator' ? '' : `<button type="button" data-action="choose-role" data-character="${esc(name)}" ${busy() ? 'disabled' : ''} aria-pressed="${name === prefs.role}">${name === prefs.role ? '✓ I’m playing' : 'I’m playing this role'}</button><button type="button" data-action="highlight-character" data-character="${esc(name)}" aria-pressed="${name === highlightedCharacter(prefs, prefs.role)}">Highlight lines</button>`}</div></div></article>`;
  }).join('');
}
function finishRenderUI() {
  const settings = document.querySelector('.settings-panel')!;
  const castScreen = document.createElement('section');
  castScreen.className = 'cast-screen'; castScreen.setAttribute('aria-label', 'Cast setup');
  castScreen.append(document.querySelector('.cast-card')!);
  document.querySelector('.workspace-grid')!.after(castScreen);
  const servicesScreen = document.createElement('section');
  servicesScreen.className = 'settings-screen'; servicesScreen.setAttribute('aria-label', 'Services');
  servicesScreen.innerHTML = settingsMarkup();
  castScreen.after(servicesScreen);
  const libraryScreen = document.createElement('section');
  libraryScreen.className = 'projects-screen'; libraryScreen.setAttribute('aria-label', 'Projects');
  castScreen.after(libraryScreen);
  const tapeScreen = document.createElement('section');
  tapeScreen.className = 'selftape-screen'; tapeScreen.setAttribute('aria-label', 'Self-tape');
  // A size set a moment ago may not be reported yet; keep it before the overlay is redrawn.
  if (keepOverlaySize()) { clearTimeout(sizeTimer); persist(); }
  tapeScreen.innerHTML = takeMarkup();
  tapeScreen.querySelectorAll('.tape-lines').forEach(box => placeParentheticals(box, scene()?.lines ?? []));
  libraryScreen.after(tapeScreen);
  settings.insertAdjacentHTML('beforeend', `<section class="settings-card highlight-card" aria-label="Script highlighter"><div class="card-heading"><h2>Mark your script</h2></div><label class="field-label" for="highlight-character">HIGHLIGHT CHARACTER</label><select id="highlight-character"><option value="@role" ${prefs.highlightCharacter === '@role' ? 'selected' : ''}>My role · ${esc(pretty(prefs.role))}</option><option value="" ${prefs.highlightCharacter === '' ? 'selected' : ''}>Off</option>${parsed.characters.map(name => `<option value="${esc(name)}" ${prefs.highlightCharacter === name ? 'selected' : ''}>${esc(pretty(name))}</option>`).join('')}</select><div class="highlight-colors"><label for="character-color"><input id="character-color" type="color" value="${safeColor(prefs.characterColor, highlightDefaults.characterColor)}"> Character lines</label><label for="spoken-color"><input id="spoken-color" type="color" value="${safeColor(prefs.spokenColor, highlightDefaults.spokenColor)}"> Playback line</label></div><p>Character marks stay visible. Playback uses its own color and marker. Colors save with this project.</p>${prefs.characterColor === prefs.spokenColor ? '<p class="highlight-warning">Same colors selected; the playback marker still identifies the current line.</p>' : ''}</section>`);
  document.querySelector('#my-role')!.parentElement!.insertAdjacentHTML('beforeend', '<a class="cast-shortcut" href="#cast">Configure cast & voices →</a>');
  const current = scene();
  const whole = current?.id === 'full-script';
  const selection = whole ? 'full script' : 'scene';
  document.querySelector('.section-label')!.insertAdjacentHTML('afterend', `<div class="scene-picker"><label for="scene-select">Choose what to play</label><select id="scene-select" ${!parsed.scenes.length ? 'disabled' : ''}><option value="full-script" ${whole ? 'selected' : ''}>Full script · ${parsed.scenes.length} scenes</option>${parsed.scenes.map((item, index) => `<option value="${esc(item.id)}" ${current?.id === item.id ? 'selected' : ''}>${index + 1}. ${esc(item.title)}</option>`).join('')}</select><small>${parsed.scenes.length} scenes available · choose any scene or all</small></div>`);
  document.querySelector('.cast-list')!.innerHTML = castMarkup();
  document.querySelector('.cast-list')!.insertAdjacentHTML('beforebegin', `<div class="ai-casting"><p id="ai-casting-status" role="status">${esc(aiMessage || 'Used voices are greyed out. The AI suggests voice types when script cues are missing.')}</p>${Object.keys(stagedGuesses).length ? `<button type="button" data-action="apply-guesses" ${busy() || aiLoading ? 'disabled' : ''}>Apply AI voice suggestions</button>` : ''}${missingGuesses().length ? /Name guessing is off/.test(aiMessage) ? '<a class="button secondary small" href="#settings">Turn on name guessing in Settings</a>' : `<button type="button" data-action="guess-names" ${busy() || aiLoading ? 'disabled' : ''}>${aiLoading ? 'Guessing names…' : 'Retry AI name guesses'}</button>` : ''}</div>`);
  document.querySelector('.cast-card > p')!.textContent = `${voices.length} voices available · press Preview voice to hear one`;
  document.querySelector('.cast-list')!.insertAdjacentHTML('afterend', '<p class="voice-catalog-note">Accent labels describe references; delivery can vary.</p><p id="voice-preview-status" role="status" aria-live="polite"></p>');
  updatePreviewUI();
  if (parsed.scenes.length) document.querySelector('.scenes')!.insertAdjacentHTML('afterbegin', `<button class="scene-tab ${whole ? 'selected' : ''}" data-action="scope-script"><span class="scene-number">ALL</span><span><strong>Full script</strong><small>${parsed.scenes.length} scenes · ${parsed.scenes.reduce((n, item) => n + item.lines.filter(line => line.kind === 'dialogue').length, 0)} lines</small></span></button>`);
  document.querySelector('.projects-screen')!.innerHTML = `<section class="project-library" aria-label="Saved projects"><div class="library-main"><h2>Your projects</h2><button class="button primary new-project-button" type="button" data-action="import" title="Import a script as a separate project" ${importing || busy() || libraryBusy || !libraryReady ? 'disabled' : ''}>${icon('upload', 16)} ${importing ? 'Importing…' : 'New project from a script'}</button>${libraryReady ? `<ul class="project-list">${projectList.map(item => {
      const current = item.id === projectId;
      const edited = new Date(item.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      return `<li class="project-row ${current ? 'is-current' : ''}"><div class="project-row-text">${current ? `<label class="field-label" for="project-name">OPEN NOW · NAME</label><input id="project-name" value="${esc(prefs.name)}" maxlength="100" autocomplete="off">` : `<span class="project-row-name">${esc(item.name)}</span>`}<small>Edited ${esc(edited)}${item.renderCount ? ` · audio for ${item.renderCount} scene${item.renderCount === 1 ? '' : 's'}` : ''}</small></div><div class="project-row-actions">${current ? '' : `<button type="button" class="button secondary small" data-action="open-project" data-id="${esc(item.id)}" ${libraryBusy || busy() ? 'disabled' : ''}>Open</button><button type="button" class="text-link is-danger" data-action="delete-project" data-id="${esc(item.id)}" data-name="${esc(item.name)}" ${libraryBusy || busy() ? 'disabled' : ''}>Delete</button>`}</div></li>`;
    }).join('')}</ul>` : '<p class="library-note">Opening your projects…</p>'}<p class="library-note">A project keeps its script, cast, settings, audio and takes together. New project imports a PDF, Fountain or text file.</p></div>
    <div class="library-side"><h2>Backups</h2><div class="project-actions"><button type="button" class="button secondary" data-action="backup-project" ${!libraryReady || libraryBusy || busy() ? 'disabled' : ''}>Export backup</button><button type="button" class="button secondary" data-action="restore-project" ${!libraryReady || libraryBusy || busy() ? 'disabled' : ''}>Restore backup</button></div><p class="library-note">An export holds this project and its scene audio, not your self-tapes. Restore opens a .sgbackup file as a separate project.</p><div class="project-actions"><button type="button" class="button secondary" data-action="retry-save" hidden>Retry save / connection</button><button type="button" class="button secondary" data-action="recover-project" hidden>Save draft as new project</button></div></div></section>`;
  for (const item of parsed.scenes) {
    const saved = cachedRender(item)?.result;
    const label = saved?.fullUrl.startsWith(`/api/projects/${projectId}/audio/`) ? 'Audio ready' : saved ? 'Audio ready (not saved)' : 'Audio not made yet';
    document.querySelector<HTMLElement>(`[data-action="scene"][data-id="${CSS.escape(item.id)}"] small`)?.insertAdjacentHTML('beforeend', `<span class="scene-save-badge ${saved ? 'is-rendered' : ''}">${label}</span>`);
    const option = document.querySelector<HTMLOptionElement>(`#scene-select option[value="${CSS.escape(item.id)}"]`);
    if (option) option.textContent += ` · ${label}`;
  }
  const allScene = { id: 'full-script', title: prefs.name, lines: parsed.scenes.flatMap(item => [{ id: `heading-${item.id}`, character: 'Narrator', text: item.title, kind: 'direction' as const, format: 'heading' as const }, ...item.lines]) };
  const allSaved = cachedRender(allScene)?.result;
  document.querySelector('[data-action="scope-script"] small')?.insertAdjacentHTML('beforeend', `<span class="scene-save-badge ${allSaved ? 'is-rendered' : ''}">${allSaved?.fullUrl.startsWith(`/api/projects/${projectId}/audio/`) ? 'Audio ready' : allSaved ? 'Audio ready (not saved)' : 'Audio not made yet'}</span>`);
  updateSaveUI();
  const canGenerate = ttsOnline && voices.length > 0 && !!current?.lines.some(line => line.kind === 'dialogue');
  const button = document.querySelector<HTMLButtonElement>('[data-action="play"]')!;
  button.disabled = busy() || (!result && (!canGenerate || aiLoading));
  button.setAttribute('aria-label', result ? `${audio.paused ? 'Play' : 'Pause'} ${selection}` : busy() ? `Making audio for ${selection}` : `Make audio and play ${selection}`);
  button.title = result ? `${audio.paused ? 'Play' : 'Pause'} ${selection}` : `Make the audio for this ${selection}, then play`;
  const status = document.querySelector('#player-status')!;
  if (result && legacyAudio) status.textContent = 'This audio was made before parentheticals were silenced. Make the audio again to leave them out.';
  else if (!result) status.textContent = busy() ? `Making audio: ${job?.completed || 0} of ${job?.total || 0} lines` : canGenerate ? 'Press Play to make the audio and listen' : 'Voices are not connected yet';
  // A hosted engine is paid per character, so the most this press can send is shown before it.
  const paid = hostedEngine() && current ? renderInputs(current).scene.lines.filter(line => line.kind === 'dialogue' || prefs.directions).reduce((sum, line) => sum + line.text.length, 0) : 0;
  document.querySelector('.render-hint')!.textContent = paid ? `Sends up to ${paid.toLocaleString()} characters to ${engineName()}, which charges for them. Lines already voiced are reused free.` : 'Makes two tracks: the whole cast, and one with silence for your lines.';
  document.querySelector('[data-action="render"]')!.innerHTML = `${icon('wave', 17)} ${busy() ? 'Making audio…' : result ? 'Make audio again' : 'Make audio'}`;
  if (aiLoading) {
    document.querySelector<HTMLButtonElement>('[data-action="render"]')!.disabled = true;
    document.querySelector('.render-hint')!.textContent = 'The AI is checking names. You can make audio when it finishes; existing audio still plays.';
    if (!result) status.textContent = 'Checking character names with local AI…';
  }
  if (libraryBusy || !libraryReady) document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('.settings-panel button, .settings-panel input, .settings-panel select, .cast-screen button, .cast-screen select, [data-action="render"], [data-action="import"], [data-action="edit"], #scene-select').forEach(control => { control.disabled = true; });
  const paper = document.querySelector<HTMLElement>('.script-page')!;
  paper.style.setProperty('--character-color', safeColor(prefs.characterColor, highlightDefaults.characterColor));
  paper.style.setProperty('--spoken-color', safeColor(prefs.spokenColor, highlightDefaults.spokenColor));
  paper.querySelector('.script-meta > span:last-child')?.remove();
  if (whole) document.querySelector('.script-toolbar > div')!.textContent = `FULL SCRIPT · ${parsed.scenes.length} SCENES`;
  const scroll = document.createElement('div'); scroll.className = 'script-paper-scroll'; paper.before(scroll); scroll.append(paper);
  scroll.insertAdjacentHTML('beforebegin', `<div class="reading-controls"><label><input type="checkbox" id="follow-playback" ${prefs.follow ? 'checked' : ''}> Auto-follow spoken line</label><span class="reading-legend"><i style="background:${safeColor(prefs.spokenColor, highlightDefaults.spokenColor)}"></i> Line playing now ${prefs.highlightCharacter ? `<i style="background:${safeColor(prefs.characterColor, highlightDefaults.characterColor)}"></i> ${prefs.highlightCharacter === '@role' ? 'Your lines' : `${esc(pretty(prefs.highlightCharacter))}'s lines`}` : ''}</span></div>`);
  paper.querySelectorAll('.character-label span').forEach(element => element.remove());
  if (whole) paper.querySelector(':scope > h2')?.remove();
  placeParentheticals(paper, current?.lines || []);
  const renderedLines = new Map([...paper.querySelectorAll<HTMLElement>('[data-line]')].map(node => [node.dataset.line, node]));
  for (const line of current?.lines || []) {
    const element = renderedLines.get(line.id);
    if (line.format === 'heading' && element) { const heading = document.createElement('h2'); heading.className = 'script-scene-heading'; heading.textContent = line.text; heading.dataset.line = line.id; element.replaceWith(heading); }
  }
  const footer = document.querySelector('.script-footer > span'); if (footer) footer.textContent = '12 pt Courier · Character marks + separate playback highlight';
  applyScreen();
}
const SCREEN_COPY: Record<Screen, [string, string]> = {
  rehearsal: ['Make the scene yours.', 'Find your rhythm. Learn your lines. Be ready when it counts.'],
  cast: ['Meet your cast.', 'Choose your character. Audition voices. Make every part distinct.'],
  selftape: ['Put it on tape.', 'Record yourself against the cast you already made. The take stays on this machine.'],
  projects: ['Your scripts.', 'Open another project, start a new one, or keep a backup of everything this project holds.'],
  settings: ['Your settings.', 'Choose who reads your scene partners, add your own voice, and connect paid services only if you want them.'],
};
// Settings hold their own copy while they are being edited, so a half-typed address is never
// the one the app is using.
interface ConnectionProfile { name: string; voice: { engine: string; model: string }; names: { engine: string; model: string }; chatterbox: { url: string; cacheNamespace: string; legacyCache: boolean }; whisperx: { url: string }; ollama: { url: string; model: string }; casting: { preferredActorVoice: string; aliases: Record<string, string> } }
let settingsDraft: ConnectionProfile | null = null;
let settingsResults: { service: string; url: string; ok: boolean; detail: string }[] = [];
let settingsBusy = '';
let settingsNotice = '';
let settingsError = false;
// Keys for hosted services. The server only ever says whether one is set, plus a hint. A key being
// typed lives here until it is saved, so a render does not wipe it, and is dropped once saved.
let settingsEngines: Record<string, { label: string; model: string; models: string[] }> = {};
let settingsTextEngines: typeof settingsEngines = {};
let settingsKeys: { provider: string; configured: boolean; hint?: string }[] = [];
const keyDrafts: Record<string, string> = {};
const keyEditing = new Set<string>();
let settingsAdvancedOpen = false, settingsMoreKeysOpen = false;
// What was last read from the server, so the Save bar shows only when something changed.
let settingsSaved = '';
const settingsDirty = () => !!settingsDraft && JSON.stringify(settingsDraft) !== settingsSaved;
let settingsNoticeTimer = 0;
// A success message is shown for a few seconds; an error stays until the next change.
const settingsSaid = (message: string) => {
  settingsNotice = message; settingsError = false;
  window.clearTimeout(settingsNoticeTimer);
  settingsNoticeTimer = window.setTimeout(() => { if (settingsNotice === message) { settingsNotice = ''; syncSaveBar(); } }, 5000);
};
const syncSaveBar = () => {
  document.querySelector('[data-screen="settings"]')?.classList.toggle('has-unsaved', settingsDirty());
  const bar = document.querySelector<HTMLElement>('.settings-savebar');
  if (!bar) return;
  bar.hidden = !settingsDirty() && !settingsNotice;
  bar.querySelectorAll<HTMLElement>('[data-action="save-services"], [data-action="reset-services"]').forEach(button => { button.hidden = !settingsDirty(); });
  const message = bar.querySelector('.savebar-message');
  if (message) { message.textContent = settingsNotice || 'You have unsaved changes.'; message.classList.toggle('is-bad', !!settingsNotice && settingsError); }
};
async function loadSettings(force = false) {
  if (settingsDraft && !force) return;
  try {
    const live = await api<ConnectionProfile & { engines?: typeof settingsEngines; textEngines?: typeof settingsEngines }>('/api/connections');
    settingsEngines = live.engines ?? {}; settingsTextEngines = live.textEngines ?? {};
    // Copy only the fields the profile validator knows. The reply also carries things it does
    // not, such as the preview URL for a registered personal voice, and sending one back is
    // refused as an unknown key.
    settingsDraft = {
      name: live.name,
      voice: { engine: live.voice?.engine ?? 'chatterbox', model: live.voice?.model ?? '' },
      names: { engine: live.names?.engine ?? 'ollama', model: live.names?.model ?? '' },
      chatterbox: { url: live.chatterbox.url, cacheNamespace: live.chatterbox.cacheNamespace, legacyCache: live.chatterbox.legacyCache },
      whisperx: { url: live.whisperx.url },
      ollama: { url: live.ollama.url, model: live.ollama.model },
      casting: { preferredActorVoice: live.casting.preferredActorVoice, aliases: { ...live.casting.aliases } },
    };
    settingsSaved = JSON.stringify(settingsDraft);
    settingsKeys = (await api<{ secrets: typeof settingsKeys }>('/api/secrets')).secrets;
  } catch (error) { settingsNotice = error instanceof Error ? error.message : 'Service settings could not be read.'; settingsError = true; }
}
async function testService(only: string) {
  if (!settingsDraft) return;
  settingsBusy = only; settingsNotice = ''; settingsError = false; render();
  try {
    const answer = await api<{ results: typeof settingsResults }>('/api/connections/test', { method: 'POST', body: JSON.stringify({ ...settingsDraft, only }) });
    // Keep what the other cards found: one check should not wipe the card next to it.
    settingsResults = [...settingsResults.filter(item => !answer.results.some(fresh => fresh.service === item.service)), ...answer.results];
  } catch (error) { settingsNotice = error instanceof Error ? error.message : 'The check could not run.'; settingsError = true; }
  finally { settingsBusy = ''; render(); }
}
async function saveServices() {
  if (!settingsDraft) return;
  settingsBusy = 'save'; settingsNotice = ''; settingsError = false; render();
  try {
    await api<ConnectionProfile>('/api/connections', { method: 'PUT', body: JSON.stringify(settingsDraft) });
    await loadSettings(true);
    // Voices and casting follow the new server; a part already cast by hand is left alone.
    await connect();
    settingsSaid('Saved. Voices have been read again from the server you chose.');
  } catch (error) { settingsNotice = error instanceof Error ? error.message : 'Settings could not be saved.'; settingsError = true; }
  finally { settingsBusy = ''; render(); }
}
async function changeKey(provider: string, remove: boolean) {
  const key = (keyDrafts[provider] ?? '').trim();
  if (!remove && !key) { settingsNotice = 'Paste a key first.'; settingsError = true; render(); return; }
  settingsBusy = `key-${provider}`; settingsNotice = ''; settingsError = false; render();
  try {
    const saved = await api<(typeof settingsKeys)[number]>(`/api/secrets/${provider}`, remove ? { method: 'DELETE' } : { method: 'PUT', body: JSON.stringify({ key }) });
    settingsKeys = settingsKeys.map(item => item.provider === provider ? saved : item);
    delete keyDrafts[provider]; keyEditing.delete(provider);
    settingsSaid(remove ? `${PROVIDERS[provider]?.label} key removed.` : `${PROVIDERS[provider]?.label} key saved. It will not be shown again.`);
  } catch (error) { settingsNotice = error instanceof Error ? error.message : 'The key could not be changed.'; settingsError = true; }
  finally { settingsBusy = ''; render(); }
}
// Recording your own voice. The microphone is open only while the Record button is live, and a
// recording stays in this page until you choose to use it.
const VOICE_MIN_S = 5, VOICE_MAX_S = 25;
const VOICE_SCRIPT = 'I am recording this so my scene partner can sound like me. I will speak the way I normally do, clearly and at an easy pace. Some lines are quiet, some are loud, and some are somewhere in between. When I am ready, I take a breath and begin the scene.';
let voiceRec: { stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; started: number; timer: number } | null = null;
let voiceTake: { wav: Blob; url: string; seconds: number } | null = null;
let voiceSaving = false;
let voiceNotice = '', voiceError = false;
async function voiceFromAudio(blob: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    if (voiceTake) URL.revokeObjectURL(voiceTake.url);
    const wav = new Blob([monoWav(channels, decoded.sampleRate)], { type: 'audio/wav' });
    voiceTake = { wav, url: URL.createObjectURL(wav), seconds: decoded.duration };
    voiceNotice = decoded.duration < VOICE_MIN_S || decoded.duration > 30 ? `This recording is ${decoded.duration.toFixed(1)} seconds. Your voice needs 5 to 30 seconds.` : 'Listen back. If it sounds like you, press Use this recording.';
    voiceError = decoded.duration < VOICE_MIN_S || decoded.duration > 30;
  } catch { voiceNotice = 'That audio could not be read. Try a WAV or MP3 file, or record again.'; voiceError = true; }
  finally { void context.close(); }
}
async function startVoiceRecording() {
  stopVoicePreview(); audio.pause();
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
    const started = Date.now();
    const timer = window.setInterval(() => {
      const seconds = (Date.now() - started) / 1000;
      const clock = document.querySelector('#voice-clock');
      if (clock) clock.textContent = `${Math.floor(seconds)}s of ${VOICE_MAX_S}s`;
      const stop = document.querySelector<HTMLButtonElement>('[data-action="voice-stop"]');
      if (stop) stop.disabled = seconds < VOICE_MIN_S;
      if (seconds >= VOICE_MAX_S) void stopVoiceRecording();
    }, 250);
    voiceRec = { stream, recorder, chunks, started, timer };
    recorder.start();
    voiceNotice = ''; voiceError = false;
  } catch {
    stream?.getTracks().forEach(track => track.stop());
    voiceNotice = 'The microphone could not be opened. Allow it for this page in the browser, then try again.'; voiceError = true;
  }
  render();
}
async function stopVoiceRecording(discard = false) {
  const live = voiceRec;
  if (!live) return;
  voiceRec = null;
  window.clearInterval(live.timer);
  const done = new Promise(resolve => live.recorder.addEventListener('stop', resolve, { once: true }));
  if (live.recorder.state !== 'inactive') live.recorder.stop();
  live.stream.getTracks().forEach(track => track.stop());
  if (!discard) { await done; await voiceFromAudio(new Blob(live.chunks, { type: live.recorder.mimeType })); }
  render();
}
function discardVoice() { if (voiceTake) URL.revokeObjectURL(voiceTake.url); voiceTake = null; voiceNotice = ''; voiceError = false; render(); }
async function saveVoice() {
  if (!voiceTake || !settingsDraft) return;
  const name = settingsDraft.casting.preferredActorVoice || 'MyVoice';
  voiceSaving = true; voiceNotice = ''; voiceError = false; render();
  try {
    const response = await fetch(`/api/voices/mine?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', ...sessionHeader() }, body: voiceTake.wav, signal: AbortSignal.timeout(60000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Your voice could not be saved.');
    URL.revokeObjectURL(voiceTake.url); voiceTake = null;
    await loadSettings(true);
    await connect();
    voiceNotice = `Saved as ${name}. Your role now uses your voice. Make a scene's audio again to hear it.`; voiceError = false;
  } catch (error) { voiceNotice = error instanceof Error ? error.message : 'Your voice could not be saved.'; voiceError = true; }
  finally { voiceSaving = false; render(); }
}
async function loadTakes() {
  if (!projectId) { takes = []; return; }
  try {
    const response = await fetch(`/api/projects/${projectId}/takes`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Takes could not be listed.');
    takes = (await response.json()).takes ?? [];
  } catch (error) { takes = []; takeNotice = error instanceof Error ? error.message : 'Takes could not be listed.'; takeError = true; }
}
function tickClock() {
  clearInterval(clockTimer);
  if (!recorder?.recording) return;
  // Update the clock in place: a full render would tear down the live preview element.
  clockTimer = setInterval(() => {
    const clock = document.querySelector('#tape-clock');
    if (!clock || !recorder?.recording) { clearInterval(clockTimer); return; }
    clock.textContent = takeClock(recorder.elapsed);
  }, 500);
}
async function openCamera() {
  if (recorder || takeBusy) return;
  takeBusy = true; takeNotice = ''; takeError = false; render();
  setReaderLevel(prefs.readerLevel);
  try { recorder = await openRecorder(audio); takeNotice = `Camera ready. Nothing is recorded until you press Record.${mixerState() === 'running' ? '' : ' Scene audio is not running yet.'}`; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof Error ? error.name : '';
    takeNotice = kind === 'NotAllowedError' || kind === 'SecurityError' || /denied|NotAllowed/i.test(message) ? 'Camera and microphone permission was refused. Nothing was recorded.'
      : ['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError'].includes(kind) || /NotFound|NotReadable/i.test(message) ? 'No camera or microphone was available. Check that nothing else is using it.'
      : message;
    takeError = true;
  } finally { takeBusy = false; render(); }
}
async function closeCamera() {
  clearInterval(clockTimer);
  clearTimeout(countdownTimer);
  countdown = 0;
  if (takeFocus) setTakeFocus(false);
  if (!recorder) return;
  const active = recorder;
  recorder = null;
  // A take stopped this way is abandoned on purpose, so nothing partial is ever listed.
  active.release();
  render();
}
function startTake(kind: 'scene' | 'slate' = 'scene') {
  if (!recorder || recorder.recording || countdown) return;
  takeKind = kind;
  setReaderLevel(prefs.readerLevel);
  countdown = 3;
  render();
  countBeep();
  const step = () => { countdownTimer = setTimeout(() => {
    if (!recorder || !countdown) { countdown = 0; render(); return; }
    countdown -= 1;
    if (countdown > 0) { render(); countBeep(); step(); return; }
    const slate = takeKind === 'slate';
    takeNotice = slate ? 'Recording your slate. Press Stop when you are done.' : 'Recording. Press Stop when the scene is done.'; takeError = false;
    render();
    // A slate is you alone: the cast stays silent.
    if (!slate) void startScenePartner();
    const limit = slate ? SLATE_LIMIT_MS : TAKE_LIMIT_MS;
    recorder.start(limit, () => { takeNotice = slate ? 'The slate reached one minute and was kept.' : `Recording reached the ${TAKE_LIMIT_MS / 60000} minute limit and was kept.`; takeError = false; void stopTake(); });
    render(); tickClock();
  }, 1000); };
  step();
}
// The cast reads every other part and leaves silence for the actor's own lines, which is
// practice mode. A failure here is said out loud: a take with no scene partner is a wasted take.
async function startScenePartner() {
  if (!result) { takeNotice = `${sceneTitle()} has no audio yet, so this take has no scene partner.`; takeError = true; render(); return; }
  if (!await resumeMixer()) { takeNotice = 'The browser is holding audio back. Press play on the scene once, then record again.'; takeError = true; render(); return; }
  // A change of mode swaps the file, so let that load and start itself rather than racing it.
  if (prefs.mode !== 'practice') { modeBeforeTake = prefs.mode; prefs.mode = 'practice'; persist(); loadAudio(0, true); render(); return; }
  if (loadedMode !== prefs.mode || !audio.currentSrc) { loadAudio(0, true); return; }
  audio.currentTime = 0;
  try { await audio.play(); }
  catch (error) { takeNotice = `The scene did not start: ${error instanceof Error ? error.message : String(error)}`; takeError = true; render(); }
}
async function stopTake() {
  if (!recorder?.recording) return;
  clearInterval(clockTimer);
  audio.pause();
  if (modeBeforeTake) { prefs.mode = modeBeforeTake; modeBeforeTake = null; persist(); if (result && loadedMode !== prefs.mode) loadAudio(audio.currentTime, false); }
  const active = recorder;
  takeBusy = true; render();
  try {
    const recording = await active.stop();
    if (!recording.blob.size) throw new Error('The take was empty, so nothing was saved.');
    const slate = takeKind === 'slate';
    const label = slate ? `Slate ${takes.filter(take => take.kind === 'slate').length + 1}` : takeLabel(sceneTitle(), takes.filter(take => take.sceneId === prefs.sceneId && take.kind !== 'slate').length);
    const query = new URLSearchParams({ scene: slate ? '' : prefs.sceneId, ms: String(recording.ms), label, kind: takeKind });
    const response = await fetch(`/api/projects/${projectId}/takes?${query}`, { method: 'POST', headers: { 'Content-Type': takeContainer(recording.type), ...sessionHeader() }, body: recording.blob });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'The take could not be saved.');
    const saved = await response.json();
    takeNotice = `Kept as ${saved.label}.`; takeError = false;
    await loadTakes();
  } catch (error) { takeNotice = error instanceof Error ? error.message : 'The take could not be saved.'; takeError = true; }
  finally { takeBusy = false; render(); }
}
// Makes the finished MP4: FFmpeg on this machine when it is there, the browser otherwise.
async function makeMp4() {
  if (!trimming || !projectId) return;
  const job = trimming;
  const source = takes.find(take => take.file === job.file);
  if (!source) return;
  const whole = source.ms / 1000;
  const end = job.end && job.end < whole - 0.05 ? job.end : 0;
  takeBusy = true; takeNotice = tools.ffmpeg ? 'Making the MP4…' : 'Making the MP4 in the browser. The take plays through once; keep this tab open.'; takeError = false; render();
  try {
    if (tools.ffmpeg) {
      const response = await fetch(`/api/projects/${projectId}/takes/${job.file}/mp4`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...sessionHeader() }, body: JSON.stringify({ start: job.start, end }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The MP4 could not be made.');
      takeNotice = `Saved as ${body.label}. It is ready to send.`;
    } else {
      const blob = await browserMp4(`/api/projects/${projectId}/takes/${job.file}`, job.start, end, fraction => { if (trimming) { trimming.progress = fraction; const bar = document.querySelector<HTMLProgressElement>('#trim-progress'); if (bar) bar.value = fraction; } });
      const trimmed = job.start > 0 || !!end;
      const query = new URLSearchParams({ scene: source.sceneId, ms: String(Math.round(((end || whole) - job.start) * 1000)), label: `${source.label}${trimmed ? ' (trimmed)' : ''} MP4`.slice(0, 100), kind: source.kind ?? 'scene' });
      const response = await fetch(`/api/projects/${projectId}/takes?${query}`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', ...sessionHeader() }, body: blob });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The MP4 could not be saved.');
      takeNotice = `Saved as ${body.label}. It is ready to send.`;
    }
    takeError = false; trimming = null;
    await loadTakes();
  } catch (error) { takeNotice = error instanceof Error ? error.message : 'The MP4 could not be made.'; takeError = true; }
  finally { takeBusy = false; render(); }
}
async function takeRequest(file: string, init: RequestInit, failure: string) {
  takeBusy = true; render();
  try {
    const response = await fetch(`/api/projects/${projectId}/takes/${file}`, { ...init, headers: { ...init.headers, ...sessionHeader() } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || failure);
    await loadTakes(); takeNotice = ''; takeError = false;
  } catch (error) { takeNotice = error instanceof Error ? error.message : failure; takeError = true; }
  finally { takeBusy = false; render(); }
}
// An acting note such as (softly) belongs inside the next speech, above its words, whether the
// words are shown or hidden behind the reveal button.
function placeParentheticals(root: ParentNode, lines: ScriptLine[]) {
  const rendered = new Map([...root.querySelectorAll<HTMLElement>('[data-line]')].map(node => [node.dataset.line, node]));
  lines.forEach((line, index) => {
    const element = rendered.get(line.id);
    if (line.format !== 'parenthetical' || !element) return;
    element.classList.add('parenthetical'); element.textContent = `(${line.text})`;
    const next = lines[index + 1];
    const dialogue = next?.kind === 'dialogue' ? rendered.get(next.id) : undefined;
    if (dialogue) dialogue.insertBefore(element, dialogue.querySelector(':scope > p, :scope > .hidden-line'));
  });
}
function sceneLinesMarkup(): string {
  const current = scene();
  return current?.lines.map(line => line.kind === 'direction' ? `<p class="direction ${line.id === activeLine ? 'active' : ''} ${prefs.listen ? 'listening' : ''}" data-line="${esc(line.id)}">${esc(line.text)}</p>` : `<article class="dialogue ${prefs.listen && !revealed.has(line.id) ? 'listening' : ''} ${line.character === prefs.role ? 'my-line' : ''} ${line.character === highlightedCharacter(prefs, prefs.role) ? 'character-highlight' : ''} ${line.id === activeLine ? 'active' : ''}" data-line="${esc(line.id)}"><div class="character-label">${esc(line.character)} ${line.character === prefs.role ? '<span>YOU</span>' : ''}</div>${lineHidden(prefs, line.character === prefs.role, revealed.has(line.id)) ? `<button class="hidden-line" data-action="reveal" data-id="${esc(line.id)}" aria-label="Reveal ${line.character === prefs.role ? 'your line' : 'this line'}">${prefs.hint ? `<span class="hint-text">${esc(firstLetters(line.text))}</span>` : '<span class="hidden-stroke"></span><span class="hidden-stroke short"></span>'}<small>Click to reveal ${line.character === prefs.role ? 'your line' : 'this line'}</small></button>` : `<p>${esc(line.text)}</p>`}</article>`).join('') || `<div class="empty-state"><p class="empty-copy">This project has no scenes yet.</p><p>Bring in a screenplay, or type or paste one.</p><div class="empty-actions"><button type="button" class="button primary" data-action="import">${icon('upload', 16)} Import a script</button><button type="button" class="button secondary" data-action="edit">Write or paste a script</button></div></div>`;
}
// Where each key comes from and what it is used for.
const PROVIDERS: Record<string, { label: string; site: string; use: string }> = {
  openai: { label: 'OpenAI', site: 'https://platform.openai.com/api-keys', use: 'Voices, name guesses' },
  gemini: { label: 'Google Gemini', site: 'https://aistudio.google.com/apikey', use: 'Voices, name guesses' },
  elevenlabs: { label: 'ElevenLabs', site: 'https://elevenlabs.io/app/settings/api-keys', use: 'Voices' },
  anthropic: { label: 'Anthropic (Claude)', site: 'https://console.anthropic.com/settings/keys', use: 'Name guesses' },
  xai: { label: 'xAI (Grok)', site: 'https://console.x.ai', use: 'Name guesses' },
  openrouter: { label: 'OpenRouter', site: 'https://openrouter.ai/keys', use: 'Name guesses' },
  // Stored now for video work later. Nothing sends it anywhere yet.
  fal: { label: 'FAL', site: 'https://fal.ai/dashboard/keys', use: 'Not used yet (video)' },
  // Not a paid service: the shared secret for a Chatterbox server on another computer (VOICE_TOKEN).
  chatterbox: { label: 'Voice server token', site: '', use: 'Only for a Chatterbox server on another computer' },
};
const SERVICE_LABELS: Record<string, string> = { chatterbox: 'Voices (Chatterbox)', ollama: 'Local AI (Ollama)', whisperx: 'Transcription (WhisperX)' };
function settingsMarkup(): string {
  const draft = settingsDraft;
  if (!draft) return '<p class="library-note">Reading your service settings…</p>';
  const off = settingsBusy ? 'disabled' : '';
  const input = (id: string, value: string, type = 'url', extra = '') => `<input id="${id}" type="${type}" value="${esc(value)}" spellcheck="false" autocomplete="off" ${extra} ${off}>`;
  // One setting per row: what it is on the left, the control on the right.
  const row = (id: string, label: string, note: string, control: string) =>
    `<div class="setting-row"><div class="setting-text"><label for="${id}">${label}</label><p>${note}</p></div><div class="setting-control">${control}</div></div>`;
  const result = (service: string, hosted = false) => {
    const found = settingsResults.find(item => item.service === service);
    const state = !found || settingsBusy === service ? '' : found.ok ? 'is-ok' : 'is-bad';
    return `<div class="service-check"><button type="button" class="button secondary ${state}" data-action="test-service" data-service="${service}" ${off}>${settingsBusy === service ? 'Checking…' : found && state === 'is-ok' ? '✓ Answering' : found ? '✕ No answer' : hosted ? 'Test the key' : 'Test this server'}</button>${found ? `<p class="service-result ${found.ok ? 'is-ok' : 'is-bad'}" role="status">${esc(found.detail)}</p>` : ''}</div>`;
  };
  const keyFor = (provider: string) => settingsKeys.find(item => item.provider === provider && item.configured);
  const engine = draft.voice.engine, spec = settingsEngines[engine];
  const engines: [string, string, string, string][] = [
    ['chatterbox', 'Chatterbox', 'Runs on your own computer. Private and free. Fast with an NVIDIA graphics card, slow without one.', 'Free · Private'],
    ['elevenlabs', 'ElevenLabs', 'The most natural voices. Uses the voices in your ElevenLabs account.', 'Paid · Your library'],
    ['openai', 'OpenAI', 'Clear, reliable voices. Any laptop.', 'Paid · 13 voices'],
    ['gemini', 'Google Gemini', 'A wide range of voices. Any laptop.', 'Paid · 30 voices'],
  ];
  const engineCard = ([value, title, text, tag]: [string, string, string, string]) => {
    const needsKey = value !== 'chatterbox';
    const status = needsKey ? keyFor(value) ? '<span class="pill is-ok">✓ Key saved</span>' : '<span class="pill is-warn">Needs a key</span>' : '<span class="pill is-ok">No key needed</span>';
    return `<label class="engine-card ${engine === value ? 'is-selected' : ''}"><input type="radio" name="service-engine" id="service-engine-${value}" value="${value}" ${engine === value ? 'checked' : ''} ${off}><span class="engine-title">${title}<em>${tag}</em></span><span class="engine-text">${text}</span>${status}</label>`;
  };
  const provider = (item: (typeof settingsKeys)[number]) => {
    const about = PROVIDERS[item.provider];
    const editing = keyEditing.has(item.provider) || !!keyDrafts[item.provider];
    const busy = settingsBusy === `key-${item.provider}`;
    return `<li class="key-item">
      <div class="key-line"><span class="key-name">${esc(about?.label ?? item.provider)}<small>${esc(about?.use ?? '')}</small></span>
        ${item.configured ? `<span class="pill is-ok" title="The start and end of the saved key">✓ ${esc(item.hint ?? 'Saved')}</span>` : '<span class="pill">No key</span>'}
        <span class="key-actions">${editing ? '' : item.configured
          ? `<button type="button" class="text-link" data-action="edit-key" data-provider="${item.provider}" ${off}>Replace</button><button type="button" class="text-link is-danger" data-action="remove-key" data-provider="${item.provider}" ${off}>Remove</button>`
          : `<button type="button" class="button secondary small" data-action="edit-key" data-provider="${item.provider}" ${off}>Add key</button>${about?.site ? `<a class="text-link" href="${about.site}" target="_blank" rel="noopener noreferrer">Get one ↗</a>` : ''}`}</span></div>
      ${editing ? `<div class="key-edit"><label class="visually-hidden" for="key-${item.provider}">${esc(about?.label ?? item.provider)} API key</label><input id="key-${item.provider}" type="password" value="${esc(keyDrafts[item.provider] ?? '')}" placeholder="Paste your ${esc(about?.label ?? '')} key" spellcheck="false" autocomplete="off" ${off}><button type="button" class="button primary small" data-action="save-key" data-provider="${item.provider}" ${off}>${busy ? 'Saving…' : 'Save key'}</button><button type="button" class="text-link" data-action="cancel-key" data-provider="${item.provider}" ${off}>Cancel</button></div>` : ''}
    </li>`;
  };
  const namesEngine = draft.names.engine, namesSpec = settingsTextEngines[namesEngine];
  const recorder = voiceRec ? `
          <p class="voice-live" role="status"><span class="tape-dot"></span> Recording · <span id="voice-clock">0s of ${VOICE_MAX_S}s</span></p>
          <p class="voice-script">${esc(VOICE_SCRIPT)}</p>
          <div class="voice-buttons"><button type="button" class="button primary" data-action="voice-stop" disabled>Stop</button><button type="button" class="text-link" data-action="voice-cancel">Cancel</button></div>
          <p class="library-note">Read the passage in your normal voice. Stop is available after ${VOICE_MIN_S} seconds; recording ends by itself at ${VOICE_MAX_S}.</p>` : voiceTake ? `
          <p class="field-label">NEW RECORDING · ${voiceTake.seconds.toFixed(1)} SECONDS</p><audio class="personal-sample" controls src="${voiceTake.url}"></audio>
          <div class="voice-buttons"><button type="button" class="button primary" data-action="voice-save" ${voiceSaving || voiceTake.seconds < VOICE_MIN_S || voiceTake.seconds > 30 ? 'disabled' : ''}>${voiceSaving ? 'Saving…' : 'Use this recording'}</button><button type="button" class="button secondary" data-action="voice-record" ${voiceSaving ? 'disabled' : ''}>Record again</button><button type="button" class="text-link" data-action="voice-discard" ${voiceSaving ? 'disabled' : ''}>Discard</button></div>
          <p class="library-note">Using it sends the recording to your Chatterbox server as <strong>${esc(draft.casting.preferredActorVoice || 'MyVoice')}</strong> and keeps a private copy on this computer.</p>` : `
          <div class="voice-buttons"><button type="button" class="button primary" data-action="voice-record" ${off}><span aria-hidden="true">●</span> Record my voice</button><label class="text-link voice-file-label">or choose a file<input id="voice-file" type="file" accept="audio/*" hidden></label></div>
          <p class="library-note">About 20 seconds of you reading a short passage aloud. Record only your own voice.</p>`;
  const sections: [string, string][] = [['set-voices', 'Voices'], ['set-mine', 'Your voice'], ['set-names', 'Name guesses'], ['set-keys', 'Keys'], ['set-advanced', 'Advanced']];
  return `<div class="settings-layout">
    <nav class="settings-nav" aria-label="Settings sections"><p class="settings-nav-title">On this page</p>${sections.map(([id, label], index) => `<button type="button" data-action="settings-jump" data-target="${id}" ${index === 0 ? 'aria-current="true"' : ''}>${label}</button>`).join('')}</nav>
    <form class="settings-form" autocomplete="off">
      <section class="settings-section" id="set-voices" aria-labelledby="set-voices-title">
        <h2 tabindex="-1" id="set-voices-title">Who reads the other parts</h2>
        <p class="section-lead">The engine that speaks your scene partners. Parts you cast by hand are kept when you switch.</p>
        <fieldset class="engine-grid"><legend class="visually-hidden">Voice engine</legend>${engines.map(engineCard).join('')}</fieldset>
        ${engine === 'chatterbox' ? row('service-chatterbox', 'Chatterbox server', 'The address of your voice server. Script Glow only asks it for its voices, and sends it one only when you record your own.', `${input('service-chatterbox', draft.chatterbox.url)}${result('chatterbox')}`)
          : `<p class="callout" role="note"><strong>${esc(spec?.label ?? engine)} is paid.</strong> When you make audio, the lines of that scene are sent to ${esc(spec?.label ?? engine)} to be read aloud. Lines already made are kept and never sent twice. Your script file and your takes stay here.</p>
          ${keyFor(engine) ? '' : `<p class="callout is-warn" role="note">No ${esc(spec?.label ?? engine)} key yet. <button type="button" class="text-link" data-action="settings-jump" data-target="set-keys">Add it under Keys</button>.</p>`}
          ${row('service-voice-model', 'Model', 'The recommended one suits most scenes.', `<select id="service-voice-model" ${off}>${(spec?.models ?? []).map(name => `<option value="${name === spec?.model ? '' : esc(name)}" ${(draft.voice.model || spec?.model) === name ? 'selected' : ''}>${esc(name)}${name === spec?.model ? ' (recommended)' : ''}</option>`).join('')}</select>${result('voice', true)}`)}`}
      </section>
      <section class="settings-section" id="set-mine" aria-labelledby="set-mine-title">
        <h2 tabindex="-1" id="set-mine-title">Your own voice</h2>
        <p class="section-lead">Hear your own lines in your voice when you listen to the full cast.${engine !== 'chatterbox' ? ' <strong>Only used with Chatterbox.</strong>' : ''}</p>
        <div class="voice-recorder">${recorder}${voiceNotice ? `<p class="callout ${voiceError ? 'is-warn' : ''}" role="status">${esc(voiceNotice)}</p>` : ''}</div>
        ${castingConfig.previewUrl ? `<div class="setting-row"><div class="setting-text"><span class="setting-label">Your current sample</span></div><div class="setting-control"><audio class="personal-sample" controls preload="none" src="${esc(castingConfig.previewUrl)}"></audio></div></div>` : ''}
        ${row('service-voice', 'Voice name', 'The name your voice has on the Chatterbox server.', input('service-voice', draft.casting.preferredActorVoice, 'text', 'placeholder="MyVoice"'))}
      </section>
      <section class="settings-section" id="set-names" aria-labelledby="set-names-title">
        <h2 tabindex="-1" id="set-names-title">Guess voice types from names</h2>
        <p class="section-lead">Optional. When the script does not say whether a character is a man or a woman, an AI can guess from the name. Only the names are sent, never the script.</p>
        ${row('service-names-engine', 'Who guesses', namesEngine === 'ollama' ? 'Ollama runs on this computer and is free.' : `${esc(namesSpec?.label ?? namesEngine)} charges a very small amount per guess.`, `<select id="service-names-engine" ${off}>${[['ollama', 'Ollama (this computer, free)'], ['openai', 'OpenAI'], ['anthropic', 'Claude (Anthropic)'], ['gemini', 'Google Gemini'], ['xai', 'Grok (xAI)'], ['openrouter', 'OpenRouter']].map(([value, label]) => `<option value="${value}" ${namesEngine === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}
        ${namesEngine === 'ollama'
          ? `${row('service-ollama', 'Ollama server', 'The address of your Ollama server.', input('service-ollama', draft.ollama.url))}
             ${row('service-model', 'Installed model', 'Leave empty to choose every voice type yourself. Script Glow never downloads a model.', `${input('service-model', draft.ollama.model, 'text', 'placeholder="for example gemma:2b"')}${result('names')}`)}`
          : `${keyFor(namesEngine) ? '' : `<p class="callout is-warn" role="note">No ${esc(namesSpec?.label ?? namesEngine)} key yet. <button type="button" class="text-link" data-action="settings-jump" data-target="set-keys">Add it under Keys</button>.</p>`}
             ${row('service-names-model', 'Model', 'Leave empty for the recommended model, or type any model this service offers.', `${input('service-names-model', draft.names.model, 'text', `list="names-models" placeholder="${esc(namesSpec?.model ?? '')} (recommended)"`)}<datalist id="names-models">${(namesSpec?.models ?? []).map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>${result('names', true)}`)}`}
      </section>
      <section class="settings-section" id="set-keys" aria-labelledby="set-keys-title">
        <h2 tabindex="-1" id="set-keys-title">Keys for paid services</h2>
        <p class="section-lead">For paid services, and for a voice server on another computer. Each key is saved when you press Save key, kept in your private user folder, and never shown again.</p>
        ${(() => {
          // Keys you have, or need for what you chose, come first; the rest wait behind one line.
          const wanted = (item: (typeof settingsKeys)[number]) => item.configured || keyEditing.has(item.provider) || !!keyDrafts[item.provider] || item.provider === engine || item.provider === namesEngine;
          const first = settingsKeys.filter(wanted), rest = settingsKeys.filter(item => !wanted(item));
          return `${first.length ? `<ul class="key-list">${first.map(provider).join('')}</ul>` : '<p class="library-note">No keys yet. Choose a paid service above, or add one below.</p>'}
          ${rest.length ? `<details class="more-keys"${settingsMoreKeysOpen ? ' open' : ''}><summary>Other services (${rest.length})</summary><ul class="key-list">${rest.map(provider).join('')}</ul></details>` : ''}`;
        })()}
      </section>
      <section class="settings-section" id="set-advanced" aria-labelledby="set-advanced-title">
        <h2 tabindex="-1" id="set-advanced-title">Advanced</h2>
        <details class="advanced"${settingsAdvancedOpen ? ' open' : ''}><summary><span class="when-closed">Show advanced settings</span><span class="when-open">Hide advanced settings</span></summary>
          ${engine === 'chatterbox' ? '' : row('service-chatterbox', 'Chatterbox server', 'Used for your own voice, and when you switch back to Chatterbox.', `${input('service-chatterbox', draft.chatterbox.url)}${result('chatterbox')}`)}
          ${row('service-whisperx', 'WhisperX server', 'Not used yet. Ready for when Script Glow listens for your lines.', `${input('service-whisperx', draft.whisperx.url)}${result('whisperx')}`)}
          ${row('service-name', 'Name of this set-up', 'Shown when Script Glow starts, so you know which computer you are on.', input('service-name', draft.name, 'text'))}
          <label class="checkbox-label"><input type="checkbox" id="service-legacy" ${draft.chatterbox.legacyCache ? 'checked' : ''} ${off}> Reuse audio made by an older Script Glow</label>
          <p class="library-note">Addresses are saved in <code>data/connections.json</code>, which never holds a key, so it is safe to copy to another computer.</p>
        </details>
      </section>
      <div class="settings-savebar" ${settingsDirty() || settingsNotice ? '' : 'hidden'}>
        <p class="savebar-message ${settingsError ? 'is-bad' : ''}" role="status">${esc(settingsNotice || 'You have unsaved changes.')}</p>
        <button type="button" class="text-link" data-action="reset-services" ${off} ${settingsDirty() ? '' : 'hidden'}>Undo</button>
        <button type="button" class="button primary" data-action="save-services" ${off} ${settingsDirty() ? '' : 'hidden'}>${settingsBusy === 'save' ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  </div>`;
}
function takeMarkup(): string {
  const scene = sceneTitle();
  const recording = !!recorder?.recording;
  const rows = takes.map(take => {
    const slate = take.kind === 'slate';
    const sceneName = slate ? 'Slate' : pretty((parsed.scenes.find(item => item.id === take.sceneId)?.title ?? scene).replace(/^(INT\.?|EXT\.?)\s*/i, ''));
    const fileName = castingFileName(actorName(), prefs.name, sceneName);
    const fits = castingFit(take.bytes, take.file);
    const format = (take.file.split('.').pop() ?? '').toUpperCase();
    return `<li class="take-row ${take.file === reviewing ? 'selected' : ''} ${slate ? 'is-slate' : ''}">
      <label class="take-name-wrap" title="Click to rename">${slate ? '<span class="take-tag">SLATE</span>' : ''}<input class="take-name" data-file="${esc(take.file)}" value="${esc(take.label)}" maxlength="100" aria-label="Name of this take (click to rename)" ${takeBusy ? 'disabled' : ''}><span aria-hidden="true">✎</span></label>
      <span class="take-meta">${takeClock(take.ms)} · ${(take.bytes / 1024 / 1024).toFixed(1)} MB · ${esc(format)}</span>
      <span class="take-fit">${fits.map(fit => `<span class="${fit.ok ? 'is-ok' : 'is-bad'}" title="${esc(fit.ok ? `Fits ${fit.site}` : `${fit.site}: ${fit.reason}`)}">${fit.ok ? '✓' : '✕'} ${esc(fit.site)}${fit.ok ? '' : ` · ${esc(fit.reason)}`}</span>`).join('')}</span>
      <span class="take-actions"><button type="button" data-action="take-play" data-file="${esc(take.file)}">${take.file === reviewing ? 'Stop' : 'Play'}</button><a href="/api/projects/${esc(projectId)}/takes/${esc(take.file)}?download&name=${encodeURIComponent(fileName)}" download title="Saves as ${esc(fileName)}.${esc(format.toLowerCase())}">Save</a><button type="button" data-action="take-trim" data-file="${esc(take.file)}" ${takeBusy ? 'disabled' : ''}>${format === 'MP4' ? 'Trim' : 'Trim / MP4'}</button><button type="button" data-action="take-delete" data-file="${esc(take.file)}" ${takeBusy ? 'disabled' : ''}>Delete</button></span>
    </li>`;
  }).join('');
  const canConvert = tools.ffmpeg || !!browserMp4Type(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));
  const trimPanel = trimming ? `<div class="trim-panel" role="group" aria-label="Trim and make an MP4">
      <h3>Trim and make an MP4</h3>
      <p class="library-note">Play the take above. Press the buttons at the moments to keep from and to.</p>
      <div class="trim-points"><button type="button" class="button secondary small" data-action="trim-start" ${takeBusy ? 'disabled' : ''}>Start here</button><span>From <strong>${trimming.start.toFixed(1)} s</strong> to <strong>${trimming.end ? `${trimming.end.toFixed(1)} s` : 'the end'}</strong></span><button type="button" class="button secondary small" data-action="trim-end" ${takeBusy ? 'disabled' : ''}>End here</button></div>
      <div class="trim-actions"><button type="button" class="text-link" data-action="trim-preview" ${takeBusy ? 'disabled' : ''}>Play the kept part</button><button type="button" class="button primary small" data-action="trim-make" ${takeBusy || !canConvert ? 'disabled' : ''}>${takeBusy ? 'Making…' : 'Make MP4'}</button><button type="button" class="text-link" data-action="trim-cancel" ${takeBusy ? 'disabled' : ''}>Cancel</button></div>
      ${!tools.ffmpeg && takeBusy ? `<progress id="trim-progress" max="1" value="${trimming.progress}"></progress>` : ''}
      <p class="library-note">${tools.ffmpeg ? 'Made on this computer with FFmpeg. The original take is kept.' : canConvert ? 'FFmpeg is not installed, so the browser makes the MP4 by playing the take through once. The original take is kept.' : 'This browser cannot make MP4 files. Install FFmpeg (see Help), or use Chrome or Edge.'}</p>
    </div>` : '';
  return `<div class="tape-stage">
      <div class="tape-frame ${recording ? 'is-recording' : ''}">
        <video id="tape-preview" muted playsinline autoplay></video>
        ${recorder ? '' : '<p class="tape-off">Your camera is off. Nothing is recorded until you turn it on.</p>'}
        ${prefs.tapeOverlay && screen === 'selftape' && !(takeKind === 'slate' && (countdown || recording)) ? `<div class="tape-overlay" style="left:${prefs.tapeX}%;top:${prefs.tapeY}%${prefs.tapeW ? `;width:${prefs.tapeW}px` : ''}"><button type="button" class="tape-grip" data-action="tape-drag" aria-label="Move the script. Drag it, or use the arrow keys." title="Drag to set your eyeline. Arrow keys nudge it.">⠿ Drag to your eyeline</button><div class="script-paper-scroll tape-lines ${result ? 'has-audio' : ''}" style="${prefs.tapeH ? `height:${prefs.tapeH}px` : ''}">${sceneLinesMarkup()}</div></div>` : ''}
        ${takeKind === 'slate' && (countdown || recording) ? '<div class="slate-card" role="note"><strong>Slate</strong><span>Say your name, your height, and where you are based. If asked, step back for a full-length shot.</span></div>' : ''}
        ${countdown ? `<span class="tape-countdown" role="status">${countdown}</span>` : ''}
        ${recording ? `<span class="tape-live" role="status"><span class="tape-dot"></span>REC <span id="tape-clock">${takeClock(recorder!.elapsed)}</span></span>` : ''}
      </div>
      <div class="tape-controls">
        ${recorder ? `<button type="button" class="button secondary" data-action="tape-focus">${takeFocus ? 'Show everything again' : 'Fill the screen'}</button>` : ''}
        ${recorder
          ? recording
            ? '<button type="button" class="button primary" data-action="record-stop">Stop and keep this take</button>'
            : `<button type="button" class="button primary" data-action="record-start" ${countdown || takeBusy ? 'disabled' : ''}>${countdown && takeKind === 'scene' ? 'Starting…' : 'Record a take'}</button><button type="button" class="button secondary" data-action="record-slate" ${countdown || takeBusy ? 'disabled' : ''}>${countdown && takeKind === 'slate' ? 'Starting…' : 'Record a slate'}</button><button type="button" class="button secondary" data-action="camera-off" ${countdown || takeBusy ? 'disabled' : ''}>Turn camera off</button>`
          : `<button type="button" class="button primary" data-action="camera-on" ${takeBusy ? 'disabled' : ''}>Turn on camera and microphone</button>`}
      </div>
      <div class="reader-level"><label for="reader-level">Reader volume in the take</label><input type="range" id="reader-level" min="0" max="1.5" step="0.05" value="${prefs.readerLevel}" ${recording ? 'disabled' : ''}><output for="reader-level">${Math.round(prefs.readerLevel * 100)}%</output><small>Keep the reader a little quieter than you. Your headphones are not affected.</small></div>
      ${takeNotice ? `<p class="notice ${takeError ? 'error' : ''}" role="status">${esc(takeNotice)}</p>` : ''}
      <p class="tape-note">${result ? `Recording plays <strong>${esc(scene)}</strong> from the top and captures you against it.` : `<strong>${esc(scene)}</strong> has no audio yet. You can record, but there is no scene partner until you make the audio on the Rehearsal screen.`} Wear headphones, or the cast comes through your microphone twice. Takes stop on their own after ${TAKE_LIMIT_MS / 60000} minutes.${recorder && takeNeedsConverting(recorder.type) ? ' This browser records WebM; some casting sites want MP4, so convert before you send it.' : ''}</p>
    </div>
    <aside class="tape-script" aria-label="Script while recording"><h2>Your lines</h2>
      <div class="tape-script-controls">
        <label class="checkbox-label"><input type="checkbox" id="tape-overlay" ${prefs.tapeOverlay ? 'checked' : ''}> Put the script over the camera</label>
        <label class="checkbox-label"><input type="checkbox" id="tape-follow" ${prefs.follow ? 'checked' : ''}> Scroll with the scene</label>
        ${prefs.tapeOverlay ? '<button type="button" class="text-link" data-action="tape-centre">Put it back under the lens</button>' : ''}
      </div>
      ${prefs.tapeOverlay ? '' : `<div class="script-paper-scroll tape-lines">${screen === 'selftape' ? sceneLinesMarkup() : ''}</div>`}
      <p class="library-note">${prefs.tapeOverlay ? 'Drag the script until your eyes sit close to the lens. Arrow keys nudge it. Its place is kept with this project.' : 'Practice mode is used for a take, so the cast reads and your lines stay silent. Hide my lines, Listen only and First letters all apply here too.'}</p>
    </aside>
    <aside class="tape-takes"><h2>Takes <span>${takes.length}</span></h2>
      <label class="field-label" for="actor-name">YOUR NAME ON SAVED FILES</label><input id="actor-name" type="text" maxlength="60" value="${esc(actorName())}" placeholder="Your name" autocomplete="name">
      <p class="library-note">Saved takes are named ${esc(castingFileName(actorName() || 'Your name', prefs.name, scene))}, as casting instructions usually ask.</p>
      ${rows ? `<ul>${rows}</ul>` : '<p class="tape-empty">No takes yet. They are kept with this project, on this machine only, and are left out of project backups.</p>'}
      <div class="tape-review-slot"></div>
      ${trimPanel}
    </aside>`;
}
const sceneTitle = () => { const current = scene(); return current ? pretty(current.title.replace(/^(INT\.?|EXT\.?)\s*/i, '')) : 'this scene'; };
function startScriptDrag(grip: HTMLElement, event: PointerEvent) {
  const overlay = grip.closest<HTMLElement>('.tape-overlay');
  const frame = grip.closest<HTMLElement>('.tape-frame');
  if (!overlay || !frame) return;
  grip.setPointerCapture(event.pointerId);
  const move = (moved: PointerEvent) => {
    const box = frame.getBoundingClientRect();
    if (!box.width || !box.height) return;
    prefs.tapeX = tapePercent(((moved.clientX - box.left) / box.width) * 100, prefs.tapeX);
    prefs.tapeY = tapePercent(((moved.clientY - box.top) / box.height) * 100, prefs.tapeY);
    // Move the element itself: a re-render in the middle of a drag would replace it.
    overlay.style.left = `${prefs.tapeX}%`;
    overlay.style.top = `${prefs.tapeY}%`;
  };
  const done = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', done);
    grip.removeEventListener('pointercancel', done);
    persist();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', done);
  grip.addEventListener('pointercancel', done);
}
let sizeTimer: ReturnType<typeof setTimeout> | undefined;
let sizeWatcher: ResizeObserver | undefined;
// Keeps the size the actor gave the overlay. Only a size set on the element counts (dragging the
// resize handle sets one); the size it is drawn at by default stays "default", saved as nought.
// A hidden overlay measures nothing, and that is not a choice either.
function keepOverlaySize(): boolean {
  const overlay = document.querySelector<HTMLElement>('.tape-overlay');
  const lines = overlay?.querySelector<HTMLElement>('.tape-lines');
  if (!overlay || !lines || (!overlay.style.width && !lines.style.height)) return false;
  const width = Math.round(overlay.getBoundingClientRect().width);
  const height = Math.round(lines.getBoundingClientRect().height);
  if (!width || !height || (width === prefs.tapeW && height === prefs.tapeH)) return false;
  prefs.tapeW = width; prefs.tapeH = height;
  return true;
}
function watchOverlaySize() {
  const lines = document.querySelector<HTMLElement>('.tape-overlay .tape-lines');
  sizeWatcher?.disconnect();
  if (!lines) { sizeWatcher = undefined; return; }
  sizeWatcher = new ResizeObserver(() => { if (keepOverlaySize()) { clearTimeout(sizeTimer); sizeTimer = setTimeout(persist, 400); } });
  sizeWatcher.observe(lines);
}
// The take being watched lives outside the redraw, so touching a control does not restart it.
let reviewVideo: HTMLVideoElement | null = null;
function syncReview() {
  const slot = document.querySelector('.tape-review-slot');
  if (!reviewing || !slot || !projectId) {
    if (reviewVideo) { reviewVideo.pause(); reviewVideo.removeAttribute('src'); reviewVideo.load(); reviewVideo.remove(); reviewVideo = null; }
    return;
  }
  const src = `/api/projects/${encodeURIComponent(projectId)}/takes/${encodeURIComponent(reviewing)}`;
  if (!reviewVideo) { reviewVideo = document.createElement('video'); reviewVideo.className = 'tape-review'; reviewVideo.controls = true; reviewVideo.playsInline = true; }
  if (reviewVideo.dataset.src !== src) { reviewVideo.dataset.src = src; reviewVideo.src = src; void reviewVideo.play().catch(() => {}); }
  if (reviewVideo.parentElement !== slot) slot.append(reviewVideo);
}
function syncTakePreview() {
  syncReview();
  const video = document.querySelector<HTMLVideoElement>('#tape-preview');
  if (!video) return;
  watchOverlaySize();
  if (recorder && video.srcObject !== recorder.preview) video.srcObject = recorder.preview;
  if (!recorder && video.srcObject) video.srcObject = null;
}
function applyScreen(focus = false) {
  document.body.dataset.screen = screen;
  // During a take the player is off limits: a stray click would change the scene partner.
  const taping = !!recorder?.recording;
  document.body.classList.toggle('is-taping', taping);
  document.querySelector('.player')?.toggleAttribute('inert', taping);
  document.querySelector<HTMLElement>('.workspace-grid')!.hidden = screen !== 'rehearsal';
  document.querySelector<HTMLElement>('.cast-screen')!.hidden = screen !== 'cast';
  const tape = document.querySelector<HTMLElement>('.selftape-screen');
  if (tape) tape.hidden = screen !== 'selftape';
  const library = document.querySelector<HTMLElement>('.projects-screen');
  if (library) library.hidden = screen !== 'projects';
  const services = document.querySelector<HTMLElement>('.settings-screen');
  if (services) services.hidden = screen !== 'settings';
  if (screen !== 'settings' && voiceRec) void stopVoiceRecording(true);
  document.querySelectorAll<HTMLAnchorElement>('[data-screen]').forEach(link => {
    if (link.dataset.screen === screen) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  // Edit script belongs to the script, not to every screen that shares this heading.
  const edit = document.querySelector<HTMLElement>('[data-action="edit"]');
  if (edit) edit.hidden = screen !== 'rehearsal';
  const eyebrow = document.querySelector<HTMLElement>('.page-heading .eyebrow');
  if (eyebrow) eyebrow.hidden = screen === 'settings';
  const heading = document.querySelector<HTMLElement>('#screen-title')!;
  const [title, blurb] = SCREEN_COPY[screen];
  heading.textContent = title;
  heading.nextElementSibling!.textContent = blurb;
  if (screen !== 'selftape') reviewVideo?.pause();
  syncTakePreview();
  if (focus) { heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }
}
window.addEventListener('hashchange', () => {
  const leaving = screen;
  screen = screenFromHash();
  // Navigating away from the self-tape screen gives the camera back.
  if (leaving === 'selftape' && screen !== 'selftape') void (recorder?.recording ? stopTake().then(closeCamera) : closeCamera());
  // Only the screen on show carries a copy of the script, so a second one never doubles the page.
  if (leaving !== screen && (leaving === 'selftape' || screen === 'selftape')) render();
  stopVoicePreview(); applyScreen(true);
  if (screen === 'rehearsal' && !audio.paused) requestAnimationFrame(() => syncActiveLine(true));
});
function chooseRole(name: string) {
  if (!parsed.characters.includes(name) || name === prefs.role || busy()) return;
  const previous = prefs.role; prefs.role = name;
  if (castingConfig.preferredActorVoice && prefs.cast[previous] === castingConfig.preferredActorVoice && !prefs.manualVoices[previous]) delete prefs.cast[previous];
  // A manually picked voice remains an explicit choice when changing roles.
  castDefaults(); invalidate();
}
function render() {
  const focused = document.activeElement instanceof HTMLElement && app.contains(document.activeElement) ? document.activeElement : null;
  const focusSelector = focused?.id ? `#${CSS.escape(focused.id)}` : focused ? ['data-action', 'data-character', 'data-voice', 'data-id', 'data-cast', 'data-gender'].filter(key => focused.hasAttribute(key)).map(key => `[${key}="${CSS.escape(focused.getAttribute(key)!)}"]`).join('') : '';
  const current = scene();
  const oldScroll = document.querySelector('.script-paper-scroll');
  const oldNav = document.querySelector('.scenes');
  const keepPosition = displayedSceneId === current?.id && displayedSource === prefs.source;
  const scrollTop = keepPosition ? oldScroll?.scrollTop || 0 : 0;
  const scrollLeft = keepPosition ? oldScroll?.scrollLeft || 0 : 0;
  const navLeft = oldNav?.scrollLeft || 0;
  const sidebarTop = document.querySelector('.sidebar')?.scrollTop || 0;
  displayedSceneId = current?.id || ''; displayedSource = prefs.source;
  const dialogue = current?.lines.filter(line => line.kind === 'dialogue') || [];
  const mine = dialogue.filter(line => line.character === prefs.role).length;
  app.innerHTML = `<div class="studio">
    <aside class="sidebar" aria-label="Project navigation">
      <a class="brand" href="#" aria-label="Script Glow home"><img class="brand-mark" src="/brand/script-glow-mark-v2.png" alt="" width="40" height="40"> script<span>glow</span><small>REHEARSAL STUDIO</small><small class="app-version" title="Script Glow version">v${__APP_VERSION__}</small></a>
      <div class="sidebar-heading">YOUR WORKSPACE <span>01</span></div>
      <div class="project"><span class="project-icon">${icon('book')}</span><div><strong>${esc(prefs.name)}</strong><small>${parsed.scenes.length} scenes · ${parsed.characters.length} characters</small></div></div>
      <div class="section-label">SCENES <span>${String(parsed.scenes.length).padStart(2, '0')}</span></div>
      <nav class="scenes">${parsed.scenes.map((item, index) => { const yours = sceneIncludes(item, prefs.role); return `<button class="scene-tab ${current?.id === item.id ? 'selected' : ''} ${yours ? 'has-role' : ''}" data-action="scene" data-id="${esc(item.id)}" ${yours ? `title="${esc(prefs.role)} is in this scene"` : ''}><span class="scene-number">${String(index + 1).padStart(2, '0')}</span><span><strong>${esc(pretty(item.title.replace(/^(INT\.?|EXT\.?)\s*/i, '')))}</strong><small>${item.lines.filter(line => line.kind === 'dialogue').length} dialogue lines${yours ? ' · YOU' : ''}</small></span>${current?.id === item.id ? '<span class="scene-dot"></span>' : ''}</button>`; }).join('')}</nav>
      <div class="sidebar-bottom"><div class="local-badge"><span class="status-dot ${ttsOnline ? 'online' : ''}"></span> ${connectionChecked ? ttsOnline ? 'Voices connected' : 'Voices not connected' : 'Checking voices…'}</div><p>Your words stay yours.<br>${hostedEngine() ? `Script lines go to ${esc(engineName())}<br>to be voiced.` : 'Scripts & audio stay local.'}</p><button class="text-link" data-action="reconnect">Check connection ${icon('chevron', 12)}</button></div>
    </aside>
    <main class="main">
      <header class="topbar"><nav class="studio-menu" aria-label="Studio screens"><a href="#rehearsal" data-screen="rehearsal">Rehearsal</a><a href="#cast" data-screen="cast">Cast <span>${parsed.characters.length}</span></a><a href="#selftape" data-screen="selftape">Self-tape${takes.length ? ` <span>${takes.length}</span>` : ''}</a><a href="#projects" data-screen="projects">Projects</a><a href="#settings" data-screen="settings">Settings</a></nav><div class="breadcrumb">${esc(prefs.name)}</div><p id="project-save-status" class="save-status" role="status" aria-live="polite"></p><button type="button" class="help-button" data-action="help" aria-haspopup="dialog">? Help</button><div class="private-pill"><span></span> ${hostedEngine() ? `HOSTED VOICES · ${esc(engineName().toUpperCase())}` : 'PRIVATE STUDIO'}</div></header>
      <section class="page-heading"><div><p class="eyebrow">A LITTLE PRACTICE. A BETTER PERFORMANCE.</p><h1 id="screen-title" tabindex="-1">Make the scene yours<span>.</span></h1><p>Find your rhythm. Learn your lines. Be ready when it counts.</p></div><button class="button secondary" data-action="edit">${icon('edit', 17)} Edit script</button></section>
      ${notice ? `<div class="notice ${noticeError ? 'error' : ''}" role="${noticeError ? 'alert' : 'status'}"><span>${esc(notice)}</span><button data-action="dismiss" aria-label="Dismiss notification">${icon('close', 16)}</button></div>` : ''}
      ${connectionChecked && !ttsOnline ? hostedEngine()
        ? `<div class="notice voices-offline" role="status"><span><strong>One step left:</strong> add your ${esc(engineName())} key, and the cast can start reading.</span><span class="notice-actions"><a class="button primary small" href="#settings">Add the key in Settings</a></span></div>`
        : `<div class="notice error voices-offline" role="status"><span><strong>Voices are not connected.</strong> Script Glow cannot make audio until its voice service is running.</span><span class="notice-actions"><button type="button" data-action="reconnect">Check again</button><button type="button" data-action="help">How to fix</button></span></div>` : ''}
      ${parsed.scenes.length ? parsed.warnings.map(warning => `<div class="notice" role="status">${esc(warning)}</div>`).join('') : ''}
      <div class="workspace-grid">
        <section class="script-panel" aria-label="Script scene"><div class="script-toolbar"><div><span class="live-dot"></span> ${String(parsed.scenes.indexOf(current!) + 1).padStart(2, '0')} <span class="muted">/ ${String(parsed.scenes.length).padStart(2, '0')}</span><span class="toolbar-divider"></span><span>THE SCRIPT</span></div><div class="reveal-controls"><label class="hide-control">${icon('eye', 16)} Hide <span class="wide-only">my lines</span> <input type="checkbox" id="hide-lines" ${prefs.hide ? 'checked' : ''} ${prefs.listen ? 'disabled' : ''}><span class="switch"></span></label><label class="hide-control" title="Hide the whole scene and rehearse by ear">Listen <span class="wide-only">only</span> <input type="checkbox" id="listen-only" ${prefs.listen ? 'checked' : ''}><span class="switch"></span></label></div></div>
          <div class="script-page ${result ? 'has-audio' : ''}" id="script-page"><div class="script-meta"><span>${esc(prefs.name.toUpperCase())}</span><span>${String(parsed.scenes.indexOf(current!) + 1).padStart(2, '0')}</span></div><h2>${esc(current?.title || 'Your next scene starts here')}</h2><div class="scene-rule"></div>
            ${sceneLinesMarkup()}
            <div class="end-scene"><span></span> END OF SCENE <span></span></div>
          </div><div class="script-footer"><span><span class="role-dot"></span> Your lines are marked</span><span>${dialogue.length} lines <span class="muted">·</span> ${mine} yours</span></div>
        </section>
        <aside class="settings-panel" aria-label="Rehearsal settings"><section class="settings-card"><div class="card-heading"><h2>Your part</h2><span class="mini-label">01</span></div><p>Step into your character.</p><label class="field-label" for="my-role">I’M PLAYING</label><select id="my-role" ${!parsed.characters.length || busy() ? 'disabled' : ''}>${parsed.characters.map(name => `<option value="${esc(name)}" ${prefs.role === name ? 'selected' : ''}>${esc(pretty(name))}</option>`).join('') || '<option>No characters yet</option>'}</select><div class="voice-note"><span class="avatar">${esc(prefs.role.slice(0, 1) || 'M')}</span><div><strong>${esc(prefs.cast[prefs.role] ? voiceLabel(prefs.cast[prefs.role]) : 'No voice connected')}</strong><small>${prefs.cast[prefs.role] === castingConfig.preferredActorVoice ? 'Your local cloned voice' : 'Assigned character voice'}</small></div>${prefs.cast[prefs.role] === castingConfig.preferredActorVoice ? icon('check', 16) : ''}</div></section>
          <section class="settings-card practice-card"><div class="card-heading"><h2>Practice</h2>${icon('eye', 19)}</div>
            <label class="checkbox-label"><input type="checkbox" id="first-letters" ${prefs.hint ? 'checked' : ''}> First letters of hidden lines</label>
            <label class="checkbox-label"><input type="checkbox" id="wait-for-me" ${prefs.wait ? 'checked' : ''}> Wait for me on my line</label>
            <label class="checkbox-label"><input type="checkbox" id="build-up" ${prefs.build ? 'checked' : ''}> Build up line by line</label>
            ${prefs.build ? `<div class="build-row"><label for="build-repeats">Times through each block</label><select id="build-repeats">${[1, 2, 3, 4, 5].map(times => `<option value="${times}" ${times === prefs.buildRepeats ? 'selected' : ''}>${times}×</option>`).join('')}</select><button type="button" class="text-link" data-action="build-restart">Start again</button></div>` : ''}
            <div class="loop-marks"><span>Repeat</span><button type="button" data-action="mark-a" class="${prefs.loopA ? 'enabled' : ''}" aria-pressed="${!!prefs.loopA}" ${!result ? 'disabled' : ''}>A</button><button type="button" data-action="mark-b" class="${prefs.loopB ? 'enabled' : ''}" aria-pressed="${!!prefs.loopB}" ${!result ? 'disabled' : ''}>B</button><button type="button" data-action="clear-marks" ${!prefs.loopA && !prefs.loopB ? 'disabled' : ''}>Clear</button></div>
            <p class="practice-hint">${practiceHint()}</p></section>
          <section class="settings-card cast-card"><div class="card-heading"><h2>The cast</h2><span class="cast-count">${parsed.characters.length}</span></div><p>A voice for every character.</p><div class="cast-list"></div></section>
          <section class="settings-card render-card"><div class="card-heading"><h2>Set the pace</h2>${icon('wave', 19)}</div><label class="gap-label" for="line-gap">Pause between lines <strong id="gap-value">${prefs.gap.toFixed(1)}s</strong></label><input type="range" id="line-gap" min="0" max="5" step="0.5" value="${prefs.gap}" ${busy() ? 'disabled' : ''}><div class="range-labels"><span>Natural</span><span>Take your time</span></div><label class="checkbox-label"><input type="checkbox" id="directions" ${prefs.directions ? 'checked' : ''} ${busy() ? 'disabled' : ''}> Read stage directions</label>
          <button class="button secondary render-button" data-action="render" ${busy() || !ttsOnline || !dialogue.length || !voices.length ? 'disabled' : ''}>${icon('wave', 17)} ${busy() ? 'Making audio…' : result ? 'Make audio again' : 'Make audio'} ${!busy() ? '<span>↗</span>' : ''}</button><p class="render-hint">Two tracks. Full cast + space for you.</p>
          <div id="job-progress" role="status" aria-live="polite">${job ? progressMarkup() : ''}</div></section>
          <div class="practice-tip"><span>✦</span><p><strong>Leave a little room for yourself.</strong> Practice mode silences your character, keeping every cue right on time.</p></div>
        </aside>
      </div>
      <footer class="page-footer"><span>MADE FOR THE MOMENT BEFORE “ACTION.”</span><span>LOCAL VOICES. YOUR STORY.</span></footer>
    </main>
    <section class="player" aria-label="Scene audio player"><div class="player-scene"><span class="player-art">${icon('wave', 23)}</span><div><strong>${esc(current ? pretty(current.title.replace(/^(INT\.?|EXT\.?)\s*/i, '')) : 'No scene selected')}</strong><small id="player-status">${result ? 'Ready to rehearse' : busy() ? (hostedEngine() ? `Voicing with ${esc(engineName())}…` : 'Making audio with local voices…') : 'Press Play to make the audio and listen'}</small></div></div><div class="playback"><div class="playback-actions"><button class="icon-button" data-action="cue-back" aria-label="Previous cue" title="Previous cue (left arrow)" ${!result ? 'disabled' : ''}>${icon('back', 17)}</button><button class="play-button ${waitingFor ? 'is-waiting' : ''}" data-action="play" aria-label="${waitingFor ? 'Continue after your line' : `${audio.paused ? 'Play' : 'Pause'} scene`}" ${!result ? 'disabled' : ''}>${waitingFor ? `${icon('play', 17)}<span>Continue</span>` : icon(audio.paused ? 'play' : 'pause', 21)}</button><button class="icon-button" data-action="cue-forward" aria-label="Next cue" title="Next cue (right arrow)" ${!result ? 'disabled' : ''}>${icon('forward', 17)}</button><button class="icon-button ${prefs.loop ? 'enabled' : ''}" data-action="loop" aria-label="Loop scene" aria-pressed="${prefs.loop}">${icon('loop', 17)}</button><select id="playback-rate" aria-label="Playback speed">${[0.75, 1, 1.25, 1.5].map(rate => `<option value="${rate}" ${rate === prefs.rate ? 'selected' : ''}>${rate}×</option>`).join('')}</select></div><div class="seek-row"><span id="current-time">${time(audio.currentTime)}</span><input id="seek" type="range" aria-label="Seek audio" min="0" max="${result?.duration || 1}" step="0.05" value="${audio.currentTime || 0}" ${!result ? 'disabled' : ''}><span id="duration">${time(result?.duration || 0)}</span></div></div><div class="player-right"><div class="mode-switch" role="group" aria-label="Rehearsal mode"><button data-action="mode-full" class="${prefs.mode === 'full' ? 'selected' : ''}" aria-pressed="${prefs.mode === 'full'}">Full cast</button><button data-action="mode-practice" class="${prefs.mode === 'practice' ? 'selected' : ''}" aria-pressed="${prefs.mode === 'practice'}">Practice <span>YOU’RE UP</span></button></div><div class="downloads">${result ? `<a href="${esc(result.fullUrl)}" download="${esc(prefs.name)}-full.wav">${icon('download', 13)} Full cast</a><a href="${esc(result.practiceUrl)}" download="${esc(prefs.name)}-practice.wav">${icon('download', 13)} Practice</a>` : '<span>Downloads appear after the audio is made</span>'}</div></div></section>
  </div>`;
  finishRenderUI();
  document.querySelector('.script-paper-scroll')?.scrollTo({ top: scrollTop, left: scrollLeft, behavior: 'instant' });
  document.querySelector('.scenes')?.scrollTo({ left: navLeft, behavior: 'instant' });
  document.querySelector('.sidebar')?.scrollTo({ top: sidebarTop, behavior: 'instant' });
  syncActiveLine(!audio.paused);
  updatePlaybackStatus();
  applyRate();
  const replacement = focusSelector ? app.querySelector<HTMLElement>(focusSelector) : null;
  if (replacement?.getClientRects().length && !replacement.matches(':disabled')) replacement.focus({ preventScroll: true });
}
function progressMarkup() {
  if (!job) return '';
  if (job.status === 'error') return `<div class="job-error">${esc(job.error || 'The audio could not be made. Check the voice engine and try again.')}</div>`;
  if (job.status === 'complete') return `<div class="job-complete">${icon('check', 14)} Both tracks ready · ${time(result?.duration || 0)}</div>`;
  return `<div class="job-label"><span>${job.status === 'queued' ? (hostedEngine() ? `Queued for ${engineName()}` : 'Queued for the local GPU') : `${job.completed} of ${job.total} lines generated`}</span><button data-action="cancel">Cancel</button></div><progress max="${job.total || 1}" value="${job.completed}"></progress><small class="cold-start">The first time can take a few minutes.</small>`;
}
async function connect(restoreOnStartup = false) {
  const responses = await Promise.allSettled([api<{ tts: { ok: boolean } }>('/api/health'), api<{ voices: string[]; engine?: string; details?: typeof liveVoices }>('/api/voices'), api<{ casting: typeof castingConfig; voice?: { engine: string } }>('/api/connections')]);
  if (responses[2].status === 'fulfilled') voiceEngine = responses[2].value.voice?.engine ?? 'chatterbox';
  profileReady = responses[2].status === 'fulfilled';
  if (responses[2].status === 'fulfilled') castingConfig = { ...castingConfig, ...responses[2].value.casting };
  else { notice = 'Connection profile unavailable. Existing voice assignments are preserved. Check connection before automatic casting.'; noticeError = true; }
  connectionChecked = true;
  ttsOnline = responses[0].status === 'fulfilled' && responses[0].value.tts.ok;
  voices = responses[1].status === 'fulfilled' ? responses[1].value.voices : [];
  liveVoices = responses[1].status === 'fulfilled' ? responses[1].value.details ?? {} : {};
  for (const [id, item] of Object.entries(liveVoices)) if (item.gender === 'male' || item.gender === 'female') voiceGenders[id] = item.gender;
  const previousCast = JSON.stringify(prefs.cast);
  castDefaults();
  if (previousCast !== JSON.stringify(prefs.cast) || restoreOnStartup && generation === 0 && !result && !busy()) invalidate(true);
  persist(); render(); void guessNames();
}
async function renderScene(playWhenReady = false) {
  const startingProject = projectId;
  if (aiLoading) { flash('The AI is checking names. Make the audio when it finishes.'); return; }
  if (libraryBusy || !await saveProjectNow()) { flash(saveError || libraryError || 'Save the project before making audio.', true); return; }
  if (libraryBusy || startingProject !== projectId) return;
  const current = scene(); if (!current || busy()) return;
  const request = renderInputs(current);
  const cacheKey = JSON.stringify(request);
  invalidate(); notice = ''; noticeError = false;
  const token = generation;
  job = { id: '', status: 'queued', completed: 0, total: current.lines.filter(line => line.kind === 'dialogue' || prefs.directions).length }; render();
  try {
    const started = await api<{ jobId: string }>('/api/render', { method: 'POST', body: JSON.stringify({ ...request, projectId, renderKey: cacheKey }) });
    if (token !== generation) { void api(`/api/jobs/${encodeURIComponent(started.jobId)}/cancel`, { method: 'POST' }).catch(() => {}); return; }
    job.id = started.jobId;
    while (token === generation) {
      const update = await api<Job>(`/api/jobs/${encodeURIComponent(started.jobId)}`);
      if (token !== generation) return;
      job = update;
      if (update.status === 'complete') {
        if (!update.result) throw new Error('The engine finished without returning audio. Try making the audio again.');
        result = update.result;
        completedScenes.delete(cacheKey); completedScenes.set(cacheKey, result);
        persistRenders();
        void refreshProjectList().catch(() => {});
        loadAudio(0, playWhenReady); render(); return;
      }
      if (update.status === 'error') { render(); return; }
      const progress = document.querySelector('#job-progress'); if (progress) progress.innerHTML = progressMarkup();
      const status = document.querySelector('#player-status'); if (status) status.textContent = `Making audio for the ${current.id === 'full-script' ? 'full script' : 'scene'}: ${job.completed}/${job.total} lines`;
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  } catch (error) { if (token === generation) { job = { ...job!, status: 'error', error: error instanceof Error ? error.message : 'The audio could not be made.' }; render(); } }
}
function loadAudio(position: number, resume: boolean) {
  if (!result) return;
  const version = ++audioLoadVersion;
  loadedMode = prefs.mode;
  audio.src = prefs.mode === 'full' ? result.fullUrl : result.practiceUrl;
  audio.playbackRate = prefs.rate;
  const apply = () => { if (version !== audioLoadVersion || !result) return; audio.currentTime = Math.min(position, result.duration); if (resume) void audio.play().catch(error => flash(error.name === 'NotAllowedError' ? 'Audio is ready. Your browser needs one more tap on Play.' : `Playback could not start: ${error.message}`, error.name !== 'NotAllowedError')); };
  audio.addEventListener('loadedmetadata', apply, { once: true }); audio.load();
}
function editScript() {
  const dialog = document.createElement('dialog'); dialog.className = 'editor-dialog'; dialog.setAttribute('aria-labelledby', 'editor-title');
  dialog.innerHTML = `<form method="dialog"><div class="editor-heading"><div><p class="eyebrow">SCRIPT WORKSHOP</p><h2 id="editor-title">Get every line in place.</h2></div><button value="cancel" class="icon-button" aria-label="Close script editor">${icon('close')}</button></div><label class="field-label" for="script-name">PROJECT TITLE</label><input id="script-name" maxlength="100" value="${esc(prefs.name)}"><label class="field-label" for="script-source">SCRIPT SOURCE</label><p class="editor-help">Use INT./EXT. headings, uppercase character names above dialogue, or NAME: dialogue. Blank lines separate dialogue from action. Text PDFs only; scanned pages need OCR first.</p><textarea id="script-source" spellcheck="false">${esc(prefs.source)}</textarea><div id="parse-preview" class="parse-preview"></div><div class="editor-actions"><button type="button" class="text-link" id="export-source">Export source</button><button class="button secondary" value="cancel">Cancel</button><button type="button" id="save-script" class="button primary">Save script</button></div></form>`;
  document.body.append(dialog);
  const source = dialog.querySelector<HTMLTextAreaElement>('#script-source')!;
  dialog.querySelector('.editor-help')!.textContent = 'Scenes need their own heading line: INT./EXT., numbered shooting headings, SCENE 1, or a Fountain heading such as .THE GARDEN. For unrecognized scene breaks, insert # Scene title above each scene. The preview below shows the detected count before saving. Blank lines separate dialogue from action. Scanned PDFs need OCR first.';
  const preview = () => { const draft = parseScript(source.value); dialog.querySelector('#parse-preview')!.textContent = `${draft.scenes.length} scenes · ${draft.characters.length} characters · ${draft.scenes.reduce((sum, item) => sum + item.lines.filter(line => line.kind === 'dialogue').length, 0)} dialogue lines${draft.warnings.length ? ` — ${draft.warnings.join(' ')}` : ` · Cast: ${draft.characters.join(', ')}`}`; };
  source.addEventListener('input', preview); preview();
  // Closing never throws away typing without asking: Esc, Cancel and the close button all check.
  const nameInput = dialog.querySelector<HTMLInputElement>('#script-name')!;
  const edited = () => source.value !== prefs.source || nameInput.value !== prefs.name;
  const mayClose = () => !edited() || confirm('Close the editor and lose your changes to the script?');
  dialog.addEventListener('cancel', event => { if (!mayClose()) event.preventDefault(); });
  dialog.querySelector('form')!.addEventListener('submit', event => { if (!mayClose()) event.preventDefault(); });
  dialog.querySelector('#save-script')!.addEventListener('click', () => {
    const next = parseScript(source.value);
    if (!next.scenes.some(scene => scene.lines.some(line => line.kind === 'dialogue')) && !confirm('This text has no dialogue Script Glow can find. Saving it replaces your script and clears its audio. Save anyway?')) return;
    if (!mayCancelRender()) return; prefs.source = source.value; prefs.name = dialog.querySelector<HTMLInputElement>('#script-name')!.value.trim() || 'Untitled script'; parsed = parseScript(prefs.source); prefs.sceneId = parsed.scenes[0]?.id || ''; castDefaults(); invalidate(); notice = parsed.scenes.length ? 'Script saved. Check the cast, then press Play to make the audio.' : ''; noticeError = false; dialog.close(); render(); void guessNames(); });
  dialog.querySelector('#export-source')!.addEventListener('click', () => { const url = URL.createObjectURL(new Blob([source.value], { type: 'text/plain' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${prefs.name}.fountain`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
  source.focus(); source.setSelectionRange(0, 0); source.scrollTop = 0;
}
app.addEventListener('pointerdown', event => {
  const grip = (event.target as HTMLElement).closest<HTMLElement>('[data-action="tape-drag"]');
  if (grip) { event.preventDefault(); startScriptDrag(grip, event); }
});
app.addEventListener('click', async event => {
  if (recorder?.recording && (event.target as HTMLElement).closest('.player')) return;
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) {
    // Clicking a line moves the playhead to it, so play carries on from there.
    const line = (event.target as HTMLElement).closest<HTMLElement>('[data-line]');
    const cue = line && result?.cues.find(item => item.lineId === line.dataset.line);
    if (cue) { waitingFor = ''; audio.currentTime = cue.start; syncActiveLine(true); render(); }
    return;
  }
  const action = target.dataset.action;
  if (action === 'retry-save') {
    if (!libraryReady) { await openLibrary(); if (libraryReady) await connect(true); }
    else { try { if (libraryError) { await refreshProjectList(); libraryError = ''; } await saveProjectNow(); } catch (error) { libraryError = error instanceof Error ? error.message : 'Local library unavailable.'; } render(); }
    return;
  }
  if (action === 'recover-project') { await saveRecoveryCopy(); return; }
  if (libraryBusy || !libraryReady) return;
  if (action === 'choose-role') { chooseRole(target.dataset.character || ''); render(); return; }
  if (action === 'highlight-character') { prefs.highlightCharacter = target.dataset.character || ''; persist(); render(); return; }
  if (action === 'backup-project') {
    const exportingId = projectId, exportingName = prefs.name;
    try {
      if (!await saveProjectNow()) throw new Error(saveError || 'Save the project before exporting.');
      await api(`/api/projects/${exportingId}/backup-info`);
      const link = document.createElement('a'); link.href = `/api/projects/${exportingId}/backup`; link.download = `${exportingName}.sgbackup`; link.click();
      flash('Backup download started. Check your browser downloads for completion.');
    } catch (error) { flash(error instanceof Error ? error.message : 'Backup export failed.', true); }
    return;
  }
  if (action === 'restore-project') {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.sgbackup';
    input.addEventListener('change', () => { if (input.files?.[0]) void restoreProject(input.files[0]); }); input.click(); return;
  }
  if (action === 'guess-names') { void guessNames(); return; }
  if (action === 'apply-guesses') { applyGuesses(); return; }
  if (action === 'voice-preview') { void playVoicePreview(target.dataset.voice || ''); return; }
  if (action === 'play' || action === 'mode-full' || action === 'mode-practice') stopVoicePreview();
  if (action === 'import') { fileInput.click(); return; }
  if (action === 'edit') { editScript(); return; }
  if (action === 'help') { openHelp(); return; }
  if (action === 'render') { void renderScene(); return; }
  if (action === 'reconnect') { await connect(); flash(ttsOnline ? 'Voices connected.' : 'Still cannot reach the voice service. Open Help, then Troubleshooting.', !ttsOnline); return; }
  if (action === 'dismiss') notice = '';
  if (action === 'scene' || action === 'scope-script') {
    const id = action === 'scene' ? target.dataset.id! : 'full-script';
    if (id !== prefs.sceneId && mayCancelRender()) { prefs.sceneId = id; invalidate(true); }
    location.hash = '#rehearsal';
  }
  if (action === 'reveal') revealed.add(target.dataset.id!);
  if (action === 'loop') { prefs.loop = !prefs.loop; applyRate(); persist(); }
  if (action === 'cue-back' || action === 'cue-forward') { const to = stepCue(result?.cues, audio.currentTime, action === 'cue-forward' ? 1 : -1); if (to !== null) { waitingFor = ''; audio.currentTime = to; } }
  if (action === 'mark-a' || action === 'mark-b') { const key = action === 'mark-a' ? 'loopA' : 'loopB'; const here = currentCue()?.lineId || ''; prefs[key] = prefs[key] === here ? '' : here; applyRate(); persist(); }
  if (action === 'clear-marks') { prefs.loopA = ''; prefs.loopB = ''; applyRate(); persist(); }
  if (action === 'build-restart') { restartBuild(); if (result) audio.currentTime = (prefs.loopA && result.cues.find(item => item.lineId === prefs.loopA)?.start) || 0; }
  if (action === 'test-service') { await testService(target.dataset.service!); return; }
  if (action === 'save-services') { await saveServices(); return; }
  if (action === 'voice-record') { discardVoice(); await startVoiceRecording(); return; }
  if (action === 'voice-stop') { await stopVoiceRecording(); return; }
  if (action === 'voice-cancel') { await stopVoiceRecording(true); return; }
  if (action === 'voice-discard') { discardVoice(); return; }
  if (action === 'voice-save') { await saveVoice(); return; }
  if (action === 'open-project') { await switchProject(target.dataset.id!); return; }
  if (action === 'delete-project') {
    if (!confirm(`Delete "${target.dataset.name}"? Its script, audio and takes move to the trash folder, data/projects/.trash, where they can be moved back by hand.`)) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(target.dataset.id!)}`, { method: 'DELETE', headers: sessionHeader() });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'The project could not be deleted.');
      await refreshProjectList(); flash(`Deleted "${target.dataset.name}". It is in data/projects/.trash.`);
    } catch (error) { flash(error instanceof Error ? error.message : 'The project could not be deleted.', true); }
    return;
  }
  if (action === 'edit-key') { keyEditing.add(target.dataset.provider!); render(); document.querySelector<HTMLInputElement>(`#key-${target.dataset.provider}`)?.focus(); return; }
  if (action === 'cancel-key') { keyEditing.delete(target.dataset.provider!); delete keyDrafts[target.dataset.provider!]; render(); return; }
  if (action === 'settings-jump') { const section = document.getElementById(target.dataset.target!); settingsJumpTarget = section?.id ?? ''; markSettingsSection(); section?.classList.remove('is-flashed'); void section?.offsetWidth; section?.classList.add('is-flashed'); setTimeout(() => section?.classList.remove('is-flashed'), 1500); if (section?.id === 'set-advanced') { settingsAdvancedOpen = true; section.querySelector('details')?.setAttribute('open', ''); } section?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true }); return; }
  if (action === 'save-key' || action === 'remove-key') { await changeKey(target.dataset.provider!, action === 'remove-key'); return; }
  if (action === 'reset-services') { await loadSettings(true); settingsResults = []; settingsNotice = ''; settingsError = false; render(); return; }
  if (action === 'tape-drag') return;
  if (action === 'tape-focus') { setTakeFocus(!takeFocus); return; }
  if (action === 'tape-centre') { prefs.tapeX = 50; prefs.tapeY = 78; prefs.tapeW = 0; prefs.tapeH = 0; persist(); render(); return; }
  if (action === 'camera-on') { await openCamera(); return; }
  if (action === 'camera-off') { await closeCamera(); return; }
  if (action === 'record-start') { startTake('scene'); return; }
  if (action === 'record-slate') { startTake('slate'); return; }
  if (action === 'take-trim') { const file = target.dataset.file!; const take = takes.find(item => item.file === file); reviewing = file; trimming = { file, start: 0, end: (take?.ms ?? 0) / 1000, progress: 0 }; render(); return; }
  if (action === 'trim-cancel') { trimming = null; render(); return; }
  if (action === 'trim-start' || action === 'trim-end') {
    if (trimming && reviewVideo) {
      const at = Math.round(reviewVideo.currentTime * 10) / 10;
      if (action === 'trim-start') trimming.start = Math.min(at, trimming.end ? trimming.end - 0.5 : at);
      else trimming.end = Math.max(at, trimming.start + 0.5);
      render();
    }
    return;
  }
  if (action === 'trim-preview') { if (trimming && reviewVideo) { reviewVideo.currentTime = trimming.start; void reviewVideo.play(); const stopAt = trimming.end; const watch = () => { if (!reviewVideo || reviewVideo.paused) return; if (stopAt && reviewVideo.currentTime >= stopAt) { reviewVideo.pause(); return; } setTimeout(watch, 100); }; watch(); } return; }
  if (action === 'trim-make') { await makeMp4(); return; }
  if (action === 'record-stop') { await stopTake(); return; }
  if (action === 'take-play') { reviewing = reviewing === target.dataset.file ? '' : target.dataset.file!; render(); return; }
  if (action === 'take-delete') {
    const take = takes.find(item => item.file === target.dataset.file);
    if (!take || !confirm(`Delete ${take.label}? The recording is removed from this machine and cannot be recovered.`)) return;
    if (reviewing === take.file) reviewing = '';
    await takeRequest(take.file, { method: 'DELETE' }, 'The take could not be deleted.');
    return;
  }
  if (action === 'play') { if (!result) { if (!busy()) void renderScene(true); return; } if (waitingFor) releaseWait(); else if (loadedMode !== prefs.mode) loadAudio(audio.currentTime, true); else if (audio.paused) await audio.play().catch(error => flash(`Playback could not start: ${error.message}`, true)); else audio.pause(); }
  if (action === 'mode-full' || action === 'mode-practice') { const position = audio.currentTime; const resume = !audio.paused; prefs.mode = action === 'mode-full' ? 'full' : 'practice'; persist(); if (result && loadedMode !== prefs.mode) loadAudio(position, resume); }
  if (action === 'cancel') { invalidate(); notice = 'Stopped. You can make changes and try again.'; }
  render();
});
// The Advanced drawer stays as the actor left it when the screen redraws.
// Copies one Settings field into the draft. Returns true when the screen had to be redrawn.
function applySettingField(target: HTMLInputElement): boolean {
  const draft = settingsDraft;
  if (!draft) return false;
  const value = target.value.trim();
  if (target.id === 'service-chatterbox') draft.chatterbox.url = value;
  if (target.id === 'service-whisperx') draft.whisperx.url = value;
  if (target.id === 'service-ollama') draft.ollama.url = value;
  if (target.id === 'service-model') draft.ollama.model = value;
  if (target.id === 'service-name') draft.name = value;
  if (target.id === 'service-voice-model') draft.voice.model = value;
  if (target.id === 'service-names-engine') { draft.names = { engine: value, model: '' }; settingsResults = []; settingsNotice = ''; render(); return true; }
  if (target.id === 'service-names-model') draft.names.model = value;
  if (target.id === 'service-voice') draft.casting.preferredActorVoice = value;
  if (target.id === 'service-legacy') draft.chatterbox.legacyCache = target.checked;
  return false;
}
// The Settings menu marks the section you are reading.
// At the bottom of the page the last section counts as current, even when it is too short to reach the top.
let settingsJumpTarget = '';
function markSettingsSection() {
  const nav = document.querySelector('.settings-nav');
  if (!nav || screen !== 'settings') return;
  const sections = [...document.querySelectorAll<HTMLElement>('.settings-section')];
  const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
  const reached = sections.filter(section => section.getBoundingClientRect().top <= 140).pop() ?? sections[0];
  // A section chosen from the menu stays marked while the page scrolls towards it.
  const chosen = sections.find(section => section.id === settingsJumpTarget);
  const current = chosen ?? (atBottom ? sections.at(-1) : reached);
  nav.querySelectorAll<HTMLElement>('button').forEach(button => button.toggleAttribute('aria-current', button.dataset.target === current?.id));
}
addEventListener('scroll', markSettingsSection, { passive: true });
addEventListener('wheel', () => { settingsJumpTarget = ''; }, { passive: true });
addEventListener('touchmove', () => { settingsJumpTarget = ''; }, { passive: true });
addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) settingsJumpTarget = ''; });
app.addEventListener('toggle', event => { const target = event.target as HTMLElement; if (target.classList?.contains('advanced')) settingsAdvancedOpen = (target as HTMLDetailsElement).open; if (target.classList?.contains('more-keys')) settingsMoreKeysOpen = (target as HTMLDetailsElement).open; }, true);
app.addEventListener('input', event => {
  const target = event.target as HTMLInputElement;
  if (settingsDraft && target.closest('.settings-form') && target.id.startsWith('service-') && (target.type === 'url' || target.type === 'text')) { applySettingField(target); settingsNotice = ''; syncSaveBar(); }
  if (target.id === 'seek' && result) audio.currentTime = Number(target.value);
  if (target.id === 'reader-level') { const out = document.querySelector('output[for="reader-level"]'); if (out) out.textContent = `${Math.round(Number(target.value) * 100)}%`; }
  if (target.id === 'line-gap') { const label = document.querySelector('#gap-value'); if (label) label.textContent = `${Number(target.value).toFixed(1)}s`; }
});
app.addEventListener('change', async event => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'project-name') { prefs.name = target.value.trim().slice(0, 100) || 'Untitled script'; const entry = projectList.find(item => item.id === projectId); if (entry) entry.name = prefs.name; persist(); render(); return; }
  if (libraryBusy || !libraryReady) return;
  if (target.id === 'highlight-character') { prefs.highlightCharacter = target.value; persist(); render(); return; }
  if (target.id === 'character-color' || target.id === 'spoken-color') {
    const key = target.id === 'character-color' ? 'characterColor' : 'spokenColor';
    prefs[key] = safeColor(target.value, highlightDefaults[key]); persist(); render(); return;
  }
  if (target.id === 'scene-select') { if (mayCancelRender()) { prefs.sceneId = target.value; invalidate(true); } else target.value = prefs.sceneId; }
  if (target.id === 'follow-playback') { prefs.follow = target.checked; persist(); if (prefs.follow) syncActiveLine(true); return; }
  if (target.id === 'my-role') chooseRole(target.value);
  if (target.dataset.cast) {
    if (target.value !== prefs.cast[target.dataset.cast] && voiceOwners(target.value, target.dataset.cast, castCharacters(), prefs.cast, castingConfig.aliases).length) { render(); return; }
    prefs.cast[target.dataset.cast] = target.value; prefs.manualVoices[target.dataset.cast] = true; invalidate();
  }
  if (target.dataset.gender) { prefs.genders[target.dataset.gender] = target.value as GenderChoice; prefs.manualVoices[target.dataset.gender] = false; if (target.dataset.gender !== prefs.role) delete prefs.cast[target.dataset.gender]; castDefaults(); invalidate(); }
  if (target.id === 'line-gap') { prefs.gap = Number(target.value); invalidate(); }
  if (target.id === 'directions') { prefs.directions = target.checked; castDefaults(); invalidate(); }
  if (target.id === 'hide-lines') { prefs.hide = target.checked; revealed.clear(); persist(); }
  if (target.id === 'listen-only') { prefs.listen = target.checked; revealed.clear(); persist(); }
  if (target.dataset.file && target.classList.contains('take-name')) {
    const label = target.value.trim().slice(0, 100);
    if (!label) { render(); return; }
    await takeRequest(target.dataset.file, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) }, 'The take could not be renamed.');
    return;
  }
  if (target.id === 'voice-file') { const chosen = target.files?.[0]; target.value = ''; if (chosen) { if (voiceRec) await stopVoiceRecording(true); await voiceFromAudio(chosen); render(); } return; }
  if (target.id.startsWith('key-')) { keyDrafts[target.id.slice(4)] = target.value; return; }
  if (target.name === 'service-engine' && settingsDraft) { settingsDraft.voice = { engine: target.value, model: '' }; settingsResults = []; settingsNotice = ''; render(); return; }
  if (target.id.startsWith('service-') && settingsDraft) {
    if (applySettingField(target)) return;
    settingsResults = []; settingsNotice = '';
    syncSaveBar();
    return;
  }
  if (target.id === 'reader-level') { prefs.readerLevel = Number(target.value); setReaderLevel(prefs.readerLevel); persist(); }
  if (target.id === 'actor-name') { try { localStorage.setItem(actorNameKey, target.value.trim().slice(0, 60)); } catch { /* the name is only a convenience */ } render(); return; }
  if (target.id === 'tape-overlay') { prefs.tapeOverlay = target.checked; persist(); }
  if (target.id === 'tape-follow') { prefs.follow = target.checked; persist(); if (prefs.follow) syncActiveLine(true); }
  if (target.id === 'first-letters') { prefs.hint = target.checked; persist(); }
  if (target.id === 'wait-for-me') { prefs.wait = target.checked; if (!target.checked && waitingFor) waitingFor = ''; persist(); }
  if (target.id === 'build-up') { prefs.build = target.checked; restartBuild(); applyRate(); persist(); }
  if (target.id === 'build-repeats') { prefs.buildRepeats = Number(target.value); restartBuild(); persist(); }
  if (target.id === 'playback-rate') { prefs.rate = Number(target.value); applyRate(); persist(); }
  if (target.id !== 'seek') render();
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]; if (!file) return; fileInput.value = '';
  if (libraryBusy || busy()) return;
  if (file.size > 15 * 1024 * 1024) { flash('Choose a script smaller than 15 MB.', true); return; }
  importing = true; libraryBusy = true; notice = ''; render();
  try {
    if (!await saveProjectNow()) throw new Error(saveError || 'Finish saving the current project before importing another script.');
    let source: string;
    if (/\.pdf$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const imported = await api<{ text: string }>('/api/import', { method: 'POST', body: JSON.stringify({ name: file.name, data: btoa(binary) }) }); source = imported.text;
    } else if (/\.(txt|fountain)$/i.test(file.name)) source = await file.text();
    else throw new Error('Supported formats: .txt, .fountain, and text-based .pdf.');
    if (!source.trim()) throw new Error('No text found. Scanned PDFs need OCR before import.');
    const draft = { ...prefs, source, name: file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '), cast: {}, genders: {}, manualVoices: {}, guesses: {}, sceneId: parseScript(source).scenes[0]?.id || '' };
    adoptProject(await createProject(draft)); await refreshProjectList(); notice = 'Script added as a new project. Your previous project and its audio remain saved.'; noticeError = false;
  } catch (error) { notice = error instanceof Error ? error.message : 'Import failed'; noticeError = true; }
  importing = false; libraryBusy = false; persist(); render(); void guessNames();
});
audio.addEventListener('timeupdate', () => {
  const position = audio.currentTime;
  const seek = document.querySelector<HTMLInputElement>('#seek'); if (seek && document.activeElement !== seek) seek.value = String(position);
  const currentTime = document.querySelector('#current-time'); if (currentTime) currentTime.textContent = time(position);
  const cue = currentCue(position);
  audio.playbackRate = cueRate(prefs, cue?.character);
  if (cue && cue.lineId !== resumedLine) resumedLine = '';
  if (prefs.build && !audio.paused && !buildDone) {
    const targets = buildList();
    const end = buildEnd(targets, buildStep);
    if (end !== null && position >= end) {
      const start = (prefs.loopA && result?.cues.find(item => item.lineId === prefs.loopA)?.start) || 0;
      const next = buildNext(buildStep, buildPass, prefs.buildRepeats, targets.length);
      buildStep = next.step; buildPass = next.pass; buildDone = next.done;
      audio.currentTime = start;
      if (buildDone) audio.pause();
      resumedLine = ''; render();
      return;
    }
  }
  const range = !prefs.build && markedRange();
  if (range && position >= range.end) { audio.currentTime = range.start; return; }
  if (!audio.paused && !recorder?.recording && shouldWait(prefs, cue, resumedLine)) { waitingFor = cue!.lineId; audio.pause(); render(); return; }
  if ((cue?.lineId || '') !== activeLine) syncActiveLine(true);
  updatePlaybackStatus();
});
function syncActiveLine(follow: boolean) {
  const cue = currentCue();
  activeLine = cue?.lineId || '';
  let activeElement: HTMLElement | undefined;
  document.querySelectorAll<HTMLElement>('[data-line]').forEach(element => {
    const active = element.dataset.line === activeLine;
    element.classList.toggle('active', active);
    element.classList.toggle('practice-turn', active && prefs.mode === 'practice' && cue?.character === prefs.role);
    if (active) { element.setAttribute('aria-current', 'true'); activeElement = element; }
    else element.removeAttribute('aria-current');
  });
  if (!follow || !prefs.follow || !activeElement) return;
  const scroll = document.querySelector<HTMLElement>('.selftape-screen:not([hidden]) .script-paper-scroll') ?? document.querySelector<HTMLElement>('.script-paper-scroll');
  if (!scroll) return;
  const frame = scroll.getBoundingClientRect();
  const block = activeElement.getBoundingClientRect();
  // Center each new cue, not only cues that have already left the viewport.
  // For dialogue taller than the pane, keep its beginning visible instead.
  const inset = Math.max(36, (scroll.clientHeight - block.height) / 2);
  const desired = scroll.scrollTop + block.top - frame.top - scroll.clientTop - inset;
  const top = Math.max(0, Math.min(desired, scroll.scrollHeight - scroll.clientHeight));
  if (Math.abs(top - scroll.scrollTop) > 2) scroll.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
document.addEventListener('keydown', event => {
  const grip = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action="tape-drag"]');
  if (grip && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') prefs.tapeX = tapePercent(prefs.tapeX + (event.key === 'ArrowRight' ? step : -step), prefs.tapeX);
    else prefs.tapeY = tapePercent(prefs.tapeY + (event.key === 'ArrowDown' ? step : -step), prefs.tapeY);
    const overlay = grip.closest<HTMLElement>('.tape-overlay');
    if (overlay) { overlay.style.left = `${prefs.tapeX}%`; overlay.style.top = `${prefs.tapeY}%`; }
    persist();
    return;
  }
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !result) return;
  const target = event.target as HTMLElement | null;
  // Typing, a menu, a link or a button keeps its own keys. A dialog owns the keyboard while it is open.
  if (target?.closest('input, textarea, select, button, a, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  if (recorder?.recording) return;
  if (event.key === ' ') {
    event.preventDefault();
    if (waitingFor) releaseWait();
    else if (audio.paused) void audio.play().catch(error => flash(`Playback could not start: ${error.message}`, true));
    else audio.pause();
    render();
    return;
  }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const to = stepCue(result.cues, audio.currentTime, event.key === 'ArrowRight' ? 1 : -1);
  if (to === null) return;
  event.preventDefault(); waitingFor = ''; audio.currentTime = to; render();
});
// A take that runs to the end of the scene stops itself, so nothing records an empty room.
audio.addEventListener('ended', () => { if (recorder?.recording) void stopTake(); });
// Closing the tab or reloading gives the camera back without waiting for the page to die.
addEventListener('pagehide', () => { recorder?.release(); recorder = null; void stopVoiceRecording(true); });
audio.addEventListener('seeked', () => syncActiveLine(true));
audio.addEventListener('play', () => { stopVoicePreview(); syncActiveLine(true); void resumeMixer(); });
// A phone or tablet has no Space key, so the wording follows the kind of screen.
const touchFirst = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
function practiceHint(): string {
  if (waitingFor) return touchFirst() ? 'Waiting for you. Tap Continue when you have said your line.' : 'Waiting for you. Press Space or Continue when you have said your line.';
  if (prefs.build) {
    const targets = buildList();
    if (!result) return 'Build up needs the scene audio. Make it on this screen first.';
    if (!targets.length) return 'Build up starts once the scene has lines to learn.';
    if (buildDone) return `Whole scene learned, ${targets.length} of ${targets.length}. Press Start again to go round once more.`;
    return `Learning up to line ${buildStep + 1} of ${targets.length}, time ${buildPass} of ${prefs.buildRepeats}. It grows by one of your lines each time.`;
  }
  if (prefs.loopA && prefs.loopB) return prefs.loop ? 'Repeating the marked exchange.' : 'Marked. Press the loop button to repeat that exchange.';
  if (prefs.loopA || prefs.loopB) return `Play to the other end of the exchange, then press ${prefs.loopA ? 'B' : 'A'}.`;
  if (!result) return 'Make the audio to use these controls.';
  return touchFirst() ? 'Tap a line to play from it. The arrow buttons step one cue.' : 'Space plays and pauses. Left and right arrows step one cue.';
}
function updatePlaybackStatus() {
  const status = document.querySelector('#player-status');
  if (!status || !result) return;
  const cue = currentCue();
  status.textContent = recorder?.recording ? 'Recording a take. The scene plays by itself.' : waitingFor ? `Your turn. ${touchFirst() ? 'Tap' : 'Press Space or'} Continue when you are done` : audio.paused ? 'Ready to rehearse' : cue ? prefs.mode === 'practice' && cue.character === prefs.role ? 'Your turn — speak your line' : `${pretty(cue.character)} is speaking` : 'Ready for the next cue';
}
function updatePlayButton() {
  const button = document.querySelector('[data-action="play"]');
  if (button) {
    // While the scene waits for your line, the Play button says what it will do.
    button.classList.toggle('is-waiting', !!waitingFor);
    button.innerHTML = waitingFor ? `${icon('play', 17)}<span>Continue</span>` : icon(audio.paused ? 'play' : 'pause', 21);
    button.setAttribute('aria-label', waitingFor ? 'Continue after your line' : `${audio.paused ? 'Play' : 'Pause'} ${scene()?.id === 'full-script' ? 'full script' : 'scene'}`);
  }
  updatePlaybackStatus();
}
app.addEventListener('submit', event => { if ((event.target as HTMLElement).closest('.settings-form')) event.preventDefault(); });
audio.addEventListener('play', updatePlayButton); audio.addEventListener('pause', updatePlayButton); audio.addEventListener('ended', updatePlayButton);
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src') || !result) return;
  const failed = result;
  for (const [key, entry] of completedScenes) if (entry.fullUrl === failed.fullUrl || entry.practiceUrl === failed.practiceUrl) completedScenes.delete(key);
  invalidate(); persistRenders();
  flash('Audio could not load. Its ready badge has been cleared. Check the local server and reopen the project, or make the audio for this scene again.', true);
});
render(); void loadTools(); void openSession().then(() => loadSettings()).then(openLibrary).then(() => connect(true));
