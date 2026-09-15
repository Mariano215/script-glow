// Audio-only install: pinned GitHub commits, source/output SHA-256, no overwrites.
import { loadConnections } from '../server/connections.js';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { decodeWav, encodeWav, SAMPLE_RATE } from '../server/audio.js';
const connections = await loadConnections();

const manifest = JSON.parse(await readFile(new URL('./expanded-voices.json', import.meta.url), 'utf8'));
if (!process.argv[2]) throw new Error('Usage: node scripts/install-expanded-voices.mjs <chatterbox voices folder> [ffmpeg path]');
const directory = await realpath(resolve(process.argv[2]));
const ffmpeg = process.argv[3] ?? 'ffmpeg';
if (!(await stat(directory)).isDirectory()) throw new Error('Voice destination must be an existing directory.');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const limit = 20 * 1024 * 1024;
for (const voice of manifest.voices) {
  if (!/^(Stock|VoiceZero)-[A-Za-z]+$/.test(voice.id) || !/^[a-f0-9]{40}$/.test(voice.revision) ||
      !/^[a-f0-9]{64}$/.test(voice.sourceSha256) || !/^[a-f0-9]{64}$/.test(voice.wavSha256) ||
      !['n33kos/kokoro-voices', 'OwenTyme/voice-zero'].includes(voice.repo) ||
      !/^(samples|voices)\/[a-z_]+\.(wav|flac)$/.test(voice.path)) throw new Error('Invalid manifest entry.');
  const destination = join(directory, `${voice.id}.wav`);
  if (dirname(destination) !== directory) throw new Error('Destination escaped voice directory.');
  try {
    const existing = await readFile(destination);
    if (sha256(existing) !== voice.wavSha256) throw new Error(`${voice.id} exists with a different checksum; refusing overwrite.`);
    console.log(`${voice.id}: existing checksum verified`);
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const url = `https://raw.githubusercontent.com/${voice.repo}/${voice.revision}/${voice.path}`;
  if (voice.url !== url) throw new Error('Manifest URL is not pinned.');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok) throw new Error(`${voice.id}: download HTTP ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error('Reference exceeds download limit.');
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks);
  if (sha256(source) !== voice.sourceSha256) throw new Error(`${voice.id}: source checksum mismatch`);
  let wav = source;
  if (voice.path.endsWith('.flac')) {
    const converted = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', 'pipe:1'], {
      input: source, maxBuffer: limit, timeout: 30000, windowsHide: true,
    });
    if (converted.error || converted.status !== 0) throw new Error(`${voice.id}: FFmpeg failed: ${converted.error?.message ?? converted.stderr.toString()}`);
    wav = encodeWav(converted.stdout);
  }
  if (sha256(wav) !== voice.wavSha256) throw new Error(`${voice.id}: converted checksum mismatch; verify FFmpeg version before updating manifest.`);
  const pcm = decodeWav(wav);
  const seconds = pcm.length / 2 / SAMPLE_RATE;
  if (seconds < 3 || seconds > 20 || !pcm.some((value) => value !== 0)) throw new Error(`${voice.id}: invalid reference duration/signal`);
  await writeFile(destination, wav, { flag: 'wx' });
  console.log(`${voice.id}: installed ${wav.length} bytes, ${seconds.toFixed(2)}s, ${voice.license}`);
}
const response = await fetch(`${connections.chatterbox.url}/v1/voices`, { signal: AbortSignal.timeout(10000) });
if (!response.ok) throw new Error(`Voice service HTTP ${response.status}`);
const { voices } = await response.json();
const missing = manifest.voices.filter(({ id }) => !voices.includes(id));
if (missing.length) throw new Error(`Installed but not listed by service: ${missing.map(({ id }) => id).join(', ')}`);
console.log(`PASS: ${manifest.voices.length} added references visible to Chatterbox; service unchanged.`);
