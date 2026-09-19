// The built-in voice files: which ones there are (manifest.json, written by
// scripts/kokoro-assets.mjs), whether they are all on this computer, and a download that resumes
// after an interruption and refuses any file whose SHA-256 does not match.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { renameRetry } from '../connections.js';
import { G2P_VERSION } from './g2p.js';

// Release assets have no folders, so kokoro/voices/af_heart.bin is published as kokoro--voices--af_heart.bin.
export const assetName = file => file.replaceAll('/', '--');
const sized = async (file, size) => { try { return (await stat(file)).size === size; } catch { return false; } };
// Every file present at its full size. A file only gets its real name after its hash matched.
export async function assetsReady(dir, manifest) {
  return (await Promise.all(manifest.files.map(file => sized(path.join(dir, file.path), file.size)))).every(Boolean);
}
// What the line cache key needs: a new model file or new G2P data never reuses old audio.
export function cacheIdentity(manifest) {
  return {
    model: manifest.files.find(file => file.path === 'kokoro/onnx/model_fp16.onnx')?.sha256 ?? '',
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
  : 'The download stopped. Check this computer\'s internet connection, then press Try again.';

// openFile is there for the tests, which stand in a full disk.
export function createDownloader({ dir, manifest, fetchImpl = fetch, openFile = open }) {
  const total = manifest.files.reduce((sum, file) => sum + file.size, 0);
  let state = { status: 'idle', received: 0, total, error: '' };
  let running = null;
  async function fetchOne(file) {
    const final = path.join(dir, file.path), part = `${final}.part`;
    if (await sized(final, file.size)) { state.received += file.size; return; }
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
  }
  return {
    state: () => ({ ...state }),
    // Starting again while a download runs joins it. A failed file keeps its .part to resume from.
    start() {
      if (!running) {
        state = { status: 'downloading', received: 0, total, error: '' };
        running = (async () => {
          try { for (const file of manifest.files) await fetchOne(file); state.status = 'ready'; }
          catch (error) { state = { ...state, status: 'error', error: said(error) }; }
        })().finally(() => { running = null; });
      }
      return running;
    },
    // Resolves once no download is running, so a render can wait for the files.
    settled: () => running ?? Promise.resolve(),
    async remove() {
      if (running) throw Object.assign(new Error('The voices are still downloading. Wait for the download to finish, then remove them.'), { status: 409 });
      await rm(dir, { recursive: true, force: true });
      state = { status: 'idle', received: 0, total, error: '' };
    },
  };
}
