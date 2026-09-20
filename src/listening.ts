// Listening mode. While the player waits on the actor's line, the microphone level says when
// they have finished, so the scene goes on without a key press. Only the level is read: no
// recording is kept, nothing is written to disk and nothing leaves the browser.
import { listenStart, listenStep, type ListenState } from './playback';

const SAMPLE_MS = 20;
let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let samples: Float32Array<ArrayBuffer> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

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

export async function startListening(holdMs: number, done: () => void): Promise<void> {
  if (timer !== undefined) return;
  const live = await microphone();
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') await context.resume();
  if (!analyser) {
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    samples = new Float32Array(analyser.fftSize);
    context.createMediaStreamSource(live).connect(analyser);
  }
  let state: ListenState = listenStart(performance.now());
  timer = setInterval(() => {
    state = listenStep(state, level(), performance.now(), holdMs);
    if (state.phase !== 'done') return;
    stopListening();
    done();
  }, SAMPLE_MS);
}

// Between lines the level is not read. The stream stays open, because asking again on every
// line blinks the browser's microphone light and costs about 200 ms at each cue.
export function stopListening(): void {
  clearInterval(timer);
  timer = undefined;
}

// The scene is closed: give the microphone back, so the light goes out.
export function releaseMicrophone(): void {
  stopListening();
  stream?.getTracks().forEach(track => track.stop());
  void context?.close();
  stream = null; context = null; analyser = null; samples = null;
}
