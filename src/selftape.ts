// A self-tape is the actor's own recording, played against the cast audio this app already makes.
// It never leaves the machine: the take is posted to the local project store and nowhere else.

// Casting sites ask for MP4. Chromium builds without the proprietary codecs answer false for the
// H.264 string and true for bare video/mp4, so ask for the best container first and settle down.
export const TAKE_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];
export const supportedTakeTypes = (supported: (type: string) => boolean): string[] => TAKE_TYPES.filter(type => supported(type));
export const pickTakeType = (supported: (type: string) => boolean): string => supportedTakeTypes(supported)[0] ?? '';
export const takeContainer = (type: string): string => type.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
// Say so plainly when the file is a WebM: some casting sites refuse it and it needs converting.
export const takeNeedsConverting = (type: string): boolean => !!type && !type.startsWith('video/mp4');
export const takeLabel = (sceneTitle: string, existing: number): string =>
  `${sceneTitle.trim().slice(0, 60) || 'Scene'} · take ${existing + 1}`.slice(0, 100);
export const takeClock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// The graph the cast audio is routed through once a camera has been opened. Nothing plays
// through the speakers while it is suspended, so its state is worth reporting plainly.
export const mixerState = (): 'none' | AudioContextState => mixer ? mixer.context.state : 'none';
export async function resumeMixer(): Promise<boolean> {
  if (!mixer) return true;
  if (mixer.context.state !== 'running') await mixer.context.resume().catch(() => { /* reported by the state below */ });
  return mixer.context.state === 'running';
}

// A count-in beep. It is connected to the speakers only, never to the destination that feeds the
// recorder, so the actor hears it and the take does not. There is no tone at zero on purpose: a
// beep at the top of a take is the one thing a casting office does not want on the file.
let beepContext: AudioContext | undefined;
export function countBeep(): void {
  try {
    const context = mixer?.context ?? (beepContext ??= new AudioContext());
    if (context.state !== 'running') { void context.resume().catch(() => {}); }
    const tone = context.createOscillator();
    const level = context.createGain();
    const now = context.currentTime;
    tone.type = 'sine';
    tone.frequency.setValueAtTime(880, now);
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(0.14, now + 0.008);
    level.gain.linearRampToValueAtTime(0, now + 0.13);
    tone.connect(level).connect(context.destination);
    tone.start(now);
    tone.stop(now + 0.14);
  } catch { /* a machine with no audio output still records */ }
}

export interface Take { file: string; label: string; sceneId: string; ms: number; created: string; bytes: number; kind?: 'scene' | 'slate'; from?: string }

// What the big casting sites accept, from their help pages (checked 2026-09). A take is shown
// against these before it is sent, so a refusal is not the first the actor hears of it.
// Casting Networks: mov, mkv or mp4, up to 300 MB. Eco Cast (Actors Access): up to 500 MB per file.
// Spotlight: MP4, MOV, WebM and others, no stated size limit.
export const CASTING_SITES = [
  { site: 'Casting Networks', formats: ['mp4', 'mov', 'mkv'], maxBytes: 300 * 1024 * 1024 },
  { site: 'Eco Cast', formats: [] as string[], maxBytes: 500 * 1024 * 1024 },
  { site: 'Spotlight', formats: ['mp4', 'mov', 'webm', 'mkv'], maxBytes: Infinity },
];
export function castingFit(bytes: number, file: string): { site: string; ok: boolean; reason: string }[] {
  const format = file.split('.').pop()?.toLowerCase() ?? '';
  return CASTING_SITES.map(({ site, formats, maxBytes }) => {
    if (formats.length && !formats.includes(format)) return { site, ok: false, reason: `needs ${formats.includes('mp4') ? 'MP4' : formats[0].toUpperCase()}` };
    if (bytes > maxBytes) return { site, ok: false, reason: `over ${Math.round(maxBytes / 1024 / 1024)} MB` };
    return { site, ok: true, reason: '' };
  });
}
// Performer, project and scene, as casting instructions usually ask: Jane_Doe_Evelyn_Kitchen.
export function castingFileName(...parts: string[]): string {
  return parts.map(part => part.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join('_'))
    .filter(Boolean).join('_').slice(0, 120) || 'Self_tape';
}

// When FFmpeg is not installed, a take can still become an MP4 by playing it once through the
// browser's own recorder. It takes as long as the part being kept, and needs a browser that can
// record MP4 (current Chrome and Edge can).
export const BROWSER_MP4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
export const browserMp4Type = (supported: (type: string) => boolean): string =>
  typeof HTMLMediaElement !== 'undefined' && !('captureStream' in HTMLMediaElement.prototype) ? '' : BROWSER_MP4.find(supported) ?? '';
export async function browserMp4(url: string, start: number, end: number, onProgress: (fraction: number) => void): Promise<Blob> {
  const type = browserMp4Type(candidate => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate));
  if (!type) throw new Error('This browser cannot make MP4 files. Install FFmpeg, or use Chrome or Edge.');
  const video = document.createElement('video');
  video.src = url; video.muted = false; video.playsInline = true; video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-10000px;width:320px;height:180px';
  document.body.append(video);
  try {
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('The take could not be opened.')); });
    const stop = end > start ? end : video.duration;
    video.currentTime = start;
    await new Promise(resolve => { video.onseeked = resolve; });
    const stream = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const done = new Promise(resolve => { recorder.onstop = resolve; });
    // Heard only by the recorder: the element is muted to the room once capture has started.
    recorder.start(1000);
    await video.play();
    video.volume = 0;
    await new Promise<void>(resolve => {
      const tick = () => {
        onProgress(Math.min(1, (video.currentTime - start) / Math.max(0.1, stop - start)));
        if (video.currentTime >= stop || video.ended) { video.pause(); resolve(); return; }
        setTimeout(tick, 100);
      };
      tick();
    });
    recorder.stop();
    await done;
    return new Blob(chunks, { type: 'video/mp4' });
  } finally { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); }
}
export interface TakeRecording { blob: Blob; type: string; ms: number }

// One context for the life of the page. createMediaElementSource reroutes the element's output
// through this graph permanently, so the context is never closed and the cast is always wired
// back to the speakers as well as into the take.
let mixer: { context: AudioContext; destination: MediaStreamAudioDestinationNode; reader: GainNode } | null = null;
// How loud the scene partner is in the take. The actor's headphones are not affected.
let readerLevel = 1;
export function setReaderLevel(level: number): void {
  readerLevel = Math.min(1.5, Math.max(0, Number.isFinite(level) ? level : 1));
  if (mixer) mixer.reader.gain.setTargetAtTime(readerLevel, mixer.context.currentTime, 0.02);
}
function castMixer(cast: HTMLAudioElement) {
  if (!mixer) {
    const context = new AudioContext();
    const source = context.createMediaElementSource(cast);
    const destination = context.createMediaStreamDestination();
    const reader = context.createGain();
    reader.gain.value = readerLevel;
    source.connect(context.destination);
    source.connect(reader).connect(destination);
    mixer = { context, destination, reader };
  }
  return mixer;
}

export interface TakeRecorder {
  readonly preview: MediaStream;
  readonly type: string;
  readonly recording: boolean;
  readonly elapsed: number;
  start(maxMs: number, onLimit: () => void): void;
  stop(): Promise<TakeRecording>;
  release(): void;
}

// Asks for the camera and microphone. Nothing starts until the caller presses record, and every
// exit path releases the devices.
export async function openRecorder(cast: HTMLAudioElement): Promise<TakeRecorder> {
  const candidates = supportedTakeTypes(candidate => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate));
  if (!candidates.length) throw new Error('This browser cannot record video. Try a current Chrome, Edge, Firefox or Safari.');
  // Safari starts audio only inside the click itself, and the camera prompt ends that click. So the
  // graph is built and started now, before anything is awaited.
  const { context, destination } = castMixer(cast);
  const starting = context.state === 'running' ? Promise.resolve() : context.resume().catch(() => { /* checked below */ });
  // A device held by another program can leave this request pending for ever. Give up rather
  // than leave the actor looking at a button that never comes back.
  let stalled: ReturnType<typeof setTimeout> | undefined;
  let late = false;
  const asked = navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  // A camera that answers after we gave up is switched off again, so its light does not stay on.
  asked.then(stream => { if (late) stream.getTracks().forEach(track => track.stop()); }, () => {});
  const camera = await Promise.race([
    asked,
    new Promise<MediaStream>((resolve, reject) => { stalled = setTimeout(() => { late = true; reject(new Error('The camera did not answer. Close anything else using it, then try again.')); }, 15000); }),
  ]).finally(() => clearTimeout(stalled));
  let microphone: MediaStreamAudioSourceNode | undefined;
  let recorder: MediaRecorder | undefined;
  let startedAt = 0;
  let limit: ReturnType<typeof setTimeout> | undefined;
  const chunks: Blob[] = [];
  try {
    // Routing the cast through this graph is permanent for the life of the page. If the graph is
    // not running, the scene goes silent everywhere, so wait for it rather than hope. Play also
    // starts it again (see resumeMixer), so a refusal here does not leave the scene silent.
    await starting;
    if (context.state !== 'running') throw new Error('The browser will not start audio yet. Press play on the scene once, then turn the camera on again.');
    microphone = context.createMediaStreamSource(camera);
    microphone.connect(destination);
    const mixed = new MediaStream([...camera.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    // isTypeSupported can be optimistic, so keep trying until one actually builds.
    for (const candidate of candidates) {
      try { recorder = new MediaRecorder(mixed, { mimeType: candidate, videoBitsPerSecond: 4_000_000 }); break; } catch { /* try the next container */ }
    }
    if (!recorder) throw new Error('This browser could not start a recording in any supported format.');
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  } catch (error) {
    camera.getTracks().forEach(track => track.stop());
    microphone?.disconnect();
    throw error;
  }
  const active = recorder;
  const source = microphone;
  const type = active.mimeType || candidates[0];
  return {
    preview: camera,
    type,
    get recording() { return active.state === 'recording'; },
    get elapsed() { return startedAt ? Date.now() - startedAt : 0; },
    start(maxMs, onLimit) {
      if (active.state === 'recording') return;
      chunks.length = 0;
      startedAt = Date.now();
      active.start(1000);
      limit = setTimeout(() => { onLimit(); }, maxMs);
    },
    stop() {
      clearTimeout(limit);
      const ms = startedAt ? Date.now() - startedAt : 0;
      startedAt = 0;
      if (active.state === 'inactive') return Promise.resolve({ blob: new Blob(chunks, { type: takeContainer(type) }), type, ms });
      return new Promise<TakeRecording>(resolve => {
        const finish = () => resolve({ blob: new Blob(chunks, { type: takeContainer(type) }), type, ms });
        active.addEventListener('stop', finish, { once: true });
        // A camera unplugged mid-take ends in an error, not a stop. Keep what was recorded.
        active.addEventListener('error', finish, { once: true });
        try { active.stop(); } catch { finish(); }
      });
    },
    release() {
      clearTimeout(limit);
      startedAt = 0;
      if (active.state !== 'inactive') active.stop();
      source.disconnect();
      camera.getTracks().forEach(track => track.stop());
    },
  };
}

// A 16-bit mono WAV from decoded audio. Browsers record compressed audio; the voice server wants
// WAV. The rate is kept as recorded: the app server resamples it.
export function monoWav(channels: Float32Array[], rate: number): Uint8Array<ArrayBuffer> {
  const frames = channels[0]?.length ?? 0;
  const out = new DataView(new ArrayBuffer(44 + frames * 2));
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) out.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); out.setUint32(4, 36 + frames * 2, true); text(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  text(36, 'data'); out.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    const value = Math.max(-1, Math.min(1, sum / channels.length));
    out.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  return new Uint8Array(out.buffer);
}
