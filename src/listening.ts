// Listening mode. While the player waits on the actor's line, the microphone level says when
// they have finished, so the scene goes on without a key press. Only the level is read: no
// recording is kept, nothing is written to disk and nothing leaves the browser.
import { listenFrom, listenStart, listenStep, type ListenState } from './playback';
import { monoWav } from './selftape';

const SAMPLE_MS = 20;
let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let samples: Float32Array<ArrayBuffer> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let recorder: MediaRecorder | null = null;
// The room as measured by prepareListening, before the scene began. Unset, each wait measures its own.
let roomFloor: number | undefined;

// A device another program holds can leave this pending for ever, so it is given a limit.
// The actor is told, listening switches off, and Space still ends the wait as it always has.
async function microphone(): Promise<MediaStream> {
  if (stream?.active) return stream;
  let stalled: ReturnType<typeof setTimeout> | undefined;
  let late = false;
  const asked = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  asked.then(live => { if (late) live.getTracks().forEach(track => track.stop()); }, () => {});
  stream = await Promise.race([
    asked,
    new Promise<MediaStream>((_, reject) => { stalled = setTimeout(() => { late = true; reject(new Error('The microphone did not answer. Close anything else using it, then try again.')); }, 10000); }),
  ]).finally(() => clearTimeout(stalled));
  return stream;
}

// Root mean square over one frame: how loud the room is right now, between 0 and 1.
function level(): number {
  if (!analyser || !samples) return 0;
  analyser.getFloatTimeDomainData(samples);
  let total = 0;
  for (const value of samples) total += value * value;
  return Math.sqrt(total / samples.length);
}

async function open(): Promise<MediaStream> {
  const live = await microphone();
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') await context.resume();
  if (!analyser) {
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    samples = new Float32Array(analyser.fftSize);
  }
  // A microphone unplugged and plugged back in is a new stream; the level must come from it.
  if (source?.mediaStream !== live) {
    source?.disconnect();
    source = context.createMediaStreamSource(live);
    source.connect(analyser);
  }
  return live;
}

// Called on the Play tap: opens the microphone and measures the room before the scene starts.
// An actor with the scene's first line speaks from the moment the wait begins, so a room measured
// then is their own voice, and the line is never heard. The tap also lets iOS start the meter.
export async function prepareListening(): Promise<void> {
  await open();
  let state = listenStart(performance.now());
  await new Promise<void>(resolve => {
    const measuring = setInterval(() => {
      state = listenStep(state, level(), performance.now(), 0);
      if (state.phase === 'calibrating') return;
      clearInterval(measuring); roomFloor = state.floor; resolve();
    }, SAMPLE_MS);
  });
}

// `clip` is optional and only used with Check what I said. It is called after the wait has
// already been released, with the actor's line as a WAV, so transcription never delays the cue.
export async function startListening(holdMs: number, done: () => void, clip?: (wav: Blob) => void): Promise<void> {
  if (timer !== undefined) return;
  const live = await open();
  if (clip) {
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(live);
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    // The cue has already gone by the time this runs. Nothing is written to disk, and the
    // chunks are dropped as soon as the WAV is handed over.
    recorder.onstop = () => { void toWav(chunks).then(wav => { if (wav) clip(wav); }); };
    recorder.start();
  }
  let state: ListenState = roomFloor === undefined ? listenStart(performance.now()) : listenFrom(performance.now(), roomFloor);
  timer = setInterval(() => {
    state = listenStep(state, level(), performance.now(), holdMs);
    if (state.phase !== 'done') return;
    stopListening();
    done();
  }, SAMPLE_MS);
}

// The recorder gives WebM; the transcription server is given a plain WAV, the one format
// every Whisper build reads without guessing from the file name.
async function toWav(chunks: Blob[]): Promise<Blob | null> {
  if (!chunks.length || !context) return null;
  try {
    const decoded = await context.decodeAudioData(await new Blob(chunks).arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return new Blob([monoWav(channels, decoded.sampleRate)], { type: 'audio/wav' });
  } catch { return null; }
}

// Between lines the level is not read. The stream stays open, because asking again on every
// line blinks the browser's microphone light and costs about 200 ms at each cue.
export function stopListening(): void {
  clearInterval(timer);
  timer = undefined;
  if (recorder?.state === 'recording') recorder.stop();
  recorder = null;
}

// The scene is closed: give the microphone back, so the light goes out.
export function releaseMicrophone(): void {
  stopListening();
  stream?.getTracks().forEach(track => track.stop());
  void context?.close();
  stream = null; context = null; analyser = null; source = null; samples = null; roomFloor = undefined;
}
