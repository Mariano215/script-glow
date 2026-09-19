// Starts the Kokoro worker (worker.js) on first use and sends it one line at a time, in order.
// A line that takes more than 60 seconds fails. A crashed worker is started again once and the
// line retried. After 10 minutes without a request the worker is stopped, so its memory goes back.
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Set only in the desktop app's main process. The RunAsNode fuse is off there, so the worker is an
// Electron utility process, the same way as the PDF worker in app.js.
const utilityProcess = process.versions.electron && process.type === 'browser' ? (await import('electron')).utilityProcess : null;
// The worker and every package it imports are unpacked from app.asar (desktop/builder.cjs).
export const WORKER_FILE = fileURLToPath(new URL('./worker.js', import.meta.url)).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const failure = (message, extra = {}) => Object.assign(new Error(message), { status: 502, ...extra });
// Workers still running when the app quits go with it.
const live = new Set();
process.once('exit', () => { for (const child of live) child.kill(); });

function spawn(file, args) {
  if (utilityProcess) return utilityProcess.fork(file, args, { stdio: 'ignore', serviceName: 'Script Glow built-in voices' });
  const child = fork(file, args, { serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
  // A send to a worker that just died shows up as its exit, not as an unhandled error.
  child.on('error', () => {});
  // An idle worker does not keep the server process alive; it exits when its parent does.
  child.unref(); child.channel?.unref();
  return child;
}
const deliver = (child, message) => utilityProcess ? child.postMessage(message) : child.connected && child.send(message);

export function createKokoroClient({ workerFile = WORKER_FILE, args = [], timeoutMs = 60000, idleMs = 10 * 60000 } = {}) {
  let child = null, idle = null, nextId = 1, queue = Promise.resolve();
  function stop() {
    clearTimeout(idle);
    const running = child; child = null;
    running?.kill();
  }
  function worker() {
    if (!child) {
      const started = child = spawn(workerFile, args);
      live.add(started);
      started.on('exit', () => { live.delete(started); if (child === started) child = null; });
    }
    return child;
  }
  function once(voice, text) {
    return new Promise((resolve, reject) => {
      const running = worker(), id = nextId++;
      const finish = (settle, value) => { clearTimeout(timer); running.off('message', onMessage); running.off('exit', onExit); settle(value); };
      const onMessage = message => {
        if (message?.id !== id) return;
        if (message.error) finish(reject, failure(message.error));
        else finish(resolve, Buffer.from(message.pcm.buffer, message.pcm.byteOffset, message.pcm.byteLength));
      };
      const onExit = () => finish(reject, failure('Built-in voices stopped unexpectedly.', { crashed: true }));
      const timer = setTimeout(() => {
        finish(reject, failure(`Built-in voices took more than ${timeoutMs / 1000} seconds on one line. Try again, or split the line.`, { status: 504 }));
        stop();
      }, timeoutMs);
      running.on('message', onMessage);
      running.on('exit', onExit);
      deliver(running, { id, voice, text });
    });
  }
  async function attempt(voice, text) {
    clearTimeout(idle);
    try { return await once(voice, text); }
    catch (error) {
      if (!error.crashed) throw error;
      // One crash can be bad luck, such as a moment of low memory. A second one on the same line is not.
      return once(voice, text).catch(again => { throw again.crashed ? failure('Built-in voices stopped twice on this line. Restart Script Glow and try again.') : again; });
    }
  }
  return {
    // voice is the name without its engine prefix (af_heart). Resolves to 16-bit mono PCM at 24 kHz.
    speak(voice, text) {
      const run = queue.then(() => attempt(voice, text));
      const rest = () => { clearTimeout(idle); idle = setTimeout(stop, idleMs); idle.unref?.(); };
      queue = run.then(rest, rest);
      return run;
    },
    stop,
  };
}
