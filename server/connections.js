// Operator-authored connection settings only. Never load endpoints from projects
// or model output; credentials are not accepted in this non-secret profile.
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const DEFAULT_CONNECTIONS = Object.freeze({
  version: 1, name: 'Local services',
  // Which engine speaks the cast. Chatterbox is local; the others are hosted and need a key.
  voice: { engine: 'chatterbox', model: '' },
  // Which model guesses voice types from names. Ollama is local; the others are hosted.
  names: { engine: 'ollama', model: '' },
  chatterbox: { url: 'http://127.0.0.1:8095', cacheNamespace: 'local-chatterbox', legacyCache: false },
  whisperx: { url: 'http://127.0.0.1:8010' },
  ollama: { url: 'http://127.0.0.1:11434', model: '' },
  casting: { preferredActorVoice: '', aliases: {} },
});
export const VOICE_ENGINES = Object.freeze(['chatterbox', 'openai', 'gemini', 'elevenlabs']);
export const NAME_ENGINES = Object.freeze(['ollama', 'openai', 'anthropic', 'gemini', 'xai', 'openrouter']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
function keys(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown or invalid connection settings. Do not store API keys in this profile.'); }
function url(value) {
  if (!text(value, 500)) throw new Error('Service URL is required.');
  let parsed; try { parsed = new URL(value); } catch { throw new Error('Invalid service URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Service URLs must use HTTP(S) without credentials, query, or fragment.');
  return parsed.href.replace(/\/+$/, '');
}
export function validateConnections(value) {
  keys(value, ['version', 'name', 'voice', 'names', 'chatterbox', 'whisperx', 'ollama', 'casting']);
  // Profiles written before hosted voices had no engine: they meant Chatterbox.
  const voice = value.voice ?? { engine: 'chatterbox', model: '' }, names = value.names ?? { engine: 'ollama', model: '' };
  keys(names, ['engine', 'model']);
  // A key pasted into a model field would land in this shareable file.
  if ([voice.model, names.model, value.ollama?.model].some(model => typeof model === 'string' && /^(sk-|AIza|xai-|xi-|fal-)/i.test(model))) throw new Error('That looks like an API key, not a model name. Keys go under Keys for paid services.');
  if (!NAME_ENGINES.includes(names.engine) || !text(names.model, 100, true) || !/^[\w.:/-]*$/.test(names.model)) throw new Error('Choose a name-guessing engine from the list, and a model name made of letters, digits, dots, slashes and dashes.');
  keys(voice, ['engine', 'model']);
  if (!VOICE_ENGINES.includes(voice.engine) || !text(voice.model, 100, true) || !/^[\w.:-]*$/.test(voice.model)) throw new Error('Choose a voice engine from the list, and a model name made of letters, digits, dots and dashes.');
  if (value.version !== 1 || !text(value.name, 100)) throw new Error('Invalid connection profile version or name.');
  keys(value.chatterbox, ['url', 'cacheNamespace', 'legacyCache']); keys(value.whisperx, ['url']); keys(value.ollama, ['url', 'model']); keys(value.casting, ['preferredActorVoice', 'aliases']);
  if (!text(value.chatterbox.cacheNamespace, 100) || typeof value.chatterbox.legacyCache !== 'boolean' || !text(value.ollama.model, 150, true) || !text(value.casting.preferredActorVoice, 100, true)) throw new Error('Invalid model, cache namespace, or preferred voice setting.');
  if (!object(value.casting.aliases) || Object.keys(value.casting.aliases).length > 100 || Object.entries(value.casting.aliases).some(([key, target]) => !text(key, 100) || !text(target, 100) || key === target || Object.hasOwn(value.casting.aliases, target))) throw new Error('Voice aliases must map directly to a distinct canonical voice.');
  return { version: 1, name: value.name, voice: { engine: voice.engine, model: voice.model }, names: { engine: names.engine, model: names.model }, chatterbox: { url: url(value.chatterbox.url), cacheNamespace: value.chatterbox.cacheNamespace, legacyCache: value.chatterbox.legacyCache }, whisperx: { url: url(value.whisperx.url) }, ollama: { url: url(value.ollama.url), model: value.ollama.model }, casting: { preferredActorVoice: value.casting.preferredActorVoice, aliases: { ...value.casting.aliases } } };
}
export const CONNECTIONS_FILE = fileURLToPath(new URL('../data/connections.json', import.meta.url));
// Written whole or not at all: a half-written profile would leave the app unable to start.
export async function saveConnections(filename, value) {
  const profile = validateConnections(value);
  const bytes = Buffer.from(`${JSON.stringify(profile, null, 1)}\n`);
  if (bytes.length > 16000) throw new Error('Connection profile exceeds 16 KB.');
  await writeWhole(filename, bytes);
  return profile;
}
// Windows refuses to replace a file that another program (antivirus, search indexer, a media
// stream) holds open for a moment. Those errors pass, so the rename is tried again briefly.
export async function renameRetry(from, to, tries = 8) {
  for (let attempt = 1; ; attempt++) {
    try { return await rename(from, to); }
    catch (error) {
      if (attempt >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * attempt));
    }
  }
}
// The mode applies where the platform has one; Windows ignores it.
export async function writeWhole(filename, bytes, mode = 0o644) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', mode);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await renameRetry(temporary, filename);
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
export async function loadConnections(filename = process.env.SCRIPT_GLOW_CONFIG || CONNECTIONS_FILE, required = Boolean(process.env.SCRIPT_GLOW_CONFIG)) {
  try {
    if ((await stat(filename)).size > 16000) throw new Error('Connection profile exceeds 16 KB.');
    return validateConnections(JSON.parse(await readFile(filename, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT' && !required) return validateConnections(DEFAULT_CONNECTIONS);
    throw new Error(`Cannot load connection profile: ${error instanceof SyntaxError ? 'invalid JSON' : error.message}`);
  }
}
