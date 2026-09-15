import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, unlink, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { decodeWav, encodeWav, wavHeader, SAMPLE_RATE } from './audio.js';
import { createCastingAI } from './casting-ai.js';
import { createProjectStore, validateRenderKey } from './projects.js';
import { DEFAULT_CONNECTIONS, validateConnections } from './connections.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ID = /^[a-f0-9-]{36}$/;
const loopback = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
function localUrl(value) { try { const url = new URL(value); return url.protocol === 'http:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && loopback(url.hostname); } catch { return false; } }
function string(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }

// TTS requests stay short: long speeches are split at sentence boundaries (then
// at spaces for run-on sentences) and joined back under one cue. Text under the
// limit is sent unchanged, so existing line-cache entries still match.
export function speechChunks(text, max = 1000) {
  if (text.length <= max) return [text];
  const pieces = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map(part => part.segment.trim()).filter(Boolean)
    .flatMap(sentence => sentence.length <= max ? [sentence] : sentence.split(/s+/));
  const chunks = [];
  for (const piece of pieces) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + 1 + piece.length <= max) chunks[chunks.length - 1] = `${last} ${piece}`;
    else for (let i = 0; i < piece.length; i += max) chunks.push(piece.slice(i, i + max));
  }
  return chunks;
}

export function validateRender(body, availableVoices) {
  if (!body || typeof body !== 'object' || !body.scene || !string(body.scene.id, 100) || !string(body.scene.title, 300)) throw fail('A valid scene id and title are required.');
  const { scene, voices, myCharacter, gapSeconds, includeDirections, scope = 'scene' } = body;
  if (!['scene', 'script'].includes(scope)) throw fail('Render scope must be scene or script.');
  const script = scope === 'script';
  if (!Array.isArray(scene.lines) || scene.lines.length === 0 || scene.lines.length > (script ? 5000 : 300)) throw fail(script ? 'Choose a script with 1–5,000 lines.' : 'Choose a scene with 1–300 lines.');
  if (!voices || typeof voices !== 'object' || Array.isArray(voices) || !string(myCharacter, 100) || typeof includeDirections !== 'boolean' || typeof gapSeconds !== 'number' || !Number.isFinite(gapSeconds) || gapSeconds < 0 || gapSeconds > 5) throw fail('Invalid cast or rehearsal settings.');
  const ids = new Set(); let textLength = 0;
  for (const line of scene.lines) {
    if (!line || !string(line.id, 100) || ids.has(line.id) || !string(line.character, 100) || !string(line.text, 20000) || !['dialogue', 'direction'].includes(line.kind)) throw fail('Every line needs a unique id, character, and 1–20,000 characters of text.');
    ids.add(line.id); textLength += line.text.length;
    if ((line.kind === 'dialogue' || includeDirections) && (!Object.hasOwn(voices, line.character) || !availableVoices.includes(voices[line.character]))) throw fail(`Choose an available voice for ${line.character}.`);
  }
  if (textLength > (script ? 500000 : 60000)) throw fail(script ? 'Script exceeds 500,000 characters. Render individual scenes.' : 'Scene exceeds 60,000 characters. Split it into smaller scenes.');
  if (!scene.lines.some(line => line.kind === 'dialogue' || includeDirections)) throw fail('This scene has no lines to render.');
  return { scene, voices, myCharacter, gapSeconds, includeDirections, scope };
}

async function fetchBounded(url, options = {}, max = 25 * 1024 * 1024) {
  const res = await fetch(url, { ...options, redirect: 'error' });
  if (!res.ok) throw fail(`Local voice service returned HTTP ${res.status}.`, 502);
  if (Number(res.headers.get('content-length')) > max) { await res.body.cancel(); throw fail('Local service response too large.', 502); }
  const chunks = []; let size = 0;
  for await (const chunk of res.body) { size += chunk.length; if (size > max) throw fail('Local service response too large.', 502); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

export function createApp({ cacheDir = path.join(ROOT, '.cache'), projectsDir = path.resolve(cacheDir) === path.join(ROOT, '.cache') ? path.join(ROOT, 'data', 'projects') : path.join(cacheDir, 'projects'), previewDir = path.join(ROOT, 'data', 'voice-previews'), connections = DEFAULT_CONNECTIONS, serviceFetch = fetchBounded } = {}) {
  const profile = validateConnections(connections);
  const TTS_URL = profile.chatterbox.url, STT_URL = profile.whisperx.url;
  const previewFile = path.resolve(previewDir, 'actor-preview.wav');
  async function hasPrivatePreview() {
    if (!profile.casting.preferredActorVoice) return false;
    try { return (await stat(previewFile)).isFile(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  const app = express();
  const projects = createProjectStore(projectsDir, cacheDir);
  const jobs = new Map(), queue = [];
  let draining = false, activeImports = 0;
  const castingAI = createCastingAI({ serviceFetch, isRendering: () => draining || queue.length > 0, ollamaUrl: profile.ollama.url, model: profile.ollama.model });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!localUrl(`http://${req.headers.host}`)) return res.status(403).json({ error: 'Script Glow only accepts loopback hosts.' });
    if (req.headers.origin && !localUrl(req.headers.origin)) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const binaryRestore = req.method === 'POST' && req.path === '/api/projects/restore';
    if (binaryRestore && !req.is('application/octet-stream')) return res.status(415).json({ error: 'Use application/octet-stream for project backups.' });
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !binaryRestore && !req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
    next();
  });
  app.use(express.json({ limit: '15mb' }));
  app.get('/api/connections', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...profile, casting: { ...profile.casting, ...(await hasPrivatePreview() ? { previewUrl: '/private-voice-preview.wav' } : {}) }, adapters: { chatterbox: 'named-voice-wav-v1', whisperx: 'multipart-transcriptions-v1', ollama: 'generate-v1' } });
  });
  app.get('/private-voice-preview.wav', async (req, res, next) => {
    if (!await hasPrivatePreview()) throw fail('Private voice preview is not configured.', 404);
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('audio/wav').sendFile('actor-preview.wav', { root: path.dirname(previewFile) }, error => { if (error) next(error); });
  });
  app.get('/api/projects', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await projects.list()); });
  app.post('/api/projects', async (req, res) => { const project = await projects.create(req.body); res.location(`/api/projects/${project.id}`).status(201).json(project); });
  app.post('/api/projects/restore', async (req, res) => { const project = await projects.restore(req); res.location(`/api/projects/${project.id}`).status(201).json(project); });
  app.get('/api/projects/:id', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await projects.get(req.params.id)); });
  app.put('/api/projects/:id', async (req, res) => res.json(await projects.update(req.params.id, req.body)));
  app.post('/api/projects/:id/renders', async (req, res) => {
    const url = req.body?.result?.fullUrl;
    const cachedJob = typeof url === 'string' ? jobs.get(url.slice(7, 43)) : undefined;
    if (cachedJob && cachedJob.status !== 'complete') throw fail('Only completed renders can be saved.', 409);
    res.json(await projects.attach(req.params.id, req.body?.key, req.body?.result));
  });
  app.get('/api/projects/:id/audio/:filename', async (req, res, next) => {
    const filename = await projects.audioPath(req.params.id, req.params.filename); res.type('audio/wav');
    res.sendFile(filename, error => { if (error) next(error); });
  });
  app.get('/api/projects/:id/backup', async (req, res) => projects.backup(req.params.id, res));
  app.get('/api/projects/:id/backup-info', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await projects.backupInfo(req.params.id)); });
  async function getVoices() {
    let values;
    try { values = JSON.parse((await serviceFetch(`${TTS_URL}/v1/voices`, { signal: AbortSignal.timeout(5000) }, 100000)).toString()); }
    catch { throw fail('Chatterbox is unavailable. Check the configured voice service.', 503); }
    values = Array.isArray(values) ? values : values?.voices;
    if (!Array.isArray(values) || values.some(value => !string(value, 100))) throw fail('Chatterbox returned an invalid voice list.', 502);
    return values;
  }
  app.get('/api/health', async (req, res) => {
    const check = async url => { try { await serviceFetch(`${url}/health`, { signal: AbortSignal.timeout(3000) }, 10000); return { ok: true }; } catch { return { ok: false }; } };
    const [tts, stt] = await Promise.all([check(TTS_URL), check(STT_URL)]);
    res.json({ tts, stt });
  });
  app.get('/api/voices', async (req, res) => res.json({ voices: await getVoices() }));
  app.post('/api/casting/guess-genders', async (req, res) => res.json(await castingAI.guess(req.body)));
  app.post('/api/import', async (req, res) => {
    if (!string(req.body?.name, 300) || typeof req.body?.data !== 'string' || req.body.data.length > 14000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(req.body.data)) throw fail('Upload a PDF smaller than 10 MB.');
    const data = Buffer.from(req.body.data, 'base64');
    if (data.length > 10 * 1024 * 1024 || data.subarray(0, 5).toString() !== '%PDF-') throw fail('This is not a valid PDF smaller than 10 MB.');
    if (activeImports >= 2) throw fail('Two PDFs are already importing. Wait for an import to finish.', 429);
    activeImports++;
    let text;
    try { text = await new Promise((resolve, reject) => {
      // PDF.js loads native canvas helpers. A subprocess isolates native runtime
      // failures and teardown from the API process (worker threads do not).
      const worker = fork(new URL('./pdf-worker.js', import.meta.url), [], {
        execArgv: ['--max-old-space-size=256'], serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      });
      let received = false;
      const timer = setTimeout(() => { worker.kill(); reject(fail('PDF extraction timed out. Try a smaller PDF or paste text.', 422)); }, 30000);
      worker.once('message', message => { received = true; clearTimeout(timer); message.error ? reject(fail(message.error, 422)) : resolve(message.text); });
      worker.once('error', () => { clearTimeout(timer); reject(fail('Could not extract this PDF. Try an unlocked text PDF or paste text.', 422)); });
      worker.once('exit', () => { if (!received) { clearTimeout(timer); reject(fail('PDF extraction stopped. Try a smaller PDF or paste text.', 422)); } });
      worker.send(data);
    }); } finally { activeImports--; }
    res.json({ text });
  });
  async function pruneCache(folder, maxBytes, protectedNames = []) {
    const dir = path.join(cacheDir, folder);
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.wav')).map(async entry => ({ name: entry.name, ...(await stat(path.join(dir, entry.name))) })));
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= maxBytes) break;
      if (protectedNames.includes(file.name)) continue;
      await unlink(path.join(dir, file.name)); total -= file.size;
    }
  }
  async function lineAudio(text, voice) {
    const identity = profile.chatterbox.legacyCache ? { version: 1, text, voice } : { version: 2, namespace: profile.chatterbox.cacheNamespace, url: TTS_URL, text, voice };
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    const filename = path.join(cacheDir, 'lines', `${key}.wav`);
    try { return decodeWav(await readFile(filename)); } catch { /* Missing or corrupt cache: regenerate. */ }
    const data = await serviceFetch(`${TTS_URL}/v1/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }), signal: AbortSignal.timeout(180000) });
    const pcm = decodeWav(data);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, encodeWav(pcm));
    await pruneCache('lines', 512 * 1024 * 1024, [path.basename(filename)]);
    return pcm;
  }
  // FileHandle.write may complete with a partial write. Explicit positions also
  // let us patch RIFF sizes without disturbing the PCM append position.
  async function writeAll(handle, buffer, position) {
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position + offset);
      if (!bytesWritten) throw new Error('Could not write audio export.');
      offset += bytesWritten;
    }
  }
  async function renderTracks(job, ownedFiles) {
    const dir = path.join(cacheDir, 'renders');
    await mkdir(dir, { recursive: true });
    const tracks = ['full', 'practice'].map(variant => ({
      temporary: path.join(dir, `${job.id}-${variant}.wav.part`),
      filename: path.join(dir, `${job.id}-${variant}.wav`),
      handle: null,
    }));
    const checkCancelled = () => { if (job.cancelled) throw new Error('Render cancelled.'); };
    const gap = Buffer.alloc(Math.round(job.input.gapSeconds * SAMPLE_RATE) * 2);
    const maxSeconds = job.input.scope === 'script' ? 7200 : 1800;
    const cues = []; let samples = 0;
    try {
      for (const track of tracks) {
        track.handle = await open(track.temporary, 'wx');
        ownedFiles.add(track.temporary);
        await writeAll(track.handle, wavHeader(0), 0);
      }
      for (const line of job.input.scene.lines) {
        if (line.kind !== 'dialogue' && !job.input.includeDirections) continue;
        checkCancelled();
        const parts = [];
        for (const chunk of speechChunks(line.text)) {
          try { parts.push(await lineAudio(chunk, job.input.voices[line.character])); }
          catch (error) { error.message = `${line.character} (“${line.text.slice(0, 40)}…”): ${error.message}`; throw error; }
          checkCancelled();
        }
        const pcm = Buffer.concat(parts);
        checkCancelled();
        const nextSamples = samples + (pcm.length + gap.length) / 2;
        if (nextSamples > maxSeconds * SAMPLE_RATE) throw new Error(job.input.scope === 'script'
          ? 'Script exceeds the 120 minute export limit. Render individual scenes.'
          : 'Scene exceeds the 30 minute export limit. Split it into smaller scenes.');
        const position = 44 + samples * 2;
        const practice = line.kind === 'dialogue' && line.character === job.input.myCharacter ? Buffer.alloc(pcm.length) : pcm;
        await writeAll(tracks[0].handle, pcm, position);
        await writeAll(tracks[1].handle, practice, position);
        for (const track of tracks) await writeAll(track.handle, gap, position + pcm.length);
        cues.push({ lineId: line.id, character: line.character, start: samples / SAMPLE_RATE, end: (samples + pcm.length / 2) / SAMPLE_RATE });
        samples = nextSamples; job.completed++;
      }
      checkCancelled();
      for (const track of tracks) {
        await writeAll(track.handle, wavHeader(samples * 2), 0);
        await track.handle.close(); track.handle = null;
      }
      // Both files are complete before either receives a downloadable name.
      // /audio also hides this pair until the job has been marked complete.
      for (const track of tracks) {
        checkCancelled();
        await rename(track.temporary, track.filename);
        ownedFiles.delete(track.temporary); ownedFiles.add(track.filename);
      }
      checkCancelled();
      return { duration: samples / SAMPLE_RATE, cues };
    } finally {
      await Promise.all(tracks.filter(track => track.handle).map(track => track.handle.close()));
    }
  }
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        if (job.cancelled) { delete job.input; continue; }
        job.status = 'running';
        const ownedFiles = new Set();
        try {
          const rendered = await renderTracks(job, ownedFiles);
          await pruneCache('renders', 1024 * 1024 * 1024, [`${job.id}-full.wav`, `${job.id}-practice.wav`]);
          if (job.cancelled) continue;
          job.result = { fullUrl: `/audio/${job.id}-full.wav`, practiceUrl: `/audio/${job.id}-practice.wav`, duration: rendered.duration, cues: rendered.cues };
          if (job.projectId) job.result = (await projects.attach(job.projectId, job.renderKey, job.result, () => job.cancelled, true)).result;
          if (job.cancelled) { delete job.result; continue; }
          job.status = 'complete';
          ownedFiles.clear();
        } catch (error) {
          job.status = 'error';
          job.error = job.cancelled ? 'Render cancelled.' : error.name === 'TimeoutError' ? 'Chatterbox timed out after 180 seconds. Check the GPU service, then retry.' : error.message;
        } finally {
          delete job.input;
          // Only this unpublished job's exact owned paths can be removed.
          for (const filename of ownedFiles) {
            try { await unlink(filename); } catch (error) { if (error.code !== 'ENOENT') console.error('Could not clean render temporary file:', error.message); }
          }
        }
      }
    } finally { draining = false; }
  }
  app.post('/api/render', async (req, res) => {
    if (castingAI.busy) throw fail('Local AI is guessing character voice types. Wait for suggestions, then render.', 409);
    const input = validateRender(req.body, await getVoices());
    if (req.body.projectId !== undefined || req.body.renderKey !== undefined) {
      validateRenderKey(req.body.renderKey, input);
      await projects.get(req.body.projectId);
    }
    if (castingAI.busy) throw fail('Local AI is guessing character voice types. Wait for suggestions, then render.', 409);
    if ([...jobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length >= 4) throw fail('Render queue is full. Wait or cancel a job.', 429);
    // Keep bounded metadata; completed WAV exports remain on disk across restarts.
    if (jobs.size >= 100) { const expired = [...jobs.values()].find(job => ['complete', 'error'].includes(job.status)); if (expired) jobs.delete(expired.id); }
    const id = randomUUID();
    const job = { id, status: 'queued', completed: 0, total: input.scene.lines.filter(line => line.kind === 'dialogue' || input.includeDirections).length, input, cancelled: false, ...(req.body.projectId ? { projectId: req.body.projectId, renderKey: req.body.renderKey } : {}) };
    jobs.set(id, job); queue.push(job); res.status(202).json({ jobId: id }); void drain();
  });
  app.get('/api/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id); if (!job) throw fail('Render job not found. Render the scene again.', 404);
    const { input, cancelled, renderKey, ...publicJob } = job; res.json(publicJob);
  });
  app.post('/api/jobs/:id/cancel', (req, res) => {
    const job = jobs.get(req.params.id); if (!job) throw fail('Render job not found.', 404);
    if (['running', 'queued'].includes(job.status)) { job.cancelled = true; job.status = 'error'; job.error = 'Render cancelled.'; }
    res.json({ ok: true });
  });
  app.get('/audio/:filename', (req, res) => {
    if (!/^([a-f0-9-]{36})-(full|practice)\.wav$/.test(req.params.filename) || !ID.test(req.params.filename.slice(0, 36))) throw fail('Audio not found.', 404);
    const job = jobs.get(req.params.filename.slice(0, 36));
    if (job && job.status !== 'complete') throw fail('Audio export is not ready.', 404);
    res.setHeader('Content-Type', 'audio/wav');
    res.sendFile(req.params.filename, { root: path.join(cacheDir, 'renders') }, error => { if (error && !res.headersSent) res.status(404).json({ error: 'Audio export not found. Render the scene again.' }); });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use(express.static(path.join(ROOT, 'dist')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    res.status(status).json({ error: status === 413 ? 'Request is too large.' : error.type === 'entity.parse.failed' ? 'Invalid JSON request.' : status === 500 ? 'Local server error. Check the terminal and retry.' : error.message });
    if (status === 500) console.error(error);
  });
  return app;
}
