import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, readFile, readdir, lstat, open, copyFile, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { makeMp4 } from './video.js';
import { renameRetry } from './connections.js';

export const PROJECT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const AUDIO_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-(full|practice)\.wav$/;
const MAX_META = 32 * 1024 * 1024;
export const MAX_BACKUP = 4 * 1024 ** 3;
// A take is the actor's own recording. The name on disk is generated here, never taken from the
// browser, and the container must be one the page can actually produce.
const TAKE_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(webm|mp4)$/;
export const TAKE_TYPES = { 'video/webm': 'webm', 'video/mp4': 'mp4' };
export const MAX_TAKE = 512 * 1024 * 1024;
export const MAX_TAKES = 50;
// A slate is recorded on its own, as casting sites ask; everything else is a scene take.
export const TAKE_KINDS = ['scene', 'slate'];
const MAGIC = Buffer.from('SGLOWB01');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
function id(value) { if (!PROJECT_ID.test(value)) throw fail('Invalid project id.'); return value; }
function map(value, valid) {
  if (!object(value) || Object.keys(value).length > 1000 || Object.entries(value).some(([key, item]) => !text(key, 100) || !valid(item))) throw fail('Invalid project casting preferences.');
  return Object.fromEntries(Object.entries(value));
}
export function validatePreferences(value) {
  if (!object(value) || !text(value.source, 500000, true) || !text(value.name, 300) || !text(value.role, 100, true) || !text(value.sceneId, 100, true)) throw fail('Invalid project script or name.');
  if (!number(value.gap, 0, 5) || ![0.75, 1, 1.25, 1.5].includes(value.rate) || !['full', 'practice'].includes(value.mode) || ['directions', 'hide', 'follow', 'loop'].some(key => typeof value[key] !== 'boolean')) throw fail('Invalid project rehearsal settings.');
  for (const key of ['listen', 'hint', 'wait', 'autoContinue', 'build']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw fail('Invalid project rehearsal settings.');
  // How long the actor may pause before listening takes their line as finished: half second steps to 5 s.
  if (value.holdMs !== undefined && !(Number.isInteger(value.holdMs) && number(value.holdMs, 500, 5000) && value.holdMs % 500 === 0)) throw fail('Invalid project rehearsal settings.');
  for (const key of ['loopA', 'loopB']) if (value[key] !== undefined && !text(value[key], 100, true)) throw fail('Invalid project rehearsal settings.');
  if (value.buildRepeats !== undefined && !(Number.isInteger(value.buildRepeats) && number(value.buildRepeats, 1, 10))) throw fail('Invalid project rehearsal settings.');
  if (value.tapeOverlay !== undefined && typeof value.tapeOverlay !== 'boolean') throw fail('Invalid project rehearsal settings.');
  if (value.readerLevel !== undefined && !number(value.readerLevel, 0, 1.5)) throw fail('Invalid reader volume.');
  for (const key of ['tapeX', 'tapeY']) if (value[key] !== undefined && !number(value[key], 0, 100)) throw fail('Invalid script position.');
  for (const key of ['tapeW', 'tapeH']) if (value[key] !== undefined && !number(value[key], 0, 2000)) throw fail('Invalid script size.');
  if (value.highlightCharacter !== undefined && !text(value.highlightCharacter, 100, true)) throw fail('Invalid highlighted character.');
  for (const key of ['characterColor', 'spokenColor']) if (value[key] !== undefined && (typeof value[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value[key]))) throw fail('Invalid highlight color.');
  return { source: value.source, name: value.name, role: value.role,
    highlightCharacter: value.highlightCharacter ?? '@role', characterColor: (value.characterColor ?? '#60a5fa').toLowerCase(), spokenColor: (value.spokenColor ?? '#f2b544').toLowerCase(),
    cast: map(value.cast, item => text(item, 100, true)), guesses: map(value.guesses ?? {}, item => ['male', 'female', 'unknown'].includes(item)),
    genders: map(value.genders ?? {}, item => ['auto', 'male', 'female', 'unknown'].includes(item)), manualVoices: map(value.manualVoices ?? {}, item => typeof item === 'boolean'),
    // Say it like: how each character's name sounds, in plain spelling (shi-VAWN). One line of text.
    sayAs: map(value.sayAs ?? {}, item => text(item, 100) && !/[\u0000-\u001f\u007f]/.test(item)),
    sceneId: value.sceneId, gap: value.gap, directions: value.directions, hide: value.hide, listen: value.listen ?? false, hint: value.hint ?? false, wait: value.wait ?? false, autoContinue: value.autoContinue ?? false, holdMs: value.holdMs ?? 500, build: value.build ?? false, buildRepeats: value.buildRepeats ?? 2, loopA: value.loopA ?? '', loopB: value.loopB ?? '', readerLevel: value.readerLevel ?? 1, tapeOverlay: value.tapeOverlay ?? false, tapeX: value.tapeX ?? 50, tapeY: value.tapeY ?? 78, tapeW: value.tapeW ?? 0, tapeH: value.tapeH ?? 0, follow: value.follow, loop: value.loop, rate: value.rate, mode: value.mode };
}
function keyInput(key) {
  if (!text(key, 1200000)) throw fail('Invalid render compatibility key.');
  let value; try { value = JSON.parse(key); } catch { throw fail('Invalid render compatibility key.'); }
  if (!object(value) || !object(value.scene) || !Array.isArray(value.scene.lines) || value.scene.lines.length > 5000 || !object(value.voices)) throw fail('Invalid render compatibility key.');
  return { scene: value.scene, voices: value.voices, myCharacter: value.myCharacter, gapSeconds: value.gapSeconds, includeDirections: value.includeDirections, scope: value.scope ?? 'scene' };
}
export function validateRenderKey(key, input) {
  const keyed = keyInput(key);
  if (input && !isDeepStrictEqual(keyed, { scene: input.scene, voices: input.voices, myCharacter: input.myCharacter, gapSeconds: input.gapSeconds, includeDirections: input.includeDirections, scope: input.scope ?? 'scene' })) throw fail('Render compatibility key does not match the requested scene.');
  return key;
}
function validateResult(value) {
  if (!object(value) || !number(value.duration, 0.00001, 7200) || !Array.isArray(value.cues) || !value.cues.length || value.cues.length > 5000) throw fail('Invalid completed render metadata.');
  let end = 0; const ids = new Set();
  const cues = value.cues.map(cue => {
    if (!object(cue) || !text(cue.lineId, 100) || ids.has(cue.lineId) || !text(cue.character, 100) || !number(cue.start, end, value.duration) || !number(cue.end, cue.start, value.duration + 0.00001)) throw fail('Invalid render cue timeline.');
    ids.add(cue.lineId); end = cue.end;
    return { lineId: cue.lineId, character: cue.character, start: cue.start, end: cue.end };
  });
  return { fullUrl: value.fullUrl, practiceUrl: value.practiceUrl, duration: value.duration, cues };
}
function audioNames(project, result) {
  return ['full', 'practice'].map(mode => {
    const url = result[`${mode}Url`]; const prefix = `/api/projects/${project}/audio/`;
    if (typeof url !== 'string' || !url.startsWith(prefix)) throw fail('Invalid project audio URL.');
    const name = url.slice(prefix.length);
    if (!AUDIO_NAME.test(name) || !name.endsWith(`-${mode}.wav`)) throw fail('Invalid project audio filename.');
    return name;
  });
}
function validateManifest(value, expectedId) {
  if (!object(value) || value.version !== 1 || value.id !== expectedId || !PROJECT_ID.test(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !text(value.createdAt, 40) || !text(value.updatedAt, 40) || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt)) || !Array.isArray(value.renders) || value.renders.length > 2000) throw fail('Project manifest is corrupt.', 422);
  const keys = new Set();
  return { version: 1, id: value.id, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt, preferences: validatePreferences(value.preferences), renders: value.renders.map(entry => {
    validateRenderKey(entry?.key); if (keys.has(entry.key)) throw fail('Duplicate render key.'); keys.add(entry.key);
    const result = validateResult(entry.result); audioNames(value.id, result); return { key: entry.key, result };
  }) };
}
async function regular(filename) { const info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink()) throw fail('Expected an ordinary project file.', 422); return info; }
async function wavInfo(filename, expectedDuration) {
  const info = await regular(filename);
  if (info.size < 46 || info.size > 7200 * 48000 + 44) throw fail('Invalid project WAV size.', 422);
  const file = await open(filename, 'r');
  try {
    const header = Buffer.alloc(44); const { bytesRead } = await file.read(header, 0, 44, 0);
    if (bytesRead !== 44 || header.toString('ascii', 0, 4) !== 'RIFF' || header.readUInt32LE(4) !== info.size - 8 || header.toString('ascii', 8, 16) !== 'WAVEfmt ' || header.readUInt32LE(16) !== 16 || header.readUInt16LE(20) !== 1 || header.readUInt16LE(22) !== 1 || header.readUInt32LE(24) !== 24000 || header.readUInt32LE(28) !== 48000 || header.readUInt16LE(32) !== 2 || header.readUInt16LE(34) !== 16 || header.toString('ascii', 36, 40) !== 'data' || header.readUInt32LE(40) !== info.size - 44 || (info.size - 44) % 2) throw fail('Invalid project WAV header.', 422);
    if (expectedDuration !== undefined && Math.abs((info.size - 44) / 48000 - expectedDuration) > 1 / 24000) throw fail('WAV duration does not match its render.', 422);
  } finally { await file.close(); }
  return info;
}
async function digest(filename) { const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk); return hash.digest('hex'); }
async function atomicJSON(filename, value, preserve = false) {
  const bytes = Buffer.from(JSON.stringify(value)); if (bytes.length > MAX_META) throw fail('Project metadata reached its 32 MiB limit. Export this project and create another.', 413);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx');
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    if (preserve) {
      const previous = `${filename}.previous.${randomUUID()}.tmp`;
      try { await copyFile(filename, previous); await renameRetry(previous, `${filename}.previous`); } catch (error) { await unlink(previous).catch(() => {}); if (error.code !== 'ENOENT') throw error; }
    }
    await renameRetry(temporary, filename);
  } finally { await unlink(temporary).catch(() => {}); }
}

// Renders are reproducible, so each project keeps only its newest versions and a
// metadata budget well below MAX_META; autosave must never hit the manifest limit.
export function createProjectStore(root, cacheDir, { maxRenders = 200, renderBudget = 16 * 1024 * 1024 } = {}) {
  root = path.resolve(root); cacheDir = path.resolve(cacheDir);
  const locks = new Map(); let restoring = false, exporting = 0;
  async function locked(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve(); const next = previous.catch(() => {}).then(fn); locks.set(key, next);
    try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
  }
  const directory = value => path.join(root, id(value));
  async function ensureRoot() { await mkdir(root, { recursive: true }); if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw fail('Invalid project library directory.', 422); }
  async function read(project) {
    const dir = directory(project);
    try { const info = await lstat(dir); if (!info.isDirectory() || info.isSymbolicLink()) throw fail('Invalid project directory.', 422); } catch (error) { if (error.code === 'ENOENT') throw fail('Project not found.', 404); throw error; }
    const load = async filename => { if ((await regular(filename)).size > MAX_META) throw fail('Project manifest exceeds metadata limit.', 422); return validateManifest(JSON.parse(await readFile(filename, 'utf8')), project); };
    try { return await load(path.join(dir, 'project.json')); } catch (error) {
      try { const recovered = await load(path.join(dir, 'project.json.previous')); recovered.warnings = ['Recovered the previous project manifest. Review the latest changes before saving.']; return recovered; }
      catch { throw fail(`Project ${project} cannot be read. Its files have been preserved for recovery.`, 422); }
    }
  }
  async function publicDocument(document) {
    const warnings = [...(document.warnings ?? [])]; const renders = [];
    for (const entry of document.renders) {
      try { for (const name of audioNames(document.id, entry.result)) await wavInfo(path.join(directory(document.id), name), entry.result.duration); renders.push(entry); }
      catch { warnings.push(`Saved audio is missing or invalid for ${keyInput(entry.key).scene.title || 'a scene'}. Render that scene again.`); }
    }
    const { version, ...result } = document;
    return { ...result, renders, ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}) };
  }
  async function capacity() {
    await ensureRoot(); const entries = (await readdir(root, { withFileTypes: true })).filter(entry => PROJECT_ID.test(entry.name));
    if (entries.length >= 1000) throw fail('The project library has reached 1,000 projects. No files were removed.', 409);
  }
  async function create(body) {
    const preferences = validatePreferences(body?.preferences); const project = body?.id === undefined ? randomUUID() : id(body.id);
    return locked('$library', () => locked(project, async () => {
      try { const existing = await read(project); if (!isDeepStrictEqual(existing.preferences, preferences)) throw fail('This project id already belongs to different saved work.', 409); return publicDocument(existing); }
      catch (error) { if (error.status !== 404) throw error; }
      await capacity(); const dir = directory(project); await mkdir(dir);
      const now = new Date().toISOString(); const document = { version: 1, id: project, revision: 1, createdAt: now, updatedAt: now, preferences, renders: [] };
      try { await atomicJSON(path.join(dir, 'project.json'), document); } catch (error) { await rmdir(dir).catch(() => {}); throw error; }
      return publicDocument(document);
    }));
  }
  async function get(project) { return locked(id(project), async () => publicDocument(await read(project))); }
  async function list() {
    await ensureRoot(); const names = (await readdir(root)).filter(name => PROJECT_ID.test(name));
    if (names.length > 1000) throw fail('Project library exceeds 1,000 projects. No files were removed.', 409);
    const projects = [], warnings = [];
    for (const name of names) { try { const value = await get(name); projects.push({ id: name, name: value.preferences.name, updatedAt: value.updatedAt, renderCount: value.renders.length }); warnings.push(...(value.warnings ?? [])); } catch (error) { warnings.push(error.message); } }
    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return { projects, ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}) };
  }
  async function update(project, body) {
    const preferences = validatePreferences(body?.preferences);
    return locked(id(project), async () => {
      const current = await read(project); if (!Number.isSafeInteger(body?.revision) || body.revision !== current.revision) throw fail('Project changed in another tab. Save your draft as a new project to preserve both versions.', 409);
      const document = { ...current, preferences, revision: current.revision + 1, updatedAt: new Date().toISOString() }; delete document.warnings;
      // Never replace the good recovery copy with a corrupt primary.
      await atomicJSON(path.join(directory(project), 'project.json'), document, !current.warnings); return publicDocument(document);
    });
  }
  async function attach(project, key, value, cancelled = () => false, replace = false) {
    validateRenderKey(key); const result = validateResult(value);
    const names = ['full', 'practice'].map(mode => { const url = result[`${mode}Url`]; if (typeof url !== 'string' || !url.startsWith('/audio/')) throw fail('Only completed local cache renders can be attached.'); const name = url.slice(7); if (!AUDIO_NAME.test(name) || !name.endsWith(`-${mode}.wav`)) throw fail('Invalid local render audio URL.'); return name; });
    if (names[0].slice(0, 36) !== names[1].slice(0, 36)) throw fail('Render audio must be a matching full/practice pair.');
    return locked(id(project), async () => {
      const document = await read(project); const existing = document.renders.find(entry => entry.key === key);
      if (existing && !replace) {
        try { for (const name of audioNames(project, existing.result)) await wavInfo(path.join(directory(project), name), existing.result.duration); return existing; } catch { /* Re-render repairs missing audio without losing other history. */ }
      }
      const owned = [];
      try {
        const token = randomUUID(); const targetNames = ['full', 'practice'].map(mode => `${token}-${mode}.wav`);
        for (let index = 0; index < 2; index++) {
          const source = path.join(cacheDir, 'renders', names[index]);
          try { await wavInfo(source, result.duration); } catch (error) { if (error.code === 'ENOENT') throw fail('Legacy audio has expired from the cache. Render this scene again.', 404); throw error; }
          const target = path.join(directory(project), targetNames[index]);
          await copyFile(source, target, 1); owned.push(target);
          const handle = await open(target, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
          await wavInfo(target, result.duration);
        }
        if (cancelled()) throw fail('Render cancelled.', 409);
        const entry = { key, result: { ...result, fullUrl: `/api/projects/${project}/audio/${targetNames[0]}`, practiceUrl: `/api/projects/${project}/audio/${targetNames[1]}` } };
        const previousRenders = document.renders;
        document.renders = [...document.renders.filter(item => item.key !== key), entry]; document.updatedAt = new Date().toISOString();
        let size = Buffer.byteLength(JSON.stringify(document.renders));
        while (document.renders.length > 1 && (document.renders.length > maxRenders || size > renderBudget)) size -= Buffer.byteLength(JSON.stringify(document.renders.shift())) + 1;
        const recovered = Boolean(document.warnings); delete document.warnings;
        await atomicJSON(path.join(directory(project), 'project.json'), document, !recovered); owned.length = 0;
        // Keep audio referenced by the new manifest or the recovery copy; remove the rest.
        const kept = new Set([...previousRenders, ...document.renders].flatMap(item => audioNames(project, item.result)));
        // An export streams outside the lock; skip cleanup while one runs (the next render cleans up).
        if (!exporting) for (const name of await readdir(directory(project))) if (AUDIO_NAME.test(name) && !kept.has(name)) await unlink(path.join(directory(project), name)).catch(() => {});
        return entry;
      } finally { for (const filename of owned) await unlink(filename).catch(() => {}); }
    });
  }
  async function audioPath(project, filename) {
    if (!AUDIO_NAME.test(filename)) throw fail('Project audio not found.', 404);
    // Read under the lock, so an autosave is not replacing project.json at the same moment.
    const document = await locked(id(project), () => read(project));
    const entry = document.renders.find(item => audioNames(project, item.result).includes(filename));
    if (!entry) throw fail('Project audio not found.', 404);
    const target = path.join(directory(project), filename); try { await wavInfo(target, entry.result.duration); } catch { throw fail('Saved audio is missing or invalid. Render the scene again.', 404); } return target;
  }
  async function backupInfo(project) {
    const document = await locked(id(project), () => read(project)); delete document.warnings;
    const files = [];
    const durations = new Map(document.renders.flatMap(entry => audioNames(project, entry.result).map(name => [name, entry.result.duration])));
    for (const [name, duration] of durations) {
      try { const info = await wavInfo(path.join(directory(project), name), duration); files.push({ name, size: info.size, sha256: '0'.repeat(64) }); }
      catch { throw fail('A saved audio file is missing or invalid. Re-render that scene before exporting a complete backup.', 422); }
    }
    const metadata = Buffer.byteLength(JSON.stringify({ version: 1, project: document, files }));
    const bytes = 12 + metadata + files.reduce((sum, file) => sum + file.size, 0);
    if (metadata > MAX_META || bytes > MAX_BACKUP) throw fail('Backup exceeds the 4 GiB limit. Original project remains saved.', 413);
    return { bytes };
  }
  async function backup(project, response) {
    if (exporting >= 2) throw fail('Two project exports are already running. Try again shortly.', 429);
    exporting++;
    try {
      const document = await locked(id(project), () => read(project)); delete document.warnings;
      const names = [...new Set(document.renders.flatMap(entry => audioNames(project, entry.result)))]; const files = [];
      // Snapshot files are immutable and never evicted, even if a newer render
      // replaces the same compatibility key while the download is running.
      for (const name of names) { const filename = path.join(directory(project), name); const info = await wavInfo(filename); files.push({ name, size: info.size, sha256: await digest(filename) }); }
      const metadata = Buffer.from(JSON.stringify({ version: 1, project: document, files }));
      const size = 12 + metadata.length + files.reduce((sum, file) => sum + file.size, 0);
      if (metadata.length > MAX_META || size > MAX_BACKUP) throw fail('Backup exceeds the 4 GiB limit. Original project remains saved.', 413);
      const header = Buffer.alloc(12); MAGIC.copy(header); header.writeUInt32BE(metadata.length, 8);
      response.setHeader('Content-Type', 'application/octet-stream'); response.setHeader('Content-Length', size); response.setHeader('Content-Disposition', `attachment; filename="script-glow-${project}.sgbackup"`);
      const write = async bytes => {
        if (response.destroyed) throw fail('Backup download disconnected.', 499);
        if (!response.write(bytes)) {
          await new Promise((resolve, reject) => {
            const clear = () => { response.off('drain', drained); response.off('close', closed); response.off('error', errored); };
            const drained = () => { clear(); resolve(); }; const closed = () => { clear(); reject(fail('Backup download disconnected.', 499)); }; const errored = error => { clear(); reject(error); };
            response.once('drain', drained); response.once('close', closed); response.once('error', errored);
          });
        }
      };
      await write(header); await write(metadata);
      for (const file of files) for await (const chunk of createReadStream(path.join(directory(project), file.name))) await write(chunk);
      response.end();
    } finally { exporting--; }
  }
  async function restore(request) {
    if (restoring) throw fail('A project restore is already running.', 429);
    if (Number(request.headers['content-length']) > MAX_BACKUP) throw fail('Backup exceeds the 4 GiB limit.', 413);
    restoring = true; let staging; const owned = [];
    try {
      await capacity(); const project = randomUUID(); staging = path.join(root, `.restore-${project}`); await mkdir(staging);
      const iterator = request[Symbol.asyncIterator](); let pending = Buffer.alloc(0), total = 0;
      async function take(length, consume) {
        let remaining = length; const chunks = [];
        while (remaining) {
          if (!pending.length) { const item = await iterator.next(); if (item.done) throw fail('Backup is truncated.', 422); pending = Buffer.from(item.value); total += pending.length; if (total > MAX_BACKUP) throw fail('Backup exceeds the 4 GiB limit.', 413); }
          const chunk = pending.subarray(0, Math.min(remaining, pending.length)); pending = pending.subarray(chunk.length); remaining -= chunk.length;
          if (consume) await consume(chunk); else chunks.push(chunk);
        }
        return consume ? undefined : Buffer.concat(chunks, length);
      }
      const header = await take(12); if (!header.subarray(0, 8).equals(MAGIC)) throw fail('Not a Script Glow backup.', 422);
      const metaSize = header.readUInt32BE(8); if (!metaSize || metaSize > MAX_META) throw fail('Invalid backup metadata size.', 422);
      let metadata; try { metadata = JSON.parse((await take(metaSize)).toString('utf8')); } catch (error) { if (error.status) throw error; throw fail('Invalid backup metadata.', 422); }
      if (!object(metadata) || metadata.version !== 1 || !Array.isArray(metadata.files) || metadata.files.length > 4000) throw fail('Invalid backup format.', 422);
      const document = validateManifest(metadata.project, metadata.project?.id);
      const expected = new Set(document.renders.flatMap(entry => audioNames(document.id, entry.result))); const seen = new Set(); let declared = 12 + metaSize;
      for (const file of metadata.files) {
        if (!object(file) || !AUDIO_NAME.test(file.name) || !expected.has(file.name) || seen.has(file.name) || !Number.isSafeInteger(file.size) || file.size < 46 || file.size > 7200 * 48000 + 44 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw fail('Invalid backup audio table.', 422);
        seen.add(file.name); declared += file.size;
      }
      if (seen.size !== expected.size || declared > MAX_BACKUP) throw fail('Backup audio table is incomplete or too large.', 422);
      for (const item of metadata.files) {
        const filename = path.join(staging, item.name); const handle = await open(filename, 'wx'); owned.push(filename); const hash = createHash('sha256');
        try { await take(item.size, async chunk => { hash.update(chunk); await handle.writeFile(chunk); }); await handle.sync(); } finally { await handle.close(); }
        if (hash.digest('hex') !== item.sha256) throw fail('Backup audio checksum failed.', 422);
        await wavInfo(filename);
      }
      if (pending.length || !(await iterator.next()).done) throw fail('Backup contains unexpected trailing data.', 422);
      for (const entry of document.renders) for (const name of audioNames(document.id, entry.result)) await wavInfo(path.join(staging, name), entry.result.duration);
      const old = document.id; document.id = project; document.revision = 1; document.createdAt = document.updatedAt = new Date().toISOString();
      for (const entry of document.renders) { entry.result.fullUrl = entry.result.fullUrl.replace(`/api/projects/${old}/`, `/api/projects/${project}/`); entry.result.practiceUrl = entry.result.practiceUrl.replace(`/api/projects/${old}/`, `/api/projects/${project}/`); }
      await atomicJSON(path.join(staging, 'project.json'), document); owned.push(path.join(staging, 'project.json'));
      await locked('$library', async () => { await capacity(); await renameRetry(staging, directory(project)); }); owned.length = 0; staging = undefined;
      return publicDocument(document);
    } finally {
      for (const filename of owned) await unlink(filename).catch(() => {});
      if (staging) await rmdir(staging).catch(() => {});
      restoring = false;
    }
  }
  const takesDir = project => path.join(directory(project), 'takes');
  const takeIndex = project => path.join(takesDir(project), 'index.json');
  // A damaged or hand-edited index must not hide the takes that are still readable.
  async function readTakes(project) {
    try {
      const saved = JSON.parse(await readFile(takeIndex(project), 'utf8'));
      if (!Array.isArray(saved)) return [];
      return saved.filter(entry => object(entry) && typeof entry.file === 'string' && TAKE_NAME.test(entry.file) && text(entry.label, 100, true));
    } catch { return []; }
  }
  async function takes(project) {
    await read(project);
    const listed = [];
    for (const entry of await readTakes(project)) {
      // A take deleted outside the app stops being offered instead of failing the whole list.
      try { const info = await regular(path.join(takesDir(project), entry.file)); listed.push({ ...entry, bytes: info.size }); } catch { /* skip */ }
    }
    return listed;
  }
  async function addTake(project, source, { type, sceneId = '', label = '', ms = 0, kind = 'scene' } = {}) {
    const extension = TAKE_TYPES[type];
    if (!TAKE_KINDS.includes(kind)) throw fail('Invalid take kind.', 400);
    if (!extension) throw fail('A take must be recorded as video/webm or video/mp4.', 415);
    if (!text(label, 100, true) || !text(sceneId, 100, true)) throw fail('Invalid take details.', 400);
    return locked(id(project), async () => {
      await read(project);
      const existing = await readTakes(project);
      if (existing.length >= MAX_TAKES) throw fail(`This project already holds ${MAX_TAKES} takes. Delete one before recording another.`, 409);
      await mkdir(takesDir(project), { recursive: true });
      const file = `${randomUUID()}.${extension}`;
      const temporary = path.join(takesDir(project), `${randomUUID()}.tmp`);
      let bytes = 0;
      try {
        await pipeline(source, new Transform({ transform(chunk, encoding, done) {
          bytes += chunk.length;
          done(bytes > MAX_TAKE ? fail('Take exceeds the 512 MiB limit. Nothing was saved.', 413) : null, chunk);
        } }), createWriteStream(temporary));
        if (!bytes) throw fail('The take was empty and has not been saved.', 400);
        await renameRetry(temporary, path.join(takesDir(project), file));
      } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
      const entry = { file, kind, label: label || (kind === 'slate' ? 'Slate' : `Take ${existing.length + 1}`), sceneId, ms: Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0, created: new Date().toISOString(), bytes };
      await atomicJSON(takeIndex(project), [...existing, entry]);
      return entry;
    });
  }
  async function takePath(project, file) {
    if (!TAKE_NAME.test(file)) throw fail('Take not found.', 404);
    const entry = (await readTakes(project)).find(item => item.file === file);
    if (!entry) throw fail('Take not found.', 404);
    const target = path.join(takesDir(project), file);
    try { await regular(target); } catch { throw fail('Take file is missing.', 404); }
    return { path: target, entry };
  }
  async function renameTake(project, file, label) {
    if (!text(label, 100)) throw fail('A take needs a name of up to 100 characters.', 400);
    return locked(id(project), async () => {
      const entries = await readTakes(project);
      if (!TAKE_NAME.test(file) || !entries.some(item => item.file === file)) throw fail('Take not found.', 404);
      const updated = entries.map(item => item.file === file ? { ...item, label } : item);
      await atomicJSON(takeIndex(project), updated);
      return updated.find(item => item.file === file);
    });
  }
  // A finished copy: trimmed and converted to MP4, saved as a new take beside the original, which is
  // never changed. The conversion runs outside the project lock, so autosave carries on meanwhile.
  async function exportTake(project, file, { start = 0, end = 0 } = {}) {
    const { entry } = await takePath(project, file);
    const seconds = entry.ms / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0 || (end && end <= start) || (seconds && (start > seconds || end > seconds + 1))) throw fail('Choose a start before the end, inside the take.', 400);
    const existing = await readTakes(project);
    if (existing.length >= MAX_TAKES) throw fail(`This project already holds ${MAX_TAKES} takes. Delete one first.`, 409);
    const output = `${randomUUID()}.mp4`;
    const temporary = `${output}.part.mp4`;
    const dir = takesDir(project);
    try {
      await makeMp4({ cwd: dir, input: file, output: temporary, start, length: end ? end - start : 0 });
      const info = await regular(path.join(dir, temporary));
      if (!info.size) throw fail('The converted file was empty.', 502);
      if (info.size > MAX_TAKE) throw fail('The converted take is larger than 512 MiB.', 413);
      await renameRetry(path.join(dir, temporary), path.join(dir, output));
    } catch (error) { await unlink(path.join(dir, temporary)).catch(() => {}); if (error.status) throw error; if (error.detail) console.error('FFmpeg:', error.detail); throw fail(`${error.message} The details are in the terminal.`, 502); }
    return locked(id(project), async () => {
      const entries = await readTakes(project);
      // Two exports can pass the first check together, so the limit is checked again here.
      if (entries.length >= MAX_TAKES) { await unlink(path.join(dir, output)).catch(() => {}); throw fail(`This project already holds ${MAX_TAKES} takes. Delete one first.`, 409); }
      const length = (end || seconds) - start;
      const trimmed = start > 0 || (end && end < seconds);
      const added = { file: output, kind: entry.kind ?? 'scene', label: `${entry.label}${trimmed ? ' (trimmed)' : ''} MP4`.slice(0, 100), sceneId: entry.sceneId, ms: Math.max(0, Math.round(length * 1000)), created: new Date().toISOString(), bytes: (await regular(path.join(dir, output))).size, from: file };
      await atomicJSON(takeIndex(project), [...entries, added]);
      return added;
    });
  }
  // Removing a take touches the take index and that one file. Renders and the manifest are not read.
  async function deleteTake(project, file) {
    return locked(id(project), async () => {
      const entries = await readTakes(project);
      if (!TAKE_NAME.test(file) || !entries.some(item => item.file === file)) throw fail('Take not found.', 404);
      await atomicJSON(takeIndex(project), entries.filter(item => item.file !== file));
      await unlink(path.join(takesDir(project), file)).catch(() => {});
      return { removed: file };
    });
  }
  // Deleting moves the whole project (script, audio, takes) into .trash, so a mistake can be undone
  // by moving the folder back. Nothing is erased.
  async function remove(project) {
    return locked('$library', () => locked(id(project), async () => {
      if (exporting || restoring) throw fail('A backup is being made or restored. Try again when it finishes.', 409);
      await read(project);
      const bin = path.join(root, '.trash');
      await mkdir(bin, { recursive: true });
      const target = path.join(bin, `${id(project)}-${Date.now()}`);
      await renameRetry(directory(project), target);
      return { removed: id(project), keptIn: path.relative(root, target) };
    }));
  }
  return { create, get, list, update, remove, attach, audioPath, backup, backupInfo, restore, takes, addTake, takePath, renameTake, deleteTake, exportTake };
}
