// Operator-authored connection settings only. Never load endpoints from projects
// or model output; credentials are not accepted in this non-secret profile.
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const DEFAULT_CONNECTIONS = Object.freeze({
  version: 1, name: 'Local services',
  chatterbox: { url: 'http://127.0.0.1:8095', cacheNamespace: 'local-chatterbox', legacyCache: false },
  whisperx: { url: 'http://127.0.0.1:8010' },
  ollama: { url: 'http://127.0.0.1:11434', model: '' },
  casting: { preferredActorVoice: '', aliases: {} },
});
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
  keys(value, ['version', 'name', 'chatterbox', 'whisperx', 'ollama', 'casting']);
  if (value.version !== 1 || !text(value.name, 100)) throw new Error('Invalid connection profile version or name.');
  keys(value.chatterbox, ['url', 'cacheNamespace', 'legacyCache']); keys(value.whisperx, ['url']); keys(value.ollama, ['url', 'model']); keys(value.casting, ['preferredActorVoice', 'aliases']);
  if (!text(value.chatterbox.cacheNamespace, 100) || typeof value.chatterbox.legacyCache !== 'boolean' || !text(value.ollama.model, 150, true) || !text(value.casting.preferredActorVoice, 100, true)) throw new Error('Invalid model, cache namespace, or preferred voice setting.');
  if (!object(value.casting.aliases) || Object.keys(value.casting.aliases).length > 100 || Object.entries(value.casting.aliases).some(([key, target]) => !text(key, 100) || !text(target, 100) || key === target || Object.hasOwn(value.casting.aliases, target))) throw new Error('Voice aliases must map directly to a distinct canonical voice.');
  return { version: 1, name: value.name, chatterbox: { url: url(value.chatterbox.url), cacheNamespace: value.chatterbox.cacheNamespace, legacyCache: value.chatterbox.legacyCache }, whisperx: { url: url(value.whisperx.url) }, ollama: { url: url(value.ollama.url), model: value.ollama.model }, casting: { preferredActorVoice: value.casting.preferredActorVoice, aliases: { ...value.casting.aliases } } };
}
export async function loadConnections(filename = process.env.SCRIPT_GLOW_CONFIG || fileURLToPath(new URL('../data/connections.json', import.meta.url)), required = Boolean(process.env.SCRIPT_GLOW_CONFIG)) {
  try {
    if ((await stat(filename)).size > 16000) throw new Error('Connection profile exceeds 16 KB.');
    return validateConnections(JSON.parse(await readFile(filename, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT' && !required) return validateConnections(DEFAULT_CONNECTIONS);
    throw new Error(`Cannot load connection profile: ${error instanceof SyntaxError ? 'invalid JSON' : error.message}`);
  }
}
