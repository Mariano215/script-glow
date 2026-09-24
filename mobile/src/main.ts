import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { cueAt, cueRate, firstLetters, shouldWait, stepCue } from '../../src/playback.ts';
import { prepareListening, releaseMicrophone, startListening, stopListening } from '../../src/listening.ts';
import { readBackup, sceneTracks, type SceneTrack } from './backup.ts';
import { getAudio, listProjects, removeProject, saveBackup, savePrefs, type Saved } from './store.ts';
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
let activeLine = '';
const revealed = new Set<string>();

const esc = (text: string) => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const pretty = (name: string) => name.charAt(0) + name.slice(1).toLowerCase();
const icons: Record<string, string> = {
  back: '<path d="M15 5l-7 7 7 7"/>', sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  prev: '<path d="M6 5v14M19 5l-9 7 9 7z"/>', next: '<path d="M18 5v14M5 5l9 7-9 7z"/>', play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
  loop: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
};
const icon = (name: string, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

function toast(message: string) {
  const box = document.querySelector<HTMLDivElement>('#toast')!;
  box.textContent = message; box.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
}

// ---- Getting a project onto the phone ----

async function importBuffer(buffer: ArrayBuffer) {
  busy = true; render();
  try {
    const backup = await readBackup(buffer);
    if (!backup.project.renders.length) throw new Error('This project has no audio yet. Press Play on your Mac to make it, then back it up again.');
    const previous = projects.find(item => item.project.id === backup.project.id);
    await saveBackup(backup, previous);
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
  if (!blob) { toast('This scene\'s audio is missing. Send the project again from your Mac.'); return; }
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
    listening = false; prefs().autoContinue = false; persist();
    toast(error instanceof Error ? error.message : 'The microphone could not be used, so listening is off.');
    tick();
  }
}

// Open the microphone on the Play tap, before any line of mine comes up. Otherwise an actor with
// the first line is already talking while it opens, and the room is measured on their voice.
async function warmUp() {
  const p = prefs();
  if (!(p.mode === 'practice' && p.wait && p.autoContinue)) return;
  try { await prepareListening(); }
  catch (error) {
    p.autoContinue = false; persist();
    toast(error instanceof Error ? error.message : 'The microphone could not be used, so listening is off.');
  }
}

function leaveScene() {
  audio.pause(); stopListening(); releaseMicrophone();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audio.removeAttribute('src'); audio.load();
  audioUrl = ''; loadedMode = null; waitingFor = ''; resumedLine = ''; listening = false; activeLine = ''; revealed.clear(); track = undefined;
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
    if (prefs().autoContinue) void beginListening(waitingFor);
  }
  tick();
});
for (const event of ['play', 'pause', 'ended']) audio.addEventListener(event, () => tick());

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
    const [title, detail] = waitingFor
      ? ['Your line.', listening ? 'Take your time. It goes on when you stop.' : 'Say it, then tap Continue.']
      : audio.paused ? ['Paused', `${track.cues.length} lines · ${time(track.duration)}`]
      : cue ? (prefs().mode === 'practice' && mine(cue.character) ? ['Your line.', 'Silence here is yours.'] : [`${pretty(cue.character)} is speaking`, prefs().mode === 'practice' ? 'Your lines stay silent' : 'Every line is voiced, yours too'])
      : ['', ''];
    status.innerHTML = `<span class="status-icon ${waitingFor ? 'waiting' : ''}">${icon(waitingFor ? 'mic' : 'next', 18)}</span><span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span>`;
  }
  if (play) {
    play.innerHTML = waitingFor ? '<span>Continue</span>' : icon(audio.paused ? 'play' : 'pause', 26);
    play.classList.toggle('continue', !!waitingFor);
    play.setAttribute('aria-label', waitingFor ? 'Continue after my line' : audio.paused ? 'Play' : 'Pause');
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
  return `<header class="home-bar"><div class="brand">script<span>glow</span></div></header>
    <main class="home">
      ${projects.length ? `<h2 class="label">YOUR SCENES</h2><div class="cards">${cards}</div>` : `
      <section class="empty"><h1>Rehearse anywhere.</h1><p>Make the scene and its voices on your Mac. Send it here. Run lines on the train.</p>
        <ol><li>On your Mac, open the project and choose <b>Back up</b>.</li><li>${Capacitor.getPlatform() === 'android' ? 'Send the <b>.sgbackup</b> file to this phone with Quick Share, or save it to Google Drive.' : 'AirDrop the <b>.sgbackup</b> file to this phone, or save it to Files or Google Drive.'}</li><li>Tap it, or add it below. Sending it again replaces the old copy.</li></ol></section>`}
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
  return `<header class="bar"><button class="icon" data-action="home" aria-label="Back to projects">${icon('back')}</button><div class="bar-title"><strong>${esc(entry.prefs.name)}</strong><small>${entry.prefs.role ? `You play ${esc(entry.prefs.role)}` : 'No role chosen'}</small></div><span class="icon"></span></header>
    <main class="home">
      <h2 class="label">SCENES WITH AUDIO</h2>
      <div class="cards">${tracks.map(item => `<button class="card" data-action="scene" data-id="${esc(id)}" data-key="${esc(item.key)}"><strong>${esc(item.title)}</strong><span>${item.cues.length} lines · ${time(item.duration)}</span></button>`).join('')}</div>
      <p class="hint">Only scenes you have played on your Mac come across, because the voices are made there.</p>
      <button class="remove" data-action="remove" data-id="${esc(id)}">Remove from this phone</button>
    </main>`;
}

function sceneView() {
  const p = prefs();
  const practice = p.mode === 'practice';
  const lines = track!.lines.map(line => {
    if (line.format === 'heading') return `<p class="heading">${esc(line.text)}</p>`;
    if (line.kind === 'direction') return `<p class="direction">${esc(line.text)}</p>`;
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
  if (action === 'remove') {
    if (!confirm('Remove this project and its audio from the phone? Your Mac keeps its copy.')) return;
    await removeProject(id); projects = await listProjects(); view = { name: 'home' }; render(); return;
  }
  if (!saved || !track) return;
  const p = prefs();
  if (action === 'play') {
    if (waitingFor) releaseWait();
    else if (loadedMode !== p.mode) { await warmUp(); void load(audio.currentTime, true); }
    else if (audio.paused) { await warmUp(); void audio.play().catch(() => toast('Tap Play to start.')); }
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
  settings.querySelector<HTMLSelectElement>('[name="holdMs"]')!.disabled = !p.autoContinue;
}
settings.addEventListener('change', event => {
  const target = event.target as HTMLInputElement;
  const p = prefs();
  if (target.name === 'hide') p.hide = target.checked;
  if (target.name === 'onLine') { p.wait = target.value !== 'play'; p.autoContinue = target.value === 'listen'; }
  if (target.name === 'rate' || target.name === 'holdMs') p[target.name] = Number(target.value);
  if (!p.wait) { waitingFor = ''; releaseMicrophone(); listening = false; }
  else if (!p.autoContinue && listening) { stopListening(); listening = false; }
  if (p.autoContinue && waitingFor && !listening) void beginListening(waitingFor);
  else if (target.value === 'listen') void warmUp();
  fillSettings(); persist(); render();
});
settings.addEventListener('click', event => { if (event.target === settings || (event.target as HTMLElement).closest('[data-close]')) settings.close(); });

// ---- Start ----

void navigator.storage?.persist?.();
void App.addListener('appUrlOpen', ({ url }) => void openUrl(url));
projects = await listProjects();
render();
const launch = await App.getLaunchUrl().catch(() => undefined);
if (launch?.url) void openUrl(launch.url);
