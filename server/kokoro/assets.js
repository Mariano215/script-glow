// The built-in voice files: which ones there are (manifest.json, written by
// scripts/kokoro-assets.mjs), whether they are all on this computer, and a download that resumes
// after an interruption and refuses any file whose SHA-256 does not match.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, open, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renameRetry } from '../connections.js';
import { G2P_VERSION } from './g2p.js';

// Release assets have no folders, so kokoro/voices/af_heart.bin is published as kokoro--voices--af_heart.bin.
export const assetName = file => file.replaceAll('/', '--');
// The files of the kokoro-assets-v1 release. Written by `node scripts/kokoro-assets.mjs manifest`.
export const MANIFEST = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
// A manifest path is data, not a trusted path: only plain relative segments, no '.', '..' or drive letters.
const PATH_PART = /^[A-Za-z0-9._-]+$/;
function assetPath(dir, file) {
  const parts = file.split('/');
  if (parts.length === 0 || parts.some(part => part === '.' || part === '..' || !PATH_PART.test(part))) {
    throw Object.assign(new Error(`${file} is not a valid asset path`), { badPath: true });
  }
  return path.join(dir, ...parts);
}
// Streams the file, so the 300 MB model is never read into memory at once.
export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
// verified.json in the models folder remembers each file's size, time and the hash it matched, so
// the 300 MB model is hashed once, not at every start. A file whose size or time changed, or whose
// expected hash changed with a new manifest, is hashed again.
const RECORD = 'verified.json';
async function readRecord(dir) {
  try { const record = JSON.parse(await readFile(path.join(dir, RECORD), 'utf8')); return record && typeof record === 'object' && !Array.isArray(record) ? record : {}; } catch { return {}; }
}
// ponytail: two checks writing at once can drop an entry; the cost is one extra hash later.
async function writeRecord(dir, record) {
  const file = path.join(dir, RECORD), temp = `${file}.${randomUUID()}.tmp`;
  await mkdir(dir, { recursive: true });
  await writeFile(temp, JSON.stringify(record));
  await renameRetry(temp, file);
}
// True when the file sits at its final name with the manifest's bytes. A file with the right size but
// other bytes is deleted, so the downloader fetches it again. Copied-in and cached files come through here too.
async function verified(dir, file, record, hash) {
  const final = assetPath(dir, file.path);
  let info;
  try { info = await stat(final); } catch { return false; }
  if (info.size !== file.size) return false;
  const seen = record[file.path];
  if (seen?.size === info.size && seen.mtimeMs === info.mtimeMs && seen.sha256 === file.sha256) return true;
  delete record[file.path];
  if (await hash(final) !== file.sha256) { await rm(final, { force: true }); return false; }
  record[file.path] = { size: info.size, mtimeMs: info.mtimeMs, sha256: file.sha256 };
  return true;
}
// Every file present with its manifest SHA-256. hashFile is there for the tests, which count calls.
export async function assetsReady(dir, manifest, { hashFile: hash = hashFile } = {}) {
  const record = await readRecord(dir), before = JSON.stringify(record);
  let ready = true;
  for (const file of manifest.files) {
    try { if (!await verified(dir, file, record, hash)) ready = false; } catch { ready = false; }
  }
  if (JSON.stringify(record) !== before) await writeRecord(dir, record);
  return ready;
}
// What the line cache key needs: a new model file or new G2P data never reuses old audio.
export function cacheIdentity(manifest) {
  return {
    model: manifest.files.find(file => file.path === 'kokoro/onnx/model.onnx')?.sha256 ?? '',
    g2p: [G2P_VERSION, ...manifest.files.filter(file => file.path.startsWith('g2p/')).map(file => file.sha256)].join(':'),
  };
}
// Best rated first, from the grades in hexgrad/Kokoro-82M VOICES.md, so casting reaches for them first.
const RANK = ['af_heart', 'af_bella', 'af_nicole', 'bf_emma', 'af_aoede', 'af_kore', 'af_sarah', 'am_fenrir', 'am_michael', 'am_puck', 'af_alloy', 'af_nova', 'bf_isabella', 'bm_fable', 'bm_george', 'af_sky', 'bm_lewis', 'af_jessica', 'af_river', 'am_echo', 'am_eric', 'am_liam', 'am_onyx', 'bf_alice', 'bf_lily', 'bm_daniel', 'am_santa', 'am_adam'];
// af_heart: a (US) or b (UK), f (female) or m (male), then the name.
export function voiceList(manifest) {
  const rank = name => { const at = RANK.indexOf(name); return at < 0 ? RANK.length : at; };
  return manifest.files.map(file => /^kokoro\/voices\/([ab][fm]_[a-z]+)\.bin$/.exec(file.path)?.[1]).filter(Boolean)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(name => ({ id: `kokoro:${name}`, label: name[3].toUpperCase() + name.slice(4), gender: name[1] === 'f' ? 'female' : 'male', accent: name[0] === 'a' ? 'US' : 'UK' }));
}

const said = error => error.code === 'ENOSPC' ? 'There is not enough free disk space for the built-in voices. Free some space, then press Try again.'
  : error.damaged ? 'A downloaded file was damaged on the way. Press Try again.'
  : error.badPath ? 'One of the built-in voice files has an invalid name and cannot be downloaded.'
  : 'The download stopped. Check this computer\'s internet connection, then press Try again.';

// openFile is there for the tests, which stand in a full disk.
export function createDownloader({ dir, manifest, fetchImpl = fetch, openFile = open }) {
  const total = manifest.files.reduce((sum, file) => sum + file.size, 0);
  let state = { status: 'idle', received: 0, total, error: '' };
  let running = null, record = {};
  async function fetchOne(file) {
    const final = assetPath(dir, file.path), part = `${final}.part`;
    if (await verified(dir, file, record, hashFile)) { state.received += file.size; return; }
    await mkdir(path.dirname(final), { recursive: true });
    let have = 0;
    try { have = (await stat(part)).size; } catch { /* nothing yet */ }
    if (have > file.size) { await unlink(part); have = 0; }
    let hash = createHash('sha256');
    if (have) for await (const chunk of createReadStream(part)) hash.update(chunk);
    state.received += have;
    if (have < file.size) {
      // A connection that goes quiet for 30 seconds counts as dropped.
      const quiet = new AbortController();
      let timer = setTimeout(() => quiet.abort(), 30000);
      try {
        const response = await fetchImpl(`${manifest.base}/${assetName(file.path)}`, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: quiet.signal });
        if (response.status !== 200 && response.status !== 206) throw new Error(`HTTP ${response.status}`);
        // The server ignored the range and sent the whole file, so the part is started again.
        if (have && response.status === 200) { await unlink(part); state.received -= have; have = 0; hash = createHash('sha256'); }
        const handle = await openFile(part, 'a');
        try {
          for await (const chunk of response.body) {
            clearTimeout(timer); timer = setTimeout(() => quiet.abort(), 30000);
            await handle.appendFile(chunk);
            hash.update(chunk); state.received += chunk.length;
          }
        } finally { await handle.close(); }
      } finally { clearTimeout(timer); }
    }
    if ((await stat(part)).size !== file.size || hash.digest('hex') !== file.sha256) {
      await unlink(part);
      throw Object.assign(new Error(`${file.path} does not match its checksum`), { damaged: true });
    }
    await renameRetry(part, final);
    const { size, mtimeMs } = await stat(final);
    record[file.path] = { size, mtimeMs, sha256: file.sha256 };
    // Written now, so a ready check while the rest downloads does not hash this file again.
    await writeRecord(dir, record);
  }
  return {
    state: () => ({ ...state }),
    // Starting again while a download runs joins it. A failed file keeps its .part to resume from.
    start() {
      if (!running) {
        state = { status: 'downloading', received: 0, total, error: '' };
        running = (async () => {
          record = await readRecord(dir);
          try { for (const file of manifest.files) await fetchOne(file); state.status = 'ready'; }
          catch (error) { state = { ...state, status: 'error', error: said(error) }; }
          try { await writeRecord(dir, record); } catch { /* the next check hashes again */ }
        })().finally(() => { running = null; });
      }
      return running;
    },
    // Resolves once no download is running, so a render can wait for the files.
    settled: () => running ?? Promise.resolve(),
    async remove() {
      if (running) throw Object.assign(new Error('The voices are still downloading. Wait for the download to finish, then remove them.'), { status: 409 });
      // Retried: on Windows a file just closed by the stopped worker can stay locked for a moment.
      await rm(dir, { recursive: true, force: true, maxRetries: 5 });
      state = { status: 'idle', received: 0, total, error: '' };
    },
  };
}
