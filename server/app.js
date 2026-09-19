import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, unlink, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { decodeWav, encodeWav, wavHeader, SAMPLE_RATE } from './audio.js';
import { createCastingAI } from './casting-ai.js';
import { createProjectStore, validateRenderKey } from './projects.js';
import { CONNECTIONS_FILE, DEFAULT_CONNECTIONS, saveConnections, validateConnections, writeWhole } from './connections.js';
import { createSecrets, SECRETS_FILE } from './secrets.js';
import { ENGINES, TEXT_ENGINES, hostedText, hostedVoices } from './hosted.js';
import { findFfmpeg } from './video.js';

// Set only inside the desktop app's main process, where the PDF worker runs as a utility process.
const utilityProcess = process.versions.electron && process.type === 'browser' ? (await import('electron')).utilityProcess : null;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
// Projects, cache and voice samples. The desktop app points this at the user's own folder,
// because an installed app cannot write next to its code. The built page is always read from ROOT.
const HOME = process.env.SCRIPT_GLOW_HOME ? path.resolve(process.env.SCRIPT_GLOW_HOME) : ROOT;
const ID = /^[a-f0-9-]{36}$/;
const loopback = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
// A send error names the full local path. The page gets a plain sentence instead.
const missing = error => error.status === 404 || error.code === 'ENOENT' ? fail('That file is no longer on this computer.', 404) : error;
function localUrl(value) { try { const url = new URL(value); return url.protocol === 'http:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && loopback(url.hostname); } catch { return false; } }
function string(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }

// TTS requests stay short: long speeches are split at sentence boundaries (then
// at spaces for run-on sentences) and joined back under one cue. Text under the
// limit is sent unchanged, so existing line-cache entries still match.
export function speechChunks(text, max = 1000) {
  if (text.length <= max) return [text];
  const pieces = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map(part => part.segment.trim()).filter(Boolean)
    .flatMap(sentence => sentence.length <= max ? [sentence] : sentence.split(/\s+/));
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
  if (!res.ok) {
    // Keep the service's own short reason; hosted callers remove the key before showing it.
    let detail = '';
    try { const text = (await res.text()).slice(0, 4000); const body = JSON.parse(text); detail = String(body?.error?.message ?? body?.detail ?? body?.message ?? (typeof body?.error === 'string' ? body.error : '')).slice(0, 300); } catch { /* not JSON */ }
    throw Object.assign(fail(`Local voice service returned HTTP ${res.status}.`, 502), { detail });
  }
  if (Number(res.headers.get('content-length')) > max) { await res.body.cancel(); throw fail('Local service response too large.', 502); }
  const chunks = []; let size = 0;
  for await (const chunk of res.body) { size += chunk.length; if (size > max) throw fail('Local service response too large.', 502); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

export function createApp({ cacheDir = path.join(HOME, '.cache'), projectsDir = path.resolve(cacheDir) === path.join(HOME, '.cache') ? path.join(HOME, 'data', 'projects') : path.join(cacheDir, 'projects'), previewDir = path.join(HOME, 'data', 'voice-previews'), connections = DEFAULT_CONNECTIONS, connectionsFile = CONNECTIONS_FILE, secretsFile = SECRETS_FILE, serviceFetch = fetchBounded, firstRunScreen = false } = {}) {
  const secrets = createSecrets(secretsFile);
  const hosted = hostedVoices({ serviceFetch, secrets }), hostedModels = hostedText({ serviceFetch, secrets });
  // The profile can be rewritten from the Settings screen, so every use reads it live.
  let profile = validateConnections(connections);
  const TTS_URL = () => profile.chatterbox.url, STT_URL = () => profile.whisperx.url;
  const engine = () => profile.voice.engine, isHosted = () => engine() !== 'chatterbox';
  // One secret per launch. A page on another local port cannot read our responses, so it cannot
  // learn this, and without it no write is accepted from a browser.
  const session = randomUUID();
  // A voice server on another machine asks for a token. It is kept with the keys, never in the profile.
  const voiceAuth = async () => { const token = await secrets.get('chatterbox'); return token ? { 'x-voice-token': token } : {}; };
  const voiceRefused = error => /HTTP 401/.test(error?.message ?? '');
  const VOICE_TOKEN_HELP = 'The voice server refused the token. Check "Voice server token" under Keys for paid services in Settings.';
  const previewFile = path.resolve(previewDir, 'actor-preview.wav');
  // Re-recording keeps the voice's name, so lines made with the old recording must not be reused.
  const sampleStamp = async () => { try { return (await stat(previewFile)).mtimeMs; } catch { return 0; } };
  async function hasPrivatePreview() {
    if (!profile.casting.preferredActorVoice) return false;
    try { return (await stat(previewFile)).isFile(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  const app = express();
  const projects = createProjectStore(projectsDir, cacheDir);
  const jobs = new Map(), queue = [];
  let draining = false, activeImports = 0;
  const castingAI = createCastingAI({ serviceFetch, isRendering: () => draining || queue.length > 0, ollamaUrl: () => profile.ollama.url, engine: () => profile.names.engine, hosted: hostedModels,
    model: () => profile.names.engine === 'ollama' ? profile.ollama.model : profile.names.model || TEXT_ENGINES[profile.names.engine].model });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!localUrl(`http://${req.headers.host}`)) return res.status(403).json({ error: 'Script Glow only accepts loopback hosts.' });
    if (req.headers.origin && !localUrl(req.headers.origin)) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // No other page may frame the app (a click on Delete must be the user's own).
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const binaryRestore = req.method === 'POST' && req.path === '/api/projects/restore';
    // A take is posted as its own recording, so it is the second body that is not JSON.
    const takeUpload = req.method === 'POST' && /^\/api\/projects\/[^/]+\/takes$/.test(req.path);
    // A recording of the actor's own voice, already turned into WAV by the page.
    const voiceUpload = req.method === 'POST' && req.path === '/api/voices/mine';
    if (voiceUpload && !req.is('audio/wav')) return res.status(415).json({ error: 'Send your voice as audio/wav.' });
    if (binaryRestore && !req.is('application/octet-stream')) return res.status(415).json({ error: 'Use application/octet-stream for project backups.' });
    if (takeUpload && !req.is('video/webm') && !req.is('video/mp4')) return res.status(415).json({ error: 'A take must be recorded as video/webm or video/mp4.' });
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !binaryRestore && !takeUpload && !voiceUpload && !req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
    // A page on another local port can send a request but cannot read our replies, so it cannot
    // learn this launch's secret. Requests with no Origin are not browsers and are left alone.
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin && req.headers['x-script-glow-session'] !== session)
      return res.status(403).json({ error: 'This page is out of date. Reload Script Glow and try again.' });
    next();
  });
  app.use(express.json({ limit: '15mb' }));
  app.get('/api/session', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ session }); });
  app.get('/api/connections', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // A new install has no profile file yet. Any save writes one, so the welcome shows until then.
    const firstRun = firstRunScreen && !(await stat(connectionsFile).then(() => true, () => false));
    res.json({ firstRun, ...profile, casting: { ...profile.casting, ...(await hasPrivatePreview() ? { previewUrl: '/private-voice-preview.wav' } : {}) }, adapters: { chatterbox: 'named-voice-wav-v1', whisperx: 'multipart-transcriptions-v1', ollama: 'generate-v1' }, engines: Object.fromEntries(Object.entries(ENGINES).map(([name, spec]) => [name, { label: spec.label, model: spec.model, models: spec.models }])), textEngines: Object.fromEntries(Object.entries(TEXT_ENGINES).map(([name, spec]) => [name, { label: spec.label, model: spec.model, models: spec.models }])) });
  });
  app.put('/api/connections', async (req, res) => {
    // Changing the engine in the middle of a render would mix two voices into one scene.
    if (draining || queue.length > 0 || castingAI.busy) return res.status(409).json({ error: 'Audio is being made right now. Wait for it to finish, then save.' });
    // A rejected profile is the caller's mistake and its reason belongs on screen, not in a log.
    try { profile = await saveConnections(connectionsFile, { ...req.body, version: 1 }); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid connection settings.' }); }
    res.json({ ...profile, adapters: { chatterbox: 'named-voices', whisperx: 'multipart-transcribe', ollama: 'installed-models' } });
  });
  // A key goes in and never comes back out. The browser sees only whether one is set and a hint.
  const keyRoute = work => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await work(req)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'The key could not be changed.' }); }
  };
  app.get('/api/secrets', keyRoute(async () => ({ secrets: await secrets.list() })));
  app.put('/api/secrets/:provider', keyRoute(req => secrets.set(req.params.provider, req.body?.key)));
  app.delete('/api/secrets/:provider', keyRoute(req => secrets.remove(req.params.provider)));
  // Bounded checks only: list what is already there. Nothing is synthesized and nothing is downloaded.
  app.post('/api/connections/test', async (req, res) => {
    // "only" names the card being checked. It is not part of the profile, so it never reaches
    // the validator, which refuses every key it does not know.
    const { only: requested, ...candidate } = req.body ?? {};
    let tried;
    try { tried = validateConnections({ ...DEFAULT_CONNECTIONS, ...candidate, version: 1 }); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid connection settings.' }); }
    const probe = async (label, url, read) => {
      try { return { service: label, url, ok: true, detail: await read(url) }; }
      catch (error) { return { service: label, url, ok: false, detail: error instanceof Error ? error.message : String(error) }; }
    };
    const list = async url => {
      let body;
      try { body = await serviceFetch(`${url}/v1/voices`, { headers: await voiceAuth(), signal: AbortSignal.timeout(5000) }, 100000); }
      catch (error) { throw voiceRefused(error) ? new Error(VOICE_TOKEN_HELP) : error; }
      const voices = JSON.parse(body.toString('utf8'));
      const names = Array.isArray(voices) ? voices : voices.voices;
      if (!Array.isArray(names)) throw new Error('That server did not answer with a list of voices.');
      return `${names.length} voices`;
    };
    const models = async url => {
      const body = JSON.parse((await serviceFetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) }, 100000)).toString('utf8'));
      const names = (body.models ?? []).map(item => item.name).filter(name => typeof name === 'string');
      return names.length ? `${names.length} models installed: ${names.slice(0, 6).join(', ')}` : 'No models installed yet.';
    };
    const alive = async url => { await serviceFetch(`${url}/health`, { signal: AbortSignal.timeout(5000) }, 100000); return 'Answering.'; };
    // One card at a time when asked, so a check says something about the server next to it.
    const checks = { names: () => tried.names.engine === 'ollama' ? probe('names', tried.ollama.url, models) : probe('names', TEXT_ENGINES[tried.names.engine].label, () => hostedModels.check(tried.names.engine)), voice: () => tried.voice.engine === 'chatterbox' ? probe('voice', tried.chatterbox.url, list) : probe('voice', ENGINES[tried.voice.engine].label, () => hosted.check(tried.voice.engine)), chatterbox: () => probe('chatterbox', tried.chatterbox.url, list), ollama: () => probe('ollama', tried.ollama.url, models), whisperx: () => probe('whisperx', tried.whisperx.url, alive) };
    const only = typeof requested === 'string' ? requested : '';
    if (only && !Object.hasOwn(checks, only)) return res.status(400).json({ error: 'There is no such service to check.' });
    res.json({ results: await Promise.all((only ? [only] : Object.keys(checks).filter(name => name !== 'voice' && name !== 'names')).map(name => checks[name]())) });
  });
  app.get('/private-voice-preview.wav', async (req, res, next) => {
    if (!await hasPrivatePreview()) throw fail('Private voice preview is not configured.', 404);
    res.setHeader('Cache-Control', 'private, no-store');
    // Sent from memory (it is at most 30 seconds): a stream would hold the file open, and Windows
    // then refuses to replace it when the voice is recorded again.
    let wav;
    try { wav = await readFile(previewFile); } catch (error) { return next(missing(error)); }
    res.type('audio/wav').send(wav);
  });
  app.get('/api/projects', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await projects.list()); });
  app.post('/api/projects', async (req, res) => { const project = await projects.create(req.body); res.location(`/api/projects/${project.id}`).status(201).json(project); });
  app.post('/api/projects/restore', async (req, res) => { const project = await projects.restore(req); res.location(`/api/projects/${project.id}`).status(201).json(project); });
  app.get('/api/projects/:id', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await projects.get(req.params.id)); });
  app.put('/api/projects/:id', async (req, res) => res.json(await projects.update(req.params.id, req.body)));
  app.delete('/api/projects/:id', async (req, res) => res.json(await projects.remove(req.params.id)));
  app.post('/api/projects/:id/renders', async (req, res) => {
    const url = req.body?.result?.fullUrl;
    const cachedJob = typeof url === 'string' ? jobs.get(url.slice(7, 43)) : undefined;
    if (cachedJob && cachedJob.status !== 'complete') throw fail('Only completed renders can be saved.', 409);
    res.json(await projects.attach(req.params.id, req.body?.key, req.body?.result));
  });
  app.get('/api/projects/:id/audio/:filename', async (req, res, next) => {
    const filename = await projects.audioPath(req.params.id, req.params.filename); res.type('audio/wav');
    res.sendFile(path.basename(filename), { root: path.dirname(filename) }, error => { if (error) next(missing(error)); });
  });
  // Takes are the actor's own recording of themselves. They stay on this machine, are never sent
  // anywhere, and are left out of project backups so a routine export stays small and shareable.
  app.get('/api/projects/:id/takes', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ takes: await projects.takes(req.params.id) }); });
  app.post('/api/projects/:id/takes', async (req, res) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    const entry = await projects.addTake(req.params.id, req, { type, sceneId: String(req.query.scene || ''), label: String(req.query.label || ''), ms: Number(req.query.ms), kind: String(req.query.kind || 'scene') });
    res.status(201).json(entry);
  });
  app.get('/api/projects/:id/takes/:file', async (req, res, next) => {
    const { path: filename, entry } = await projects.takePath(req.params.id, req.params.file);
    res.type(entry.file.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
    // The stored name is a generated id; the actor gets their own name on the saved file.
    // A name asked for by the page (for example Name_Project_Scene) is cleaned before it is used.
    const wanted = typeof req.query.name === 'string' && req.query.name ? req.query.name : entry.label;
    if (req.query.download !== undefined) res.attachment(`${wanted.replace(/[^\w .-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'take'}.${entry.file.split('.').pop()}`);
    res.sendFile(path.basename(filename), { root: path.dirname(filename) }, error => { if (error) next(missing(error)); });
  });
  app.post('/api/projects/:id/takes/:file/mp4', async (req, res) => res.status(201).json(await projects.exportTake(req.params.id, req.params.file, { start: Number(req.body?.start ?? 0), end: Number(req.body?.end ?? 0) })));
  // What this machine can do with a take. Only whether FFmpeg answered, and its version line.
  app.get('/api/tools', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); const ffmpeg = await findFfmpeg(); res.json({ ffmpeg: !!ffmpeg, ffmpegVersion: ffmpeg?.version ?? '' }); });
  app.patch('/api/projects/:id/takes/:file', async (req, res) => res.json(await projects.renameTake(req.params.id, req.params.file, req.body?.label)));
  app.delete('/api/projects/:id/takes/:file', async (req, res) => res.json(await projects.deleteTake(req.params.id, req.params.file)));
  app.get('/api/projects/:id/backup', async (req, res) => projects.backup(req.params.id, res));
  app.get('/api/projects/:id/backup-info', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await projects.backupInfo(req.params.id)); });
  // Hosted engines also say who each voice is, so casting can match voices to characters.
  async function getVoices() {
    if (isHosted()) { const list = await hosted.voices(engine()); return { voices: list.map(item => item.id), details: Object.fromEntries(list.map(({ id, ...rest }) => [id, rest])) }; }
    let values;
    try { values = JSON.parse((await serviceFetch(`${TTS_URL()}/v1/voices`, { headers: await voiceAuth(), signal: AbortSignal.timeout(5000) }, 100000)).toString()); }
    catch (error) { throw fail(voiceRefused(error) ? VOICE_TOKEN_HELP : 'Chatterbox is unavailable. Check the configured voice service.', 503); }
    values = Array.isArray(values) ? values : values?.voices;
    if (!Array.isArray(values) || values.some(value => !string(value, 100))) throw fail('Chatterbox returned an invalid voice list.', 502);
    return { voices: values, details: {} };
  }
  app.get('/api/health', async (req, res) => {
    const check = async url => { try { await serviceFetch(`${url}/health`, { signal: AbortSignal.timeout(3000) }, 10000); return { ok: true }; } catch { return { ok: false }; } };
    // A hosted engine is not pinged on every poll: having a key is what "ready" means there.
    const [tts, stt] = await Promise.all([isHosted() ? secrets.get(engine()).then(key => ({ ok: !!key, engine: engine() })) : check(TTS_URL()), check(STT_URL())]);
    res.json({ tts, stt });
  });
  app.get('/api/voices', async (req, res) => res.json({ engine: engine(), ...await getVoices() }));
  // A hosted voice has no sample on disk, so one short line is made and cached. It is paid for once
  // per voice. It is a GET that spends money, so it asks for this launch's secret like a write does.
  // Your own voice: sent to Chatterbox as a reference recording, kept here as your private sample,
  // and chosen for your role. Another voice with the same name is never replaced.
  app.post('/api/voices/mine', express.raw({ type: 'audio/wav', limit: '10mb' }), async (req, res) => {
    if (draining || queue.length > 0 || castingAI.busy) throw fail('Audio is being made right now. Wait for it to finish, then save your voice.', 409);
    const name = String(req.query.name ?? '');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(name) || name === 'default') throw fail('Name your voice with letters, numbers, - and _ only, for example MyVoice.');
    let pcm;
    try { pcm = decodeWav(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)); } catch { throw fail('That recording could not be read. Record again, or choose a WAV file.'); }
    const seconds = pcm.length / 2 / SAMPLE_RATE;
    if (seconds < 5 || seconds > 30) throw fail(`Your voice needs 5 to 30 seconds of speech. This recording is ${seconds.toFixed(1)} seconds.`);
    let existing = [];
    try { existing = JSON.parse((await serviceFetch(`${TTS_URL()}/v1/voices`, { headers: await voiceAuth(), signal: AbortSignal.timeout(5000) }, 100000)).toString()).voices ?? []; }
    catch (error) { throw fail(voiceRefused(error) ? VOICE_TOKEN_HELP : 'Chatterbox cannot be reached, so your voice cannot be added. Check its address in Settings.', 503); }
    // Windows and macOS file names ignore case, so "stock-mica" would replace Stock-Mica.wav.
    const same = value => String(value).toLowerCase() === name.toLowerCase();
    if (existing.some(same) && !same(profile.casting.preferredActorVoice)) throw fail(`Chatterbox already has a voice named ${name}. Choose another name.`, 409);
    const wav = encodeWav(pcm);
    try { await serviceFetch(`${TTS_URL()}/v1/voices/${name}?replace=true`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav', ...await voiceAuth() }, body: wav, signal: AbortSignal.timeout(30000) }, 100000); }
    catch (error) {
      const status = /HTTP (\d{3})/.exec(error?.message ?? '')?.[1];
      throw fail(status === '401' ? VOICE_TOKEN_HELP : status === '404' || status === '405' ? 'This Chatterbox server is too old to accept a voice. Update voice-server/server.py on that machine and restart it.' : status === '403' ? 'This Chatterbox server has new voices turned off (VOICE_UPLOADS=off).' : 'Chatterbox did not accept the recording. Try again.', 502);
    }
    await writeWhole(previewFile, wav, 0o600);
    if (profile.casting.preferredActorVoice !== name) profile = await saveConnections(connectionsFile, { ...profile, casting: { ...profile.casting, preferredActorVoice: name } });
    res.json({ voice: name, seconds: Math.round(seconds * 10) / 10, previewUrl: '/private-voice-preview.wav' });
  });
  app.get('/api/voices/preview', async (req, res) => {
    if (req.query.session !== session) throw fail('This page is out of date. Reload Script Glow and try again.', 403);
    const voice = String(req.query.voice ?? '');
    if (!isHosted() || !(await getVoices()).voices.includes(voice)) throw fail('There is no such voice to preview.', 404);
    res.setHeader('Cache-Control', 'no-store');
    res.type('audio/wav').send(encodeWav(await lineAudio('Hello. This is how I sound when I read your scene with you.', voice)));
  });
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
      // The desktop app cannot run its own binary as Node (the RunAsNode fuse is off), so there the
      // worker is an Electron utility process. It is unpacked from the app archive and read from there.
      const workerFile = fileURLToPath(new URL('./pdf-worker.js', import.meta.url)).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      // Both cap the worker's heap at 256 MB: a utility process takes V8 flags only through --js-flags.
      const worker = utilityProcess
        ? utilityProcess.fork(workerFile, [], { execArgv: ['--js-flags=--max-old-space-size=256'], stdio: 'ignore', serviceName: 'Script Glow PDF import' })
        : fork(workerFile, [], { execArgv: ['--max-old-space-size=256'], serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
      let received = false;
      const timer = setTimeout(() => { worker.kill(); reject(fail('PDF extraction timed out. Try a smaller PDF or paste text.', 422)); }, 30000);
      // A utility process keeps running after it answers, so it is stopped once the answer is in.
      worker.once('message', message => { received = true; clearTimeout(timer); if (utilityProcess) worker.kill(); message.error ? reject(fail(message.error, 422)) : resolve(message.text); });
      worker.once('error', () => { clearTimeout(timer); reject(fail('Could not extract this PDF. Try an unlocked text PDF or paste text.', 422)); });
      worker.once('exit', () => { if (!received) { clearTimeout(timer); reject(fail('PDF extraction stopped. Try a smaller PDF or paste text.', 422)); } });
      utilityProcess ? worker.postMessage(data) : worker.send(data);
    }); } finally { activeImports--; }
    res.json({ text });
  });
  async function pruneCache(folder, maxBytes, protectedNames = []) {
    const dir = path.join(cacheDir, folder);
    const entries = await readdir(dir, { withFileTypes: true });
    // Two prunes can run at once (a preview beside a render), so a file can vanish under either one.
    const gone = error => { if (error.code !== 'ENOENT') throw error; };
    const files = (await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.wav')).map(async entry => {
      const info = await stat(path.join(dir, entry.name)).catch(gone);
      return info && { name: entry.name, size: info.size, mtimeMs: info.mtimeMs };
    }))).filter(Boolean);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= maxBytes) break;
      if (protectedNames.includes(file.name)) continue;
      await unlink(path.join(dir, file.name)).catch(gone); total -= file.size;
    }
  }
  async function lineAudio(text, voice) {
    const model = profile.voice.model || ENGINES[engine()]?.model || '';
    const identity = isHosted() ? { version: 3, engine: engine(), model, text, voice } : profile.chatterbox.legacyCache ? { version: 1, text, voice } : { version: 2, namespace: profile.chatterbox.cacheNamespace, url: TTS_URL(), text, voice, ...(voice === profile.casting.preferredActorVoice && await sampleStamp() ? { sample: await sampleStamp() } : {}) };
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    const filename = path.join(cacheDir, 'lines', `${key}.wav`);
    try { return decodeWav(await readFile(filename)); } catch { /* Missing or corrupt cache: regenerate. */ }
    const pcm = isHosted()
      ? decodeWav(encodeWav(await hosted.speak(engine(), model, voice, text)))
      : decodeWav(await serviceFetch(`${TTS_URL()}/v1/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...await voiceAuth() }, body: JSON.stringify({ text, voice }), signal: AbortSignal.timeout(180000) }).catch(error => { throw voiceRefused(error) ? fail(VOICE_TOKEN_HELP, 502) : error; }));
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
    const input = validateRender(req.body, (await getVoices()).voices);
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
