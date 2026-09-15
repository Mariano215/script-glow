// Local project boundary: imported text and backups are untrusted; escape UI text,
// use server-issued UUID paths, retain recovery drafts, and never overwrite a
// newer preference revision. Completed audio is published by the local API only.
import './style.css';
import './screenplay.css';
import './casting.css';
import './projects.css';
import './studio.css';
import { highlightDefaults, readHighlights, highlightedCharacter, safeColor, type HighlightPreferences } from './highlights';
import { parseScript, SAMPLE, type Scene } from './parser';
import { inferCharacters, assignCast, resolvedGender, voiceGenders, voiceOwners, validGuesses, withNameGuesses, type NameGuesses, type GenderChoice } from './casting';
import { voiceCatalog } from './voice-catalog';
import { openHelp } from './help';

interface Cue { lineId: string; start: number; end: number; character: string }
interface RenderResult { fullUrl: string; practiceUrl: string; duration: number; cues: Cue[] }
interface Job { id: string; status: 'queued' | 'running' | 'complete' | 'error'; completed: number; total: number; error?: string; result?: RenderResult }
interface Preferences extends HighlightPreferences { source: string; name: string; role: string; cast: Record<string, string>; guesses: NameGuesses; genders: Record<string, GenderChoice>; manualVoices: Record<string, boolean>; sceneId: string; gap: number; directions: boolean; hide: boolean; follow: boolean; loop: boolean; rate: number; mode: 'full' | 'practice' }
const defaults: Preferences = { ...highlightDefaults, source: SAMPLE, name: 'The Last Light', role: 'MARCUS', cast: {}, guesses: {}, genders: {}, manualVoices: {}, sceneId: 'scene-1', gap: 1, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
function restored(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem('script-glow:v1') || '{}') as Partial<Preferences>;
    return { ...defaults, ...saved, ...readHighlights(saved), guesses: validGuesses(saved.guesses), source: typeof saved.source === 'string' ? saved.source : SAMPLE, cast: saved.cast && typeof saved.cast === 'object' ? saved.cast : {}, gap: Math.min(5, Math.max(0, Number(saved.gap ?? 1))), rate: [0.75, 1, 1.25, 1.5].includes(Number(saved.rate)) ? Number(saved.rate) : 1 };
  } catch { return { ...defaults }; }
}
let prefs = restored();
let parsed = parseScript(prefs.source);
let profiles = inferCharacters(prefs.source, parsed);
let voices: string[] = [];
let castingConfig = { preferredActorVoice: '', aliases: {} as Record<string, string>, previewUrl: '' };
let profileReady = false;
let screen: 'rehearsal' | 'cast' = location.hash === '#cast' ? 'cast' : 'rehearsal';
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
  const paths: Record<string, string> = { play: '<path d="m9 5 11 7-11 7Z"/>', pause: '<path d="M8 5v14M16 5v14"/>', upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>', download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>', edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>', chevron: '<path d="m9 5 7 7-7 7"/>', back: '<path d="M5 4v16m15-16L8 12l12 8Z"/>', loop: '<path d="m16 2 4 4-4 4M4 11V9a3 3 0 0 1 3-3h13M8 22l-4-4 4-4m12-1v2a3 3 0 0 1-3 3H4"/>', book: '<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15"/>', check: '<path d="m5 12 4 4L20 5"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', wave: '<path d="M3 10v4m4-8v12m5-16v20m5-16v12m4-8v4"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' };
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
      if (missing) { notice = `${missing} old cached render(s) could not be found. Your script is saved; render those scenes again.`; noticeError = true; }
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
      notice = missing ? `Project saved. ${missing} old cached render(s) are no longer available; render those scenes again.` : 'Existing script and available completed renders saved in your local project library.';
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
function renderInputs(current: Scene) {
  return { scene: current, ...(current.id === 'full-script' ? { scope: 'script' } : {}), voices: Object.fromEntries(Object.entries(prefs.cast).sort(([a], [b]) => a.localeCompare(b))), myCharacter: prefs.role, gapSeconds: prefs.gap, includeDirections: prefs.directions };
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
  if (busy()) { aiMessage = 'Finish rendering, then retry local AI name guesses.'; render(); return; }
  const source = prefs.source, epoch = aiEpoch;
  aiLoading = true; aiMessage = 'Local AI is guessing voice types from names… You can keep reading and choosing voices.'; render();
  let succeeded = false;
  try {
    const response = await api<{ guesses: { name: string; gender: string }[] }>('/api/casting/guess-genders', { method: 'POST', body: JSON.stringify({ names }), signal: AbortSignal.timeout(130000) });
    if (source !== prefs.source || epoch !== aiEpoch) return;
    if (!Array.isArray(response.guesses) || response.guesses.length !== names.length || new Set(response.guesses.map(item => item?.name)).size !== names.length || response.guesses.some(item => !item || !names.includes(item.name) || !['female', 'male', 'unknown'].includes(item.gender))) throw new Error('Local AI returned invalid guesses. Retry or choose voice types manually.');
    stagedGuesses = { ...stagedGuesses, ...validGuesses(Object.fromEntries(response.guesses.map(item => [item.name, item.gender]))) };
    aiMessage = 'AI name guesses are suggestions, not facts. Script cues and your choices take priority.';
    if (!result && !busy()) applyGuesses();
    else aiMessage += ' Apply suggestions to update automatic casting; changed voices require a new render.';
    succeeded = true;
  } catch (error) {
    if (source === prefs.source && epoch === aiEpoch) aiMessage = error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Local AI timed out. Retry or choose voice types manually.';
  } finally {
    aiLoading = false; render();
    if (source !== prefs.source || epoch !== aiEpoch || succeeded && missingGuesses().length) void guessNames();
  }
}
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body: unknown = await response.json();
  if (!response.ok) throw Object.assign(new Error(typeof body === 'object' && body && 'error' in body ? String(body.error) : `Request failed (${response.status})`), { status: response.status });
  return body as T;
}
function flash(message: string, error = false) { notice = message; noticeError = error; render(); }
function invalidate(restoreCompleted = false) {
  stopVoicePreview();
  generation++;
  audioLoadVersion++;
  if (busy() && job) void api(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' }).catch(() => {});
  job = null; result = null; loadedMode = null; audio.pause(); audio.removeAttribute('src'); audio.load(); activeLine = ''; revealed.clear();
  if (cacheSource !== prefs.source) { if (!projectId) completedScenes.clear(); cacheSource = prefs.source; persistRenders(); }
  const current = scene();
  if (restoreCompleted && current) {
    const key = JSON.stringify(renderInputs(current));
    const cached = completedScenes.get(key);
    if (cached) {
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
const voiceLabel = (id: string) => voiceCatalog[id]?.label || (id === castingConfig.preferredActorVoice ? `${id.replace(/[_-]/g, ' ')} · your voice` : id.replace(/[_-]/g, ' '));
const previewUrl = (id: string) => {
  if (id === castingConfig.preferredActorVoice && castingConfig.previewUrl === '/private-voice-preview.wav') return castingConfig.previewUrl;
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
  const failed = () => { if (version === previewVersion) stopVoicePreview('Preview unavailable. Refresh the app and try again; your rendered script is unchanged.'); };
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
      <select id="cast-${index}" data-cast="${esc(name)}" aria-label="Voice for ${esc(name)}" ${busy() || !voices.length ? 'disabled' : ''}>${voices.length ? sorted.map(voice => { const owners = voiceOwners(voice, name, castCharacters(), prefs.cast, castingConfig.aliases); return `<option value="${esc(voice)}" ${voice === selectedVoice ? 'selected' : owners.length ? 'disabled' : ''}>${esc(voiceLabel(voice))}${voiceGenders[voice] ? ` · ${voiceGenders[voice]}` : ''}${voiceCatalog[voice]?.accent ? ` · ${esc(voiceCatalog[voice].accent)}` : ''}${owners.length ? ` — Assigned to ${esc(owners.map(pretty).join(', '))}` : ''}</option>`; }).join('') : '<option>Engine unavailable</option>'}</select>
      <small class="casting-evidence" title="${esc(description)}">${esc(name === prefs.role ? 'Your chosen role' : choice === 'auto' && profile?.source === 'ai' ? gender === 'unknown' ? 'AI name guess inconclusive — choose above' : `AI name guess: ${gender} · override if needed` : choice === 'auto' && gender === 'unknown' ? 'Gender unclear — choose above' : choice === 'auto' ? `Script cue: ${gender}` : `${gender === 'unknown' ? 'Unspecified' : pretty(gender)} voice type override`)}${prefs.manualVoices[name] ? ' · voice picked manually' : ''}</small>
      ${selectedVoice && gender !== 'unknown' && voiceGenders[selectedVoice] !== gender ? `<small class="casting-conflict">This voice is ${esc(voiceGenders[selectedVoice] || 'not labeled')}, but the script suggests ${gender}.${!prefs.manualVoices[name] && name !== prefs.role ? ' No unused ' + gender + ' voice was left, so check this choice.' : ' Your choice is kept.'}</small>` : ''}
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
  settings.insertAdjacentHTML('beforeend', `<section class="settings-card highlight-card" aria-label="Script highlighter"><div class="card-heading"><h2>Mark your script</h2></div><label class="field-label" for="highlight-character">HIGHLIGHT CHARACTER</label><select id="highlight-character"><option value="@role" ${prefs.highlightCharacter === '@role' ? 'selected' : ''}>My role · ${esc(pretty(prefs.role))}</option><option value="" ${prefs.highlightCharacter === '' ? 'selected' : ''}>Off</option>${parsed.characters.map(name => `<option value="${esc(name)}" ${prefs.highlightCharacter === name ? 'selected' : ''}>${esc(pretty(name))}</option>`).join('')}</select><div class="highlight-colors"><label for="character-color"><input id="character-color" type="color" value="${safeColor(prefs.characterColor, highlightDefaults.characterColor)}"> Character lines</label><label for="spoken-color"><input id="spoken-color" type="color" value="${safeColor(prefs.spokenColor, highlightDefaults.spokenColor)}"> Playback line</label></div><p>Character marks stay visible. Playback uses its own color and marker. Colors save with this project.</p>${prefs.characterColor === prefs.spokenColor ? '<p class="highlight-warning">Same colors selected; the playback marker still identifies the current line.</p>' : ''}</section>`);
  document.querySelector('#my-role')!.parentElement!.insertAdjacentHTML('beforeend', '<a class="cast-shortcut" href="#cast">Configure cast & voices →</a>');
  const current = scene();
  const whole = current?.id === 'full-script';
  const selection = whole ? 'full script' : 'scene';
  document.querySelector('.section-label')!.insertAdjacentHTML('afterend', `<div class="scene-picker"><label for="scene-select">Choose what to play</label><select id="scene-select" ${!parsed.scenes.length ? 'disabled' : ''}><option value="full-script" ${whole ? 'selected' : ''}>Full script · ${parsed.scenes.length} scenes</option>${parsed.scenes.map((item, index) => `<option value="${esc(item.id)}" ${current?.id === item.id ? 'selected' : ''}>${index + 1}. ${esc(item.title)}</option>`).join('')}</select><small>${parsed.scenes.length} scenes available · choose any scene or all</small></div>`);
  document.querySelector('.cast-list')!.innerHTML = castMarkup();
  document.querySelector('.cast-list')!.insertAdjacentHTML('beforebegin', `<div class="ai-casting"><p id="ai-casting-status" role="status">${esc(aiMessage || 'Used voices are greyed out. Local AI suggests voice types when script cues are missing.')}</p>${Object.keys(stagedGuesses).length ? `<button type="button" data-action="apply-guesses" ${busy() || aiLoading ? 'disabled' : ''}>Apply AI voice suggestions</button>` : ''}${missingGuesses().length ? `<button type="button" data-action="guess-names" ${busy() || aiLoading ? 'disabled' : ''}>${aiLoading ? 'Guessing names…' : 'Retry AI name guesses'}</button>` : ''}</div>`);
  document.querySelector('.cast-card > p')!.textContent = `${voices.length} voices available · press Preview voice to hear one`;
  document.querySelector('.cast-list')!.insertAdjacentHTML('afterend', '<p class="voice-catalog-note">Accent labels describe references; delivery can vary.</p><p id="voice-preview-status" role="status" aria-live="polite"></p>');
  updatePreviewUI();
  document.querySelector('.scenes')!.insertAdjacentHTML('afterbegin', `<button class="scene-tab ${whole ? 'selected' : ''}" data-action="scope-script"><span class="scene-number">ALL</span><span><strong>Full script</strong><small>${parsed.scenes.length} scenes · ${parsed.scenes.reduce((n, item) => n + item.lines.filter(line => line.kind === 'dialogue').length, 0)} lines</small></span></button>`);
  document.querySelector('.project')!.insertAdjacentHTML('afterend', `<section class="project-library" aria-label="Saved projects"><h2>PROJECT LIBRARY</h2><button class="new-project-button" type="button" data-action="import" title="Import a script as a separate project" ${importing || busy() || libraryBusy || !libraryReady ? 'disabled' : ''}>${icon('upload', 16)} ${importing ? 'Importing…' : 'New project'}</button><label for="project-select">Open saved project</label><select id="project-select" ${libraryBusy || !libraryReady || busy() ? 'disabled' : ''}>${projectList.map(item => `<option value="${esc(item.id)}" ${item.id === projectId ? 'selected' : ''}>${esc(item.name)}</option>`).join('') || '<option>Opening library…</option>'}</select><p id="project-save-status" role="status" aria-live="polite"></p><div class="project-actions"><button type="button" data-action="retry-save" hidden>Retry save / connection</button><button type="button" data-action="recover-project" hidden>Save draft as new project</button><button type="button" data-action="backup-project" ${!libraryReady || libraryBusy || busy() ? 'disabled' : ''}>Export backup</button><button type="button" data-action="restore-project" ${!libraryReady || libraryBusy || busy() ? 'disabled' : ''}>Restore backup</button></div><small>Script + cast + settings + saved audio.<br>New project imports PDF, Fountain, or text.<br>Restore backup opens a .sgbackup file.</small></section>`);
  for (const item of parsed.scenes) {
    const saved = completedScenes.get(JSON.stringify(renderInputs(item)));
    const label = saved?.fullUrl.startsWith(`/api/projects/${projectId}/audio/`) ? 'Audio ready' : saved ? 'Audio ready (not saved)' : 'Audio not made yet';
    document.querySelector<HTMLElement>(`[data-action="scene"][data-id="${CSS.escape(item.id)}"] small`)?.insertAdjacentHTML('beforeend', `<span class="scene-save-badge ${saved ? 'is-rendered' : ''}">${label}</span>`);
    const option = document.querySelector<HTMLOptionElement>(`#scene-select option[value="${CSS.escape(item.id)}"]`);
    if (option) option.textContent += ` · ${label}`;
  }
  const allScene = { id: 'full-script', title: prefs.name, lines: parsed.scenes.flatMap(item => [{ id: `heading-${item.id}`, character: 'Narrator', text: item.title, kind: 'direction' as const, format: 'heading' as const }, ...item.lines]) };
  const allSaved = completedScenes.get(JSON.stringify(renderInputs(allScene)));
  document.querySelector('[data-action="scope-script"] small')?.insertAdjacentHTML('beforeend', `<span class="scene-save-badge ${allSaved ? 'is-rendered' : ''}">${allSaved?.fullUrl.startsWith(`/api/projects/${projectId}/audio/`) ? 'Audio ready' : allSaved ? 'Audio ready (not saved)' : 'Audio not made yet'}</span>`);
  updateSaveUI();
  const canGenerate = ttsOnline && voices.length > 0 && !!current?.lines.some(line => line.kind === 'dialogue');
  const button = document.querySelector<HTMLButtonElement>('[data-action="play"]')!;
  button.disabled = busy() || (!result && (!canGenerate || aiLoading));
  button.setAttribute('aria-label', result ? `${audio.paused ? 'Play' : 'Pause'} ${selection}` : busy() ? `Rendering ${selection}` : `Make audio and play ${selection}`);
  button.title = result ? `${audio.paused ? 'Play' : 'Pause'} ${selection}` : `Make the audio for this ${selection}, then play`;
  const status = document.querySelector('#player-status')!;
  if (!result) status.textContent = busy() ? `Making audio: ${job?.completed || 0} of ${job?.total || 0} lines` : canGenerate ? 'Press Play to make the audio and listen' : 'Voices are not connected yet';
  document.querySelector('.render-hint')!.textContent = 'Makes two tracks: the whole cast, and one with silence for your lines.';
  document.querySelector('[data-action="render"]')!.innerHTML = `${icon('wave', 17)} ${busy() ? 'Making audio…' : result ? 'Make audio again' : 'Make audio'}`;
  if (aiLoading) {
    document.querySelector<HTMLButtonElement>('[data-action="render"]')!.disabled = true;
    document.querySelector('.render-hint')!.textContent = 'Local AI is checking names. Rendering is available when it finishes; existing audio still plays.';
    if (!result) status.textContent = 'Checking character names with local AI…';
  }
  if (libraryBusy || !libraryReady) document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('.settings-panel button, .settings-panel input, .settings-panel select, .cast-screen button, .cast-screen select, [data-action="render"], [data-action="import"], [data-action="edit"], #scene-select').forEach(control => { control.disabled = true; });
  const paper = document.querySelector<HTMLElement>('.script-page')!;
  paper.style.setProperty('--character-color', safeColor(prefs.characterColor, highlightDefaults.characterColor));
  paper.style.setProperty('--spoken-color', safeColor(prefs.spokenColor, highlightDefaults.spokenColor));
  paper.querySelector('.script-meta > span:last-child')?.remove();
  if (whole) document.querySelector('.script-toolbar > div')!.textContent = `FULL SCRIPT · ${parsed.scenes.length} SCENES`;
  const scroll = document.createElement('div'); scroll.className = 'script-paper-scroll'; paper.before(scroll); scroll.append(paper);
  scroll.insertAdjacentHTML('beforebegin', `<div class="reading-controls"><label><input type="checkbox" id="follow-playback" ${prefs.follow ? 'checked' : ''}> Auto-follow spoken line</label><span>Solid outline: line playing now · Dashed outline: your line</span></div>`);
  paper.querySelectorAll('.character-label span').forEach(element => element.remove());
  if (whole) paper.querySelector(':scope > h2')?.remove();
  const renderedLines = new Map([...paper.querySelectorAll<HTMLElement>('[data-line]')].map(node => [node.dataset.line, node]));
  for (const line of current?.lines || []) {
    const element = renderedLines.get(line.id);
    if (line.format === 'parenthetical' && element) {
      element.classList.add('parenthetical'); element.textContent = `(${line.text})`;
      const next = current?.lines[(current?.lines.indexOf(line) || 0) + 1];
      const dialogue = next?.kind === 'dialogue' ? renderedLines.get(next.id) : undefined;
      if (dialogue) dialogue.insertBefore(element, dialogue.querySelector(':scope > p'));
    }
    if (line.format === 'heading' && element) { const heading = document.createElement('h2'); heading.className = 'script-scene-heading'; heading.textContent = line.text; heading.dataset.line = line.id; element.replaceWith(heading); }
  }
  const footer = document.querySelector('.script-footer > span'); if (footer) footer.textContent = '12 pt Courier · Character marks + separate playback highlight';
  applyScreen();
}
function applyScreen(focus = false) {
  const cast = screen === 'cast';
  document.querySelector<HTMLElement>('.workspace-grid')!.hidden = cast;
  document.querySelector<HTMLElement>('.cast-screen')!.hidden = !cast;
  document.querySelectorAll<HTMLAnchorElement>('[data-screen]').forEach(link => {
    if (link.dataset.screen === screen) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const heading = document.querySelector<HTMLElement>('#screen-title')!;
  heading.textContent = cast ? 'Meet your cast.' : 'Make the scene yours.';
  heading.nextElementSibling!.textContent = cast ? 'Choose your character. Audition voices. Make every part distinct.' : 'Find your rhythm. Learn your lines. Be ready when it counts.';
  if (focus) { heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }
}
window.addEventListener('hashchange', () => {
  screen = location.hash === '#cast' ? 'cast' : 'rehearsal';
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
      <a class="brand" href="#" aria-label="Script Glow home"><img class="brand-mark" src="/brand/script-glow-mark-v2.png" alt="" width="40" height="40"> script<span>glow</span><small>REHEARSAL STUDIO</small></a>
      <div class="sidebar-heading">YOUR WORKSPACE <span>01</span></div>
      <div class="project"><span class="project-icon">${icon('book')}</span><div><strong>${esc(prefs.name)}</strong><small>${parsed.scenes.length} scenes · ${parsed.characters.length} characters</small></div></div>
      <div class="section-label">SCENES <span>${String(parsed.scenes.length).padStart(2, '0')}</span></div>
      <nav class="scenes">${parsed.scenes.map((item, index) => `<button class="scene-tab ${current?.id === item.id ? 'selected' : ''}" data-action="scene" data-id="${esc(item.id)}"><span class="scene-number">${String(index + 1).padStart(2, '0')}</span><span><strong>${esc(pretty(item.title.replace(/^(INT\.?|EXT\.?)\s*/i, '')))}</strong><small>${item.lines.filter(line => line.kind === 'dialogue').length} dialogue lines</small></span>${current?.id === item.id ? '<span class="scene-dot"></span>' : ''}</button>`).join('')}</nav>
      <div class="sidebar-bottom"><div class="local-badge"><span class="status-dot ${ttsOnline ? 'online' : ''}"></span> ${connectionChecked ? ttsOnline ? 'Voices connected' : 'Voices not connected' : 'Checking voices…'}</div><p>Your words stay yours.<br>Scripts & audio stay local.</p><button class="text-link" data-action="reconnect">Check connection ${icon('chevron', 12)}</button></div>
    </aside>
    <main class="main">
      <header class="topbar"><nav class="studio-menu" aria-label="Studio screens"><a href="#rehearsal" data-screen="rehearsal">Rehearsal</a><a href="#cast" data-screen="cast">Cast <span>${parsed.characters.length}</span></a></nav><div class="breadcrumb">Workspace <span>/</span> ${esc(prefs.name)}</div><button type="button" class="help-button" data-action="help" aria-haspopup="dialog">? Help</button><div class="private-pill"><span></span> PRIVATE STUDIO</div></header>
      <section class="page-heading"><div><p class="eyebrow">A LITTLE PRACTICE. A BETTER PERFORMANCE.</p><h1 id="screen-title" tabindex="-1">Make the scene yours<span>.</span></h1><p>Find your rhythm. Learn your lines. Be ready when it counts.</p></div><button class="button secondary" data-action="edit">${icon('edit', 17)} Edit script</button></section>
      ${notice ? `<div class="notice ${noticeError ? 'error' : ''}" role="${noticeError ? 'alert' : 'status'}"><span>${esc(notice)}</span><button data-action="dismiss" aria-label="Dismiss notification">${icon('close', 16)}</button></div>` : ''}
      ${connectionChecked && !ttsOnline ? `<div class="notice error voices-offline" role="status"><span><strong>Voices are not connected.</strong> Script Glow cannot make audio until its voice service is running.</span><span class="notice-actions"><button type="button" data-action="reconnect">Check again</button><button type="button" data-action="help">How to fix</button></span></div>` : ''}
      ${parsed.warnings.map(warning => `<div class="notice" role="status">${esc(warning)}</div>`).join('')}
      <div class="workspace-grid">
        <section class="script-panel" aria-label="Script scene"><div class="script-toolbar"><div><span class="live-dot"></span> ${String(parsed.scenes.indexOf(current!) + 1).padStart(2, '0')} <span class="muted">/ ${String(parsed.scenes.length).padStart(2, '0')}</span><span class="toolbar-divider"></span><span>THE SCRIPT</span></div><label class="hide-control">${icon('eye', 16)} Hide my lines <input type="checkbox" id="hide-lines" ${prefs.hide ? 'checked' : ''}><span class="switch"></span></label></div>
          <div class="script-page" id="script-page"><div class="script-meta"><span>${esc(prefs.name.toUpperCase())}</span><span>${String(parsed.scenes.indexOf(current!) + 1).padStart(2, '0')}</span></div><h2>${esc(current?.title || 'Your next scene starts here')}</h2><div class="scene-rule"></div>
            ${current?.lines.map(line => line.kind === 'direction' ? `<p class="direction ${line.id === activeLine ? 'active' : ''}" data-line="${esc(line.id)}">${esc(line.text)}</p>` : `<article class="dialogue ${line.character === prefs.role ? 'my-line' : ''} ${line.character === highlightedCharacter(prefs, prefs.role) ? 'character-highlight' : ''} ${line.id === activeLine ? 'active' : ''}" data-line="${esc(line.id)}"><div class="character-label">${esc(line.character)} ${line.character === prefs.role ? '<span>YOU</span>' : ''}</div>${prefs.hide && line.character === prefs.role && !revealed.has(line.id) ? `<button class="hidden-line" data-action="reveal" data-id="${esc(line.id)}" aria-label="Reveal your line"><span class="hidden-stroke"></span><span class="hidden-stroke short"></span><small>Click to reveal your line</small></button>` : `<p>${esc(line.text)}</p>`}</article>`).join('') || '<p class="empty-copy">Import a script or open the editor to begin.</p>'}
            <div class="end-scene"><span></span> END OF SCENE <span></span></div>
          </div><div class="script-footer"><span><span class="role-dot"></span> Your lines in sage</span><span>${dialogue.length} lines <span class="muted">·</span> ${mine} yours</span></div>
        </section>
        <aside class="settings-panel" aria-label="Rehearsal settings"><section class="settings-card"><div class="card-heading"><h2>Your part</h2><span class="mini-label">01</span></div><p>Step into your character.</p><label class="field-label" for="my-role">I’M PLAYING</label><select id="my-role" ${!parsed.characters.length || busy() ? 'disabled' : ''}>${parsed.characters.map(name => `<option value="${esc(name)}" ${prefs.role === name ? 'selected' : ''}>${esc(pretty(name))}</option>`).join('')}</select><div class="voice-note"><span class="avatar">${esc(prefs.role.slice(0, 1) || 'M')}</span><div><strong>${esc(prefs.cast[prefs.role] ? voiceLabel(prefs.cast[prefs.role]) : 'No voice connected')}</strong><small>${prefs.cast[prefs.role] === castingConfig.preferredActorVoice ? 'Your local cloned voice' : 'Assigned character voice'}</small></div>${prefs.cast[prefs.role] === castingConfig.preferredActorVoice ? icon('check', 16) : ''}</div></section>
          <section class="settings-card cast-card"><div class="card-heading"><h2>The cast</h2><span class="cast-count">${parsed.characters.length}</span></div><p>A voice for every character.</p><div class="cast-list"></div></section>
          <section class="settings-card render-card"><div class="card-heading"><h2>Set the pace</h2>${icon('wave', 19)}</div><label class="gap-label" for="line-gap">Pause between lines <strong id="gap-value">${prefs.gap.toFixed(1)}s</strong></label><input type="range" id="line-gap" min="0" max="5" step="0.5" value="${prefs.gap}" ${busy() ? 'disabled' : ''}><div class="range-labels"><span>Natural</span><span>Take your time</span></div><label class="checkbox-label"><input type="checkbox" id="directions" ${prefs.directions ? 'checked' : ''} ${busy() ? 'disabled' : ''}> Read stage directions</label>
          <button class="button primary render-button" data-action="render" ${busy() || !ttsOnline || !dialogue.length || !voices.length ? 'disabled' : ''}>${icon('wave', 17)} ${busy() ? 'Creating your scene…' : result ? 'Render scene again' : 'Render scene'} ${!busy() ? '<span>↗</span>' : ''}</button><p class="render-hint">Two tracks. Full cast + space for you.</p>
          <div id="job-progress" role="status" aria-live="polite">${job ? progressMarkup() : ''}</div></section>
          <div class="practice-tip"><span>✦</span><p><strong>Leave a little room for yourself.</strong> Practice mode silences your character, keeping every cue right on time.</p></div>
        </aside>
      </div>
      <footer class="page-footer"><span>MADE FOR THE MOMENT BEFORE “ACTION.”</span><span>LOCAL VOICES. YOUR STORY.</span></footer>
    </main>
    <section class="player" aria-label="Scene audio player"><div class="player-scene"><span class="player-art">${icon('wave', 23)}</span><div><strong>${esc(current ? pretty(current.title.replace(/^(INT\.?|EXT\.?)\s*/i, '')) : 'No scene selected')}</strong><small id="player-status">${result ? 'Ready to rehearse' : busy() ? 'Rendering local voices…' : 'Render your scene to start listening'}</small></div></div><div class="playback"><div class="playback-actions"><button class="icon-button" data-action="restart" aria-label="Restart scene" ${!result ? 'disabled' : ''}>${icon('back', 17)}</button><button class="play-button" data-action="play" aria-label="${audio.paused ? 'Play' : 'Pause'} scene" ${!result ? 'disabled' : ''}>${icon(audio.paused ? 'play' : 'pause', 21)}</button><button class="icon-button ${prefs.loop ? 'enabled' : ''}" data-action="loop" aria-label="Loop scene" aria-pressed="${prefs.loop}">${icon('loop', 17)}</button><select id="playback-rate" aria-label="Playback speed">${[0.75, 1, 1.25, 1.5].map(rate => `<option value="${rate}" ${rate === prefs.rate ? 'selected' : ''}>${rate}×</option>`).join('')}</select></div><div class="seek-row"><span id="current-time">${time(audio.currentTime)}</span><input id="seek" type="range" aria-label="Seek audio" min="0" max="${result?.duration || 1}" step="0.05" value="${audio.currentTime || 0}" ${!result ? 'disabled' : ''}><span id="duration">${time(result?.duration || 0)}</span></div></div><div class="player-right"><div class="mode-switch" role="group" aria-label="Rehearsal mode"><button data-action="mode-full" class="${prefs.mode === 'full' ? 'selected' : ''}" aria-pressed="${prefs.mode === 'full'}">Full cast</button><button data-action="mode-practice" class="${prefs.mode === 'practice' ? 'selected' : ''}" aria-pressed="${prefs.mode === 'practice'}">Practice <span>YOU’RE UP</span></button></div><div class="downloads">${result ? `<a href="${esc(result.fullUrl)}" download="${esc(prefs.name)}-full.wav">${icon('download', 13)} Full cast</a><a href="${esc(result.practiceUrl)}" download="${esc(prefs.name)}-practice.wav">${icon('download', 13)} Practice</a>` : '<span>Downloads appear after the audio is made</span>'}</div></div></section>
  </div>`;
  finishRenderUI();
  document.querySelector('.script-paper-scroll')?.scrollTo({ top: scrollTop, left: scrollLeft, behavior: 'instant' });
  document.querySelector('.scenes')?.scrollTo({ left: navLeft, behavior: 'instant' });
  document.querySelector('.sidebar')?.scrollTo({ top: sidebarTop, behavior: 'instant' });
  syncActiveLine(!audio.paused);
  updatePlaybackStatus();
  audio.loop = prefs.loop; audio.playbackRate = prefs.rate;
  const replacement = focusSelector ? app.querySelector<HTMLElement>(focusSelector) : null;
  if (replacement?.getClientRects().length && !replacement.matches(':disabled')) replacement.focus({ preventScroll: true });
}
function progressMarkup() {
  if (!job) return '';
  if (job.status === 'error') return `<div class="job-error">${esc(job.error || 'Render failed. Check the local engine and try again.')}</div>`;
  if (job.status === 'complete') return `<div class="job-complete">${icon('check', 14)} Both tracks ready · ${time(result?.duration || 0)}</div>`;
  return `<div class="job-label"><span>${job.status === 'queued' ? 'Queued for the local GPU' : `${job.completed} of ${job.total} lines generated`}</span><button data-action="cancel">Cancel</button></div><progress max="${job.total || 1}" value="${job.completed}"></progress><small class="cold-start">First render may take a few minutes.</small>`;
}
async function connect(restoreOnStartup = false) {
  const responses = await Promise.allSettled([api<{ tts: { ok: boolean } }>('/api/health'), api<{ voices: string[] }>('/api/voices'), api<{ casting: typeof castingConfig }>('/api/connections')]);
  profileReady = responses[2].status === 'fulfilled';
  if (responses[2].status === 'fulfilled') castingConfig = { ...castingConfig, ...responses[2].value.casting };
  else { notice = 'Connection profile unavailable. Existing voice assignments are preserved. Check connection before automatic casting.'; noticeError = true; }
  connectionChecked = true;
  ttsOnline = responses[0].status === 'fulfilled' && responses[0].value.tts.ok;
  voices = responses[1].status === 'fulfilled' ? responses[1].value.voices : [];
  const previousCast = JSON.stringify(prefs.cast);
  castDefaults();
  if (previousCast !== JSON.stringify(prefs.cast) || restoreOnStartup && generation === 0 && !result && !busy()) invalidate(true);
  persist(); render(); void guessNames();
}
async function renderScene(playWhenReady = false) {
  const startingProject = projectId;
  if (aiLoading) { flash('Local AI is checking names. Render when it finishes.'); return; }
  if (libraryBusy || !await saveProjectNow()) { flash(saveError || libraryError || 'Save the project before rendering.', true); return; }
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
        if (!update.result) throw new Error('The engine finished without returning audio. Try rendering again.');
        result = update.result;
        completedScenes.delete(cacheKey); completedScenes.set(cacheKey, result);
        persistRenders();
        void refreshProjectList().catch(() => {});
        loadAudio(0, playWhenReady); render(); return;
      }
      if (update.status === 'error') { render(); return; }
      const progress = document.querySelector('#job-progress'); if (progress) progress.innerHTML = progressMarkup();
      const status = document.querySelector('#player-status'); if (status) status.textContent = `Rendering ${current.id === 'full-script' ? 'full script' : 'scene'}: ${job.completed}/${job.total} lines`;
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  } catch (error) { if (token === generation) { job = { ...job!, status: 'error', error: error instanceof Error ? error.message : 'Render failed' }; render(); } }
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
  const dialog = document.createElement('dialog'); dialog.className = 'editor-dialog';
  dialog.innerHTML = `<form method="dialog"><div class="editor-heading"><div><p class="eyebrow">SCRIPT WORKSHOP</p><h2>Get every line in place.</h2></div><button value="cancel" class="icon-button" aria-label="Close script editor">${icon('close')}</button></div><label class="field-label" for="script-name">PROJECT TITLE</label><input id="script-name" maxlength="100" value="${esc(prefs.name)}"><label class="field-label" for="script-source">SCRIPT SOURCE</label><p class="editor-help">Use INT./EXT. headings, uppercase character names above dialogue, or NAME: dialogue. Blank lines separate dialogue from action. Text PDFs only; scanned pages need OCR first.</p><textarea id="script-source" spellcheck="false">${esc(prefs.source)}</textarea><div id="parse-preview" class="parse-preview"></div><div class="editor-actions"><button type="button" class="text-link" id="export-source">Export source</button><button class="button secondary" value="cancel">Cancel</button><button type="button" id="save-script" class="button primary">Save script</button></div></form>`;
  document.body.append(dialog);
  const source = dialog.querySelector<HTMLTextAreaElement>('#script-source')!;
  dialog.querySelector('.editor-help')!.textContent = 'Scenes need their own heading line: INT./EXT., numbered shooting headings, SCENE 1, or a Fountain heading such as .THE GARDEN. For unrecognized scene breaks, insert # Scene title above each scene. The preview below shows the detected count before saving. Blank lines separate dialogue from action. Scanned PDFs need OCR first.';
  const preview = () => { const draft = parseScript(source.value); dialog.querySelector('#parse-preview')!.textContent = `${draft.scenes.length} scenes · ${draft.characters.length} characters · ${draft.scenes.reduce((sum, item) => sum + item.lines.filter(line => line.kind === 'dialogue').length, 0)} dialogue lines${draft.warnings.length ? ` — ${draft.warnings.join(' ')}` : ` · Cast: ${draft.characters.join(', ')}`}`; };
  source.addEventListener('input', preview); preview();
  dialog.querySelector('#save-script')!.addEventListener('click', () => { if (!mayCancelRender()) return; prefs.source = source.value; prefs.name = dialog.querySelector<HTMLInputElement>('#script-name')!.value.trim() || 'Untitled script'; parsed = parseScript(prefs.source); prefs.sceneId = parsed.scenes[0]?.id || ''; castDefaults(); invalidate(); notice = 'Script saved. Review the cast, then render your scene.'; noticeError = false; dialog.close(); render(); void guessNames(); });
  dialog.querySelector('#export-source')!.addEventListener('click', () => { const url = URL.createObjectURL(new Blob([source.value], { type: 'text/plain' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${prefs.name}.fountain`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
}
app.addEventListener('click', async event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]'); if (!target) return;
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
  if (action === 'loop') { prefs.loop = !prefs.loop; audio.loop = prefs.loop; persist(); }
  if (action === 'restart') audio.currentTime = 0;
  if (action === 'play') { if (!result) { if (!busy()) void renderScene(true); return; } if (loadedMode !== prefs.mode) loadAudio(audio.currentTime, true); else if (audio.paused) await audio.play().catch(error => flash(`Playback could not start: ${error.message}`, true)); else audio.pause(); }
  if (action === 'mode-full' || action === 'mode-practice') { const position = audio.currentTime; const resume = !audio.paused; prefs.mode = action === 'mode-full' ? 'full' : 'practice'; persist(); if (result && loadedMode !== prefs.mode) loadAudio(position, resume); }
  if (action === 'cancel') { invalidate(); notice = 'Render canceled. You can make changes and try again.'; }
  render();
});
app.addEventListener('input', event => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'seek' && result) audio.currentTime = Number(target.value);
  if (target.id === 'line-gap') { const label = document.querySelector('#gap-value'); if (label) label.textContent = `${Number(target.value).toFixed(1)}s`; }
});
app.addEventListener('change', async event => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'project-select') { await switchProject(target.value); return; }
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
  if (target.id === 'playback-rate') { prefs.rate = Number(target.value); audio.playbackRate = prefs.rate; persist(); }
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
  const nextLine = result?.cues.find(item => position >= item.start && position < item.end)?.lineId || '';
  if (nextLine !== activeLine) syncActiveLine(true);
  updatePlaybackStatus();
});
function syncActiveLine(follow: boolean) {
  const cue = result?.cues.find(item => audio.currentTime >= item.start && audio.currentTime < item.end);
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
  const scroll = document.querySelector<HTMLElement>('.script-paper-scroll');
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
audio.addEventListener('seeked', () => syncActiveLine(true));
audio.addEventListener('play', () => { stopVoicePreview(); syncActiveLine(true); });
function updatePlaybackStatus() {
  const status = document.querySelector('#player-status');
  if (!status || !result) return;
  const cue = result.cues.find(item => audio.currentTime >= item.start && audio.currentTime < item.end);
  status.textContent = audio.paused ? 'Ready to rehearse' : cue ? prefs.mode === 'practice' && cue.character === prefs.role ? 'Your turn — speak your line' : `${pretty(cue.character)} is speaking` : 'Ready for the next cue';
}
function updatePlayButton() { const button = document.querySelector('[data-action="play"]'); if (button) { button.innerHTML = icon(audio.paused ? 'play' : 'pause', 21); button.setAttribute('aria-label', `${audio.paused ? 'Play' : 'Pause'} ${scene()?.id === 'full-script' ? 'full script' : 'scene'}`); } updatePlaybackStatus(); }
audio.addEventListener('play', updatePlayButton); audio.addEventListener('pause', updatePlayButton); audio.addEventListener('ended', updatePlayButton);
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src') || !result) return;
  const failed = result;
  for (const [key, entry] of completedScenes) if (entry.fullUrl === failed.fullUrl || entry.practiceUrl === failed.practiceUrl) completedScenes.delete(key);
  invalidate(); persistRenders();
  flash('Audio could not load. Its ready badge has been cleared. Check the local server and reopen the project, or render this scene again.', true);
});
render(); void openLibrary().then(() => connect(true));
