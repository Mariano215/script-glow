// Turning a take into the file casting sites accept: an H.264/AAC MP4, optionally trimmed.
// FFmpeg does the work when it is installed; the page has a slower fallback when it is not.
// Only generated file names and checked numbers ever reach the command line.
import { spawn } from 'node:child_process';

// SCRIPT_GLOW_FFMPEG names the program (for example a Windows ffmpeg.exe used from WSL);
// otherwise ffmpeg is looked up on the PATH.
const candidates = () => [process.env.SCRIPT_GLOW_FFMPEG, 'ffmpeg'].filter(Boolean);

function run(program, args, { cwd, timeout }) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(program, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { reject(error); return; }
    let out = '', err = '';
    child.stdout.on('data', chunk => { out = (out + chunk).slice(-20000); });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-4000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('FFmpeg took too long and was stopped.')); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(Object.assign(new Error('FFmpeg could not convert this take.'), { detail: err.trim().split('\n').slice(-3).join(' ') }));
    });
  });
}

let found;
// Checked once per launch; the answer is { program, version } or null.
export function findFfmpeg() {
  found ??= (async () => {
    for (const program of candidates()) {
      try {
        const out = await run(program, ['-hide_banner', '-version'], { timeout: 8000 });
        return { program, version: out.split('\n')[0].trim().slice(0, 120) };
      } catch { /* try the next one */ }
    }
    return null;
  })();
  return found;
}
export const forgetFfmpeg = () => { found = undefined; };

// Arguments for one conversion. input and output are bare file names inside cwd, so the same
// command works for a Linux ffmpeg and for a Windows ffmpeg.exe started from WSL.
export function mp4Arguments({ input, output, start = 0, length = 0 }) {
  if (!/^[\w.-]+$/.test(input) || !/^[\w.-]+$/.test(output)) throw new Error('Invalid file name for conversion.');
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(length) || length < 0) throw new Error('Invalid trim points.');
  return [
    '-hide_banner', '-nostdin', '-y',
    ...(start > 0 ? ['-ss', start.toFixed(3)] : []),
    '-i', input,
    ...(length > 0 ? ['-t', length.toFixed(3)] : []),
    '-map', '0:v:0', '-map', '0:a:0?',
    // Browser recordings have uneven frame timing; a steady 30 fps plays everywhere.
    '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart',
    output,
  ];
}

export async function makeMp4({ cwd, input, output, start, length }) {
  const tool = await findFfmpeg();
  if (!tool) throw Object.assign(new Error('FFmpeg is not installed, so the take cannot be converted here.'), { status: 503 });
  await run(tool.program, mp4Arguments({ input, output, start, length }), { cwd, timeout: 15 * 60 * 1000 });
}

// Scene audio saved as MP3 instead of WAV. Same rules as above: bare file names inside cwd.
export function mp3Arguments({ input, output }) {
  if (!/^[\w.-]+$/.test(input) || !/^[\w.-]+$/.test(output)) throw new Error('Invalid file name for conversion.');
  return ['-hide_banner', '-nostdin', '-y', '-i', input, '-codec:a', 'libmp3lame', '-q:a', '2', output];
}

export async function makeMp3({ cwd, input, output }) {
  const tool = await findFfmpeg();
  if (!tool) throw Object.assign(new Error('FFmpeg is not installed, so the audio cannot be saved as MP3.'), { status: 503 });
  await run(tool.program, mp3Arguments({ input, output }), { cwd, timeout: 10 * 60 * 1000 });
}
