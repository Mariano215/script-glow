// Node 22+. Downloads only pinned, checksum-verified synthetic WAV references.
// No model install, GPU work, service restart, or replacement of existing files.
import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(await readFile(new URL('./stock-voices.json', import.meta.url), 'utf8'));
if (!process.argv[2]) throw new Error('Usage: node scripts/install-stock-voices.mjs <chatterbox voices folder>');
const directory = await realpath(resolve(process.argv[2]));
if (!(await stat(directory)).isDirectory()) throw new Error('Voice destination must be an existing directory.');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const voice of manifest.voices) {
  if (!/^Stock-[A-Za-z]+$/.test(voice.id) || !/^[a-z_]+$/.test(voice.sample)) throw new Error('Invalid manifest identifier.');
  const destination = join(directory, `${voice.id}.wav`);
  if (dirname(destination) !== directory) throw new Error('Destination escaped the voice directory.');
  try {
    const existing = await readFile(destination);
    if (sha256(existing) !== voice.sha256) throw new Error(`Existing ${voice.id} differs. Refusing to overwrite.`);
    console.log(`${voice.id}: already installed, checksum verified`);
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const url = `https://raw.githubusercontent.com/n33kos/kokoro-voices/${manifest.revision}/samples/${voice.sample}.wav`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${voice.id}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== voice.sha256) throw new Error(`Checksum mismatch: ${voice.id}`);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Invalid WAV: ${voice.id}`);
  await writeFile(destination, bytes, { flag: 'wx' });
  console.log(`${voice.id}: installed ${bytes.length} bytes (${voice.seconds}s), ${manifest.license}`);
}

console.log(`Installed in ${directory}. Sources and SHA-256: ${fileURLToPath(new URL('./stock-voices.json', import.meta.url))}`);
const serviceUrl = process.argv[3] ?? 'http://127.0.0.1:8095';
try {
  const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/v1/voices`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { voices } = await response.json();
  const missing = manifest.voices.filter(({ id }) => !voices.includes(id));
  if (missing.length) throw new Error(`Service missing ${missing.map(({ id }) => id).join(', ')}`);
  console.log('Chatterbox lists all four stock voices. No restart needed.');
} catch (error) {
  console.error(`Files installed; service verification failed: ${error.message}`);
  process.exitCode = 1;
}
