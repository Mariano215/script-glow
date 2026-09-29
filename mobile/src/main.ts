import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { cueAt, cueRate, firstLetters, shouldWait, stepCue } from '../../src/playback.ts';
import { keepAwake, prepareListening, releaseMicrophone, startListening, stopListening } from '../../src/listening.ts';
import { highlightDefaults, safeColor } from '../../src/highlights.ts';
import { readBackup, sceneTracks, type SceneTrack } from './backup.ts';
import { audioSize, getAudio, listProjects, pick, removeProject, saveBackup, savePrefs, type Rehearsal, type Saved } from './store.ts';
import nightDana from '../samples/night-shift-dana.sgbackup?url';
import nightMichael from '../samples/night-shift-michael.sgbackup?url';
import tableClaire from '../samples/wrong-table-claire.sgbackup?url';
import tableBen from '../samples/wrong-table-ben.sgbackup?url';
import './style.css';

// Two short scenes ship with the app, each rendered once per role, so a new actor can rehearse
// before they have a Mac project of their own. Stock voices only. Sources: mobile/samples/*.fountain.
const SAMPLES = [
  { title: 'Night Shift', blurb: 'Drama. An ER nurse and the brother who stayed away.', roles: [['Dana', nightDana], ['Michael', nightMichael]] },
  { title: 'Wrong Table', blurb: 'Comedy. A blind date walks into a job interview.', roles: [['Claire', tableClaire], ['Ben', tableBen]] },
];

type View = { name: 'home' } | { name: 'project'; id: string } | { name: 'scene'; id: string; key: string };
const app = document.querySelector<HTMLDivElement>('#app')!;
const audio = document.querySelector<HTMLAudioElement>('#audio')!;
const settings = document.querySelector<HTMLDialogElement>('#settings')!;
const appSettings = document.querySelector<HTMLDialogElement>('#app-settings')!;
let projects: Saved[] = [];
let view: View = { name: 'home' };
let busy = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

// The scene on the stand. Same names as the desktop player (src/main.ts) so the two read alike.
let saved: Saved | undefined;
let track: SceneTrack | undefined;
let loadedMode: string | null = null;
let audioUrl = '';
let waitingFor = '';
let resumedLine = '';
let listening = false;
// A microphone that failed once in this scene is not asked again until the scene is reopened or the
// option is chosen again. The saved choice stays: a first-time permission prompt can fail the first
// request even when the actor then allows it, and that must not quietly switch the option off.
let micFailed = false;
let activeLine = '';
// Seconds left before Play starts the scene (Settings > Countdown). Nought when no countdown runs.
let countLeft = 0;
let countTimer: ReturnType<typeof setInterval> | undefined;
const revealed = new Set<string>();

const esc = (text: string) => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const pretty = (name: string) => name.charAt(0) + name.slice(1).toLowerCase();
const icons: Record<string, string> = {
  back: '<path d="M15 5l-7 7 7 7"/>', sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  prev: '<path d="M6 5v14M19 5l-9 7 9 7z"/>', next: '<path d="M18 5v14M5 5l9 7-9 7z"/>', play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
  loop: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
};
const icon = (name: string, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

function toast(message: string) {
  const box = document.querySelector<HTMLDivElement>('#toast')!;
  box.textContent = message; box.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
}

// ---- Phone settings ----
// One set for every project, kept on this phone only (the rehearsal sheet is per project).
// localStorage can throw or come back empty (cleared site data); the defaults cover both.
const SIZES = [15, 17, 20, 24];
const PHONE = { mine: highlightDefaults.characterColor, spoken: highlightDefaults.spokenColor, size: 17, theme: 'system', directions: true, awake: true, countdown: 0, defaults: null as Rehearsal | null };
type Phone = typeof PHONE;
let phone: Phone = { ...PHONE };
try {
  const raw = JSON.parse(localStorage.getItem('phone') ?? '{}');
  phone = {
    mine: safeColor(raw.mine, PHONE.mine), spoken: safeColor(raw.spoken, PHONE.spoken),
    size: SIZES.includes(raw.size) ? raw.size : PHONE.size,
    theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : PHONE.theme,
    directions: typeof raw.directions === 'boolean' ? raw.directions : PHONE.directions,
    awake: typeof raw.awake === 'boolean' ? raw.awake : PHONE.awake,
    countdown: [0, 3, 5].includes(raw.countdown) ? raw.countdown : PHONE.countdown,
    defaults: raw.defaults && typeof raw.defaults === 'object' ? pick(raw.defaults) : null,
  };
} catch { /* defaults */ }

// The tint is the color with an alpha byte (2e, about 18%), so any pick reads on light and dark paper.
function applyPhone() {
  const root = document.documentElement;
  root.style.setProperty('--mine-color', phone.mine); root.style.setProperty('--mine-bg', `${phone.mine}2e`);
  root.style.setProperty('--spoken-color', phone.spoken); root.style.setProperty('--spoken-bg', `${phone.spoken}2e`);
  root.style.setProperty('--script-size', `${phone.size}px`);
  if (phone.theme === 'system') delete root.dataset.theme; else root.dataset.theme = phone.theme;
  keepAwake(phone.awake && (!audio.paused || !!waitingFor));
  try { localStorage.setItem('phone', JSON.stringify(phone)); } catch { /* still applies for this session */ }
}

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
async function fillPhone() {
  const field = <T extends HTMLElement = HTMLInputElement>(name: string) => appSettings.querySelector<T>(`[name="${name}"]`)!;
  field('mine').value = phone.mine; field('spoken').value = phone.spoken;
  field<HTMLSelectElement>('size').value = String(phone.size); field<HTMLSelectElement>('theme').value = phone.theme;
  field<HTMLSelectElement>('countdown').value = String(phone.countdown);
  field('directions').checked = phone.directions; field('awake').checked = phone.awake;
  appSettings.querySelector('#defaults-note')!.textContent = phone.defaults ? 'Your saved setup' : 'The settings sent from your computer';
  appSettings.querySelector<HTMLButtonElement>('[data-forget]')!.hidden = !phone.defaults;
  const sizes = await Promise.all(projects.map(item => audioSize(item.project.id)));
  appSettings.querySelector('#storage')!.innerHTML = projects.map((item, index) => `<div class="row"><span><strong>${esc(item.prefs.name)}</strong><small>${megabytes(sizes[index])}</small></span><button class="small-remove" data-remove="${esc(item.project.id)}">Remove</button></div>`).join('')
    || '<div class="row"><span><small>No projects on this phone yet.</small></span></div>';
}
function openPhone() { void fillPhone(); appSettings.showModal(); }

// Both events: a color picker sends input as it moves, some web views send only change for a select.
function onPhoneSetting(event: Event) {
  const target = event.target as HTMLInputElement;
  const name = target.name;
  if (name === 'mine' || name === 'spoken') phone[name] = safeColor(target.value, PHONE[name]);
  else if (name === 'size' || name === 'countdown') phone[name] = Number(target.value);
  else if (name === 'theme') phone.theme = target.value;
  else if (name === 'directions' || name === 'awake') phone[name] = target.checked;
  else return;
  applyPhone();
  if (name === 'directions' && view.name === 'scene') render();
}
appSettings.addEventListener('input', onPhoneSetting);
appSettings.addEventListener('change', onPhoneSetting);
appSettings.addEventListener('click', async event => {
  const target = event.target as HTMLElement;
  if (target.closest('[data-reset]')) { phone.mine = PHONE.mine; phone.spoken = PHONE.spoken; applyPhone(); void fillPhone(); }
  if (target.closest('[data-forget]')) { phone.defaults = null; applyPhone(); void fillPhone(); }
  const remove = target.closest<HTMLElement>('[data-remove]');
  if (remove && await removeFromPhone(remove.dataset.remove!)) void fillPhone();
});

async function removeFromPhone(id: string) {
  if (!confirm('Remove this project and its audio from the phone? Your computer keeps its copy.')) return false;
  if (saved?.project.id === id && view.name === 'scene') leaveScene();
  await removeProject(id); projects = await listProjects();
  if (view.name !== 'home' && view.id === id) view = { name: 'home' };
  render(); return true;
}

// ---- Getting a project onto the phone ----

async function importBuffer(buffer: ArrayBuffer) {
  busy = true; render();
  try {
    const backup = await readBackup(buffer);
    if (!backup.project.renders.length) throw new Error('This project has no audio yet. Press Play in Script Glow on your computer to make it, then back it up again.');
    const previous = projects.find(item => item.project.id === backup.project.id);
    await saveBackup(backup, previous, phone.defaults);
    projects = await listProjects();
    view = { name: 'project', id: backup.project.id };
    toast(previous ? `${backup.project.preferences.name} updated.` : `${backup.project.preferences.name} added.`);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'That file could not be opened.');
  }
  busy = false; render();
}

// AirDrop and "Open in" hand iOS a copy in Documents/Inbox. Read it, then delete that copy,
// because a scene is tens of megabytes and the Inbox is never cleared by iOS.
async function openUrl(url: string) {
  if (!url.startsWith('file:')) return;
  try {
    const response = await fetch(Capacitor.convertFileSrc(url));
    await importBuffer(await response.arrayBuffer());
  } catch { toast('That file could not be opened.'); }
  void Filesystem.deleteFile({ path: url }).catch(() => {});
}

// ---- Player ----

const prefs = () => saved!.prefs;
const persist = () => { if (saved) void savePrefs(saved); };
const mine = (character: string) => character === prefs().role;

async function load(at: number, play: boolean) {
  if (!saved || !track) return;
  const mode = prefs().mode;
  const blob = await getAudio(saved.project.id, mode === 'practice' ? track.practice : track.full);
  if (!blob) { toast('This scene\'s audio is missing. Send the project again from your computer.'); return; }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(blob);
  audio.src = audioUrl; loadedMode = mode; audio.loop = prefs().loop;
  audio.addEventListener('loadedmetadata', () => { audio.currentTime = at; if (play) void audio.play().catch(() => toast('Tap Play to start.')); }, { once: true });
}

function releaseWait() {
  stopListening(); listening = false;
  const cue = track?.cues.find(item => item.lineId === waitingFor);
  resumedLine = waitingFor; waitingFor = '';
  if (cue) audio.currentTime = cue.end;
  void audio.play().catch(() => toast('Tap Play to start.'));
  tick();
}

async function beginListening(lineId: string) {
  listening = true; tick();
  try {
    await startListening(prefs().holdMs, () => { if (waitingFor === lineId) releaseWait(); });
  } catch (error) {
    listening = false; micFailed = true;
    toast(`The microphone could not be used${error instanceof Error ? ` (${error.message})` : ''}. Tap Continue for now. It tries again when you reopen the scene.`);
    tick();
  }
}

// Open the microphone on the Play tap, before any line of mine comes up. Otherwise an actor with
// the first line is already talking while it opens, and the room is measured on their voice.
async function warmUp() {
  const p = prefs();
  if (!(p.mode === 'practice' && p.wait && p.autoContinue) || micFailed) return;
  try { await prepareListening(); }
  catch (error) {
    micFailed = true;
    toast(`The microphone could not be used${error instanceof Error ? ` (${error.message})` : ''}. Tap Continue for now. It tries again when you reopen the scene.`);
  }
}

function stopCountdown() { clearInterval(countTimer); countLeft = 0; }
function countdown(go: () => void) {
  countLeft = phone.countdown; tick();
  countTimer = setInterval(() => { countLeft -= 1; if (countLeft > 0) { tick(); return; } stopCountdown(); go(); }, 1000);
}

function leaveScene() {
  stopCountdown(); audio.pause(); stopListening(); releaseMicrophone();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audio.removeAttribute('src'); audio.load();
  audioUrl = ''; loadedMode = null; micFailed = false; waitingFor = ''; resumedLine = ''; listening = false; activeLine = ''; revealed.clear(); track = undefined;
}

function openScene(id: string, key: string) {
  saved = projects.find(item => item.project.id === id);
  track = saved && sceneTracks(saved.project).find(item => item.key === key);
  if (!saved || !track) return;
  view = { name: 'scene', id, key };
  render();
  void load(0, false);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: `${saved.prefs.name} · Script Glow` });
    navigator.mediaSession.setActionHandler('play', () => { if (waitingFor) releaseWait(); else void audio.play(); });
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  }
}

function step(direction: 1 | -1) {
  const to = stepCue(track?.cues, audio.currentTime, direction);
  if (to === null) return;
  waitingFor = ''; stopListening(); listening = false; audio.currentTime = to; tick();
}

audio.addEventListener('timeupdate', () => {
  if (!saved || !track) return;
  const cue = cueAt(track.cues, audio.currentTime);
  audio.playbackRate = cueRate(prefs(), cue?.character);
  if (cue && cue.lineId !== resumedLine) resumedLine = '';
  if (!audio.paused && shouldWait(prefs(), cue, resumedLine)) {
    waitingFor = cue!.lineId; audio.pause();
    if (prefs().autoContinue && !micFailed) void beginListening(waitingFor);
  }
  tick();
});
for (const event of ['play', 'pause', 'ended']) audio.addEventListener(event, () => { keepAwake(phone.awake && (!audio.paused || !!waitingFor)); tick(); });

// The cheap update on every time step: no re-render, so the script does not jump under a finger.
function tick() {
  if (view.name !== 'scene' || !track) return;
  const cue = cueAt(track.cues, audio.currentTime);
  const status = app.querySelector('#status');
  const seek = app.querySelector<HTMLInputElement>('#seek');
  const play = app.querySelector<HTMLButtonElement>('#play');
  if (seek && document.activeElement !== seek) seek.value = String(audio.currentTime);
  app.querySelector('#elapsed')!.textContent = time(audio.currentTime);
  if (status) {
    const [title, detail] = countLeft ? [`Starting in ${countLeft}`, 'Get ready. Tap to cancel.']
      : waitingFor
      ? ['Your line.', listening ? 'Take your time. It goes on when you stop.' : 'Say it, then tap Continue.']
      : audio.paused ? ['Paused', `${track.cues.length} lines · ${time(track.duration)}`]
      : cue ? (prefs().mode === 'practice' && mine(cue.character) ? ['Your line.', 'Silence here is yours.'] : [`${pretty(cue.character)} is speaking`, prefs().mode === 'practice' ? 'Your lines stay silent' : 'Every line is voiced, yours too'])
      : ['', ''];
    status.innerHTML = `<span class="status-icon ${waitingFor ? 'waiting' : ''}">${icon(waitingFor ? 'mic' : 'next', 18)}</span><span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span>`;
  }
  if (play) {
    play.innerHTML = waitingFor ? '<span>Continue</span>' : countLeft ? `<span>${countLeft}</span>` : icon(audio.paused ? 'play' : 'pause', 26);
    play.classList.toggle('continue', !!waitingFor);
    play.setAttribute('aria-label', waitingFor ? 'Continue after my line' : countLeft ? 'Cancel the countdown' : audio.paused ? 'Play' : 'Pause');
  }
  const line = cue?.lineId ?? '';
  if (line !== activeLine) {
    app.querySelector(`[data-line="${activeLine}"]`)?.classList.remove('active');
    const next = app.querySelector(`[data-line="${line}"]`);
    next?.classList.add('active');
    next?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    activeLine = line;
  }
}

// ---- Screens ----

function render() {
  if (view.name === 'home') app.innerHTML = homeView();
  else if (view.name === 'project') app.innerHTML = projectView(view.id);
  else {
    // A peek or a hint re-renders the script; keep the actor's place in it.
    const scroll = app.querySelector('.script')?.scrollTop ?? 0;
    app.innerHTML = sceneView();
    app.querySelector('.script')!.scrollTop = scroll;
    tick();
  }
  app.classList.toggle('stage', view.name === 'scene');
}

function homeView() {
  const cards = projects.map(({ project, prefs: p, importedAt }) => `
    <button class="card" data-action="project" data-id="${esc(project.id)}">
      <strong>${esc(p.name)}</strong>
      <span>${p.role ? `You play <b>${esc(p.role)}</b> · ` : ''}${sceneTracks(project).length} ${sceneTracks(project).length === 1 ? 'scene' : 'scenes'}</span>
      <small>Sent ${new Date(importedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
    </button>`).join('');
  return `<header class="home-bar"><div class="brand">script<span>glow</span></div><button class="icon" data-action="app-settings" aria-label="Settings">${icon('gear')}</button></header>
    <main class="home">
      ${projects.length ? `<h2 class="label">YOUR SCENES</h2><div class="cards">${cards}</div>` : `
      <section class="empty"><h1>Rehearse anywhere.</h1><p>Make the scene and its voices on your computer. Send it here. Run lines on the train.</p>
        <ol><li>In Script Glow on your computer, open the project and choose <b>Back up</b>.</li><li>${Capacitor.getPlatform() === 'android' ? 'Send the <b>.sgbackup</b> file to this phone with Quick Share, or save it to Google Drive.' : 'AirDrop the <b>.sgbackup</b> file to this phone, or save it to Files or Google Drive.'}</li><li>Tap it, or add it below. Sending it again replaces the old copy.</li></ol></section>`}
      <h2 class="label">TRY A SAMPLE SCENE</h2>
      <div class="cards">${SAMPLES.map(sample => `<div class="card sample"><strong>${sample.title}</strong><span>${sample.blurb}</span>
        <div class="roles">${sample.roles.map(([role, url]) => `<button class="role" data-action="sample" data-url="${esc(url)}" ${busy ? 'disabled' : ''}>Play ${role}</button>`).join('')}</div></div>`).join('')}</div>
      <label class="add ${busy ? 'busy' : ''}">${icon('file')}<span>${busy ? 'Opening…' : 'Add from Files'}</span><input id="file" type="file" hidden ${busy ? 'disabled' : ''}></label>
    </main>`;
}

function projectView(id: string) {
  const entry = projects.find(item => item.project.id === id);
  if (!entry) { view = { name: 'home' }; return homeView(); }
  const tracks = sceneTracks(entry.project);
  return `<header class="bar"><button class="icon" data-action="home" aria-label="Back to projects">${icon('back')}</button><div class="bar-title"><strong>${esc(entry.prefs.name)}</strong><small>${entry.prefs.role ? `You play ${esc(entry.prefs.role)}` : 'No role chosen'}</small></div><button class="icon" data-action="app-settings" aria-label="Settings">${icon('gear')}</button></header>
    <main class="home">
      <h2 class="label">SCENES WITH AUDIO</h2>
      <div class="cards">${tracks.map(item => `<button class="card" data-action="scene" data-id="${esc(id)}" data-key="${esc(item.key)}"><strong>${esc(item.title)}</strong><span>${item.cues.length} lines · ${time(item.duration)}</span></button>`).join('')}</div>
      <p class="hint">Only scenes you have played on your computer come across, because the voices are made there.</p>
      <button class="remove" data-action="remove" data-id="${esc(id)}">Remove from this phone</button>
    </main>`;
}

function sceneView() {
  const p = prefs();
  const practice = p.mode === 'practice';
  const lines = track!.lines.map(line => {
    if (line.format === 'heading') return `<p class="heading">${esc(line.text)}</p>`;
    if (line.kind === 'direction') return phone.directions ? `<p class="direction">${esc(line.text)}</p>` : '';
    const own = mine(line.character);
    const hidden = own && practice && p.hide && !revealed.has(line.id);
    const text = hidden ? (p.hint ? firstLetters(line.text) : 'Your line. Tap to peek.') : line.text;
    return `<button class="line ${own ? 'mine' : ''} ${hidden ? (p.hint ? 'hinted' : 'hidden') : ''} ${line.id === activeLine ? 'active' : ''}" data-action="line" data-line="${esc(line.id)}"><span class="who">${esc(line.character)}</span><span class="text">${esc(text)}</span></button>`;
  }).join('');
  return `<header class="bar"><button class="icon" data-action="project" data-id="${esc(saved!.project.id)}" aria-label="Back to scenes">${icon('back')}</button><div class="bar-title"><strong>${esc(track!.title)}</strong><small>You are ${esc(p.role || 'nobody yet')}</small></div><button class="icon" data-action="settings" aria-label="Rehearsal settings">${icon('sliders')}</button></header>
    <div class="modes" role="group" aria-label="Rehearsal mode"><button data-action="mode" data-mode="practice" aria-pressed="${practice}">Practice</button><button data-action="mode" data-mode="full" aria-pressed="${!practice}">Full read</button></div>
    <main class="script">${lines}</main>
    <footer class="transport">
      <div id="status" class="status" aria-live="polite"></div>
      <div class="seek"><span id="elapsed">0:00</span><input id="seek" type="range" min="0" max="${track!.duration}" step="0.1" value="${audio.currentTime}" aria-label="Seek"><span>${time(track!.duration)}</span></div>
      <div class="buttons">
        <button class="round ${p.hint ? 'on' : ''}" data-action="hint" aria-label="First-letter hint" aria-pressed="${p.hint}">Aa</button>
        <button class="icon" data-action="prev" aria-label="Previous line">${icon('prev')}</button>
        <button id="play" class="play" data-action="play" aria-label="Play">${icon('play', 26)}</button>
        <button class="icon" data-action="next" aria-label="Next line">${icon('next')}</button>
        <button class="round ${p.loop ? 'on' : ''}" data-action="loop" aria-label="Loop the scene" aria-pressed="${p.loop}">${icon('loop', 20)}</button>
      </div>
    </footer>`;
}

// ---- Events ----

app.addEventListener('click', async event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const { action, id = '', key = '' } = target.dataset;
  if (action === 'home') { view = { name: 'home' }; render(); return; }
  if (action === 'sample') { await importBuffer(await (await fetch(target.dataset.url!)).arrayBuffer()); return; }
  if (action === 'project') { if (view.name === 'scene') leaveScene(); view = { name: 'project', id }; render(); return; }
  if (action === 'scene') { openScene(id, key); return; }
  if (action === 'app-settings') { openPhone(); return; }
  if (action === 'remove') { await removeFromPhone(id); return; }
  if (!saved || !track) return;
  const p = prefs();
  if (action === 'play') {
    if (waitingFor) releaseWait();
    else if (countLeft) { stopCountdown(); tick(); }
    else if (loadedMode !== p.mode || audio.paused) {
      // The microphone opens before the countdown, so the room is measured while the actor gets ready.
      await warmUp();
      const go = () => { if (loadedMode !== prefs().mode) void load(audio.currentTime, true); else void audio.play().catch(() => toast('Tap Play to start.')); };
      if (phone.countdown) countdown(go); else go();
    }
    else audio.pause();
  }
  if (action === 'prev' || action === 'next') step(action === 'next' ? 1 : -1);
  if (action === 'mode' && target.dataset.mode !== p.mode) {
    p.mode = target.dataset.mode as 'full' | 'practice'; persist();
    const playing = !audio.paused; waitingFor = ''; stopListening(); listening = false;
    void load(audio.currentTime, playing); render();
  }
  if (action === 'hint') { p.hint = !p.hint; persist(); render(); }
  if (action === 'loop') { p.loop = !p.loop; audio.loop = p.loop; persist(); render(); }
  if (action === 'settings') { fillSettings(); settings.showModal(); }
  if (action === 'line') {
    const line = target.dataset.line!;
    if (target.classList.contains('hidden') || target.classList.contains('hinted')) { revealed.add(line); render(); return; }
    const cue = track.cues.find(item => item.lineId === line);
    if (cue) { waitingFor = ''; stopListening(); listening = false; resumedLine = ''; audio.currentTime = cue.start; tick(); }
  }
});

app.addEventListener('input', event => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'seek') { waitingFor = ''; stopListening(); listening = false; audio.currentTime = Number(target.value); tick(); }
});
app.addEventListener('change', async event => {
  const target = event.target as HTMLInputElement;
  if (target.id !== 'file' || !target.files?.[0]) return;
  const file = target.files[0]; target.value = '';
  await importBuffer(await file.arrayBuffer());
});

function fillSettings() {
  const p = prefs();
  settings.querySelector<HTMLInputElement>('[name="hide"]')!.checked = p.hide;
  // Wait and go-on-by-itself are two saved switches (the desktop's), shown here as one choice.
  const onLine = !p.wait ? 'play' : p.autoContinue ? 'listen' : 'tap';
  settings.querySelector<HTMLInputElement>(`[name="onLine"][value="${onLine}"]`)!.checked = true;
  settings.querySelector<HTMLSelectElement>('[name="rate"]')!.value = String(p.rate);
  settings.querySelector<HTMLSelectElement>('[name="holdMs"]')!.value = String(p.holdMs);
  settings.querySelector<HTMLLabelElement>('#hold-row')!.hidden = !(p.wait && p.autoContinue);
}
settings.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-sheet]');
  if (target?.dataset.sheet === 'phone') { settings.close(); openPhone(); }
  if (target?.dataset.sheet === 'defaults' && saved) { phone.defaults = pick(prefs()); applyPhone(); toast('New projects will start with these settings.'); }
});
settings.addEventListener('change', event => {
  const target = event.target as HTMLInputElement;
  const p = prefs();
  if (target.name === 'hide') p.hide = target.checked;
  if (target.name === 'onLine') { p.wait = target.value !== 'play'; p.autoContinue = target.value === 'listen'; }
  if (target.name === 'rate' || target.name === 'holdMs') p[target.name] = Number(target.value);
  if (!p.wait) { waitingFor = ''; releaseMicrophone(); listening = false; }
  else if (!p.autoContinue && listening) { stopListening(); listening = false; }
  if (target.value === 'listen') micFailed = false;
  if (p.autoContinue && waitingFor && !listening) void beginListening(waitingFor);
  else if (target.value === 'listen') void warmUp();
  fillSettings(); persist(); render();
});
for (const sheet of [settings, appSettings]) sheet.addEventListener('click', event => { if (event.target === sheet || (event.target as HTMLElement).closest('[data-close]')) sheet.close(); });

// ---- Start ----

applyPhone();
void navigator.storage?.persist?.();
void App.addListener('appUrlOpen', ({ url }) => void openUrl(url));
projects = await listProjects();
render();
const launch = await App.getLaunchUrl().catch(() => undefined);
if (launch?.url) void openUrl(launch.url);
