// Prepares the built-in voice files for the kokoro-assets-v1 GitHub release. Nothing here uploads.
//   node scripts/kokoro-assets.mjs fetch <dir>        the Kokoro model, English voices, tokenizer and Misaki word lists
//   node scripts/kokoro-assets.mjs manifest <dir>     writes server/kokoro/manifest.json from what is in <dir>
//   node scripts/kokoro-assets.mjs stage <dir> <out>  copies every file under its release asset name, plus the license
// The BART fallback models come from scripts/kokoro-bart-export.py, run between fetch and manifest.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assetName } from '../server/kokoro/assets.js';

const TAG = 'kokoro-assets-v1';
const KOKORO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// The 28 English voices: a is US, b is UK; f is female, m is male.
const VOICES = ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'];
const [command, dir, out] = process.argv.slice(2);
if (!dir || !['fetch', 'manifest', 'stage'].includes(command) || (command === 'stage' && !out)) {
  console.error('Usage: node scripts/kokoro-assets.mjs fetch <dir> | manifest <dir> | stage <dir> <out>');
  process.exit(1);
}
const json = async url => { const response = await fetch(url); if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response.json(); };
async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  console.log(`${file} ${(await stat(file)).size} bytes`);
}
async function sha256(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
// Every file under dir except sources.json, as paths with forward slashes, sorted.
async function listFiles() {
  const names = await readdir(dir, { recursive: true });
  const files = [];
  for (const name of names) if ((await stat(path.join(dir, name))).isFile() && name !== 'sources.json') files.push(name.split(path.sep).join('/'));
  return files.sort();
}

if (command === 'fetch') {
  // Each source is pinned to the commit it had today, and the commit is kept in sources.json.
  const kokoroRevision = (await json(`https://huggingface.co/api/models/${KOKORO}`)).sha;
  for (const name of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model.onnx', ...VOICES.map(voice => `voices/${voice}.bin`)])
    await download(`https://huggingface.co/${KOKORO}/resolve/${kokoroRevision}/${name}`, path.join(dir, 'kokoro', name));
  const misakiRevision = (await json('https://api.github.com/repos/hexgrad/misaki/commits/main')).sha;
  for (const name of ['us_gold', 'us_silver', 'gb_gold', 'gb_silver'])
    await download(`https://raw.githubusercontent.com/hexgrad/misaki/${misakiRevision}/misaki/data/${name}.json`, path.join(dir, 'g2p', `${name}.json`));
  await writeFile(path.join(dir, 'sources.json'), `${JSON.stringify({ kokoro: { repo: KOKORO, revision: kokoroRevision }, misaki: { repo: 'hexgrad/misaki', revision: misakiRevision } }, null, 1)}\n`);
  console.log(`Fetched. Next: export the BART fallback into ${path.join(dir, 'g2p')} (scripts/kokoro-bart-export.py).`);
}
if (command === 'manifest') {
  const sources = JSON.parse(await readFile(path.join(dir, 'sources.json'), 'utf8'));
  for (const accent of ['us', 'gb']) sources[`bart_${accent}`] = JSON.parse(await readFile(path.join(dir, 'g2p', `bart_${accent}.json`), 'utf8')).source;
  const files = [];
  for (const file of await listFiles()) files.push({ path: file, size: (await stat(path.join(dir, file))).size, sha256: await sha256(path.join(dir, file)) });
  const manifest = { version: 1, tag: TAG, base: `https://github.com/Mariano215/script-glow/releases/download/${TAG}`, sources, files };
  await writeFile(new URL('../server/kokoro/manifest.json', import.meta.url), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`server/kokoro/manifest.json: ${files.length} files, ${Math.round(files.reduce((sum, file) => sum + file.size, 0) / 1e6)} MB`);
}
if (command === 'stage') {
  const manifest = JSON.parse(await readFile(new URL('../server/kokoro/manifest.json', import.meta.url), 'utf8'));
  await mkdir(out, { recursive: true });
  for (const file of manifest.files) {
    if (await sha256(path.join(dir, file.path)) !== file.sha256) throw new Error(`${file.path} does not match server/kokoro/manifest.json`);
    await copyFile(path.join(dir, file.path), path.join(out, assetName(file.path)));
  }
  // Apache-2.0 asks for the license text next to what is redistributed.
  await copyFile(new URL('../node_modules/@huggingface/transformers/LICENSE', import.meta.url), path.join(out, 'LICENSE-Apache-2.0.txt'));
  console.log(`Staged ${manifest.files.length + 1} files in ${out}`);
}
