// API keys for hosted services. Kept apart from connections.json on purpose: that file is copied
// between machines and refuses credentials. This one is never sent to the browser, never part of a
// project backup, and readable only by its owner where the platform allows it.
import { chmod, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWhole } from './connections.js';
// chatterbox is not a paid service: it is the token a voice server on another machine asks for.
export const PROVIDERS = Object.freeze(['openai', 'gemini', 'elevenlabs', 'anthropic', 'xai', 'openrouter', 'fal', 'chatterbox']);
// In the user's own settings folder, not the project: file modes do nothing on some drives (a Windows
// drive seen from WSL), while a user folder is private by default on every platform.
const settingsHome = process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
export const SECRETS_FILE = process.env.SCRIPT_GLOW_SECRETS || path.join(settingsHome, 'script-glow', 'secrets.json');
// Keys were once kept in data/. The move looks there, in the same folder as the rest of the data.
const OLD_SECRETS_FILE = process.env.SCRIPT_GLOW_HOME ? path.join(path.resolve(process.env.SCRIPT_GLOW_HOME), 'data', 'secrets.json') : fileURLToPath(new URL('../data/secrets.json', import.meta.url));
const exists = file => stat(file).then(() => true, () => false);
// The folder is private too, so its listing does not show what is kept there.
// mkdir sets the mode only on a folder it makes, so an older folder is tightened as well.
const privateWrite = async (file, bytes) => {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(path.dirname(file), 0o700);
  await writeWhole(file, bytes, 0o600);
};
// Keys saved by an earlier version, in data/, are moved once. The old file goes only after the new
// one is written and reads back the same.
export async function moveOldSecrets(to = SECRETS_FILE, from = OLD_SECRETS_FILE) {
  if (path.resolve(to) === path.resolve(from) || !await exists(from)) return false;
  if (await exists(to)) {
    // Both exist. The old copy is removed only when it holds nothing the new one lacks.
    if ((await readFile(from)).equals(await readFile(to))) { await unlink(from); return false; }
    console.warn(`An older key file is still in ${from}. Keys are read from ${to}. Add any key you still need in Settings, then delete the old file.`);
    return false;
  }
  const bytes = await readFile(from);
  await privateWrite(to, bytes);
  if (!(await readFile(to)).equals(bytes)) throw new Error('Moving the key file failed; the old one was kept.');
  await unlink(from);
  return true;
}
// Real keys are long. A short one would be mostly revealed by its hint.
const valid = key => typeof key === 'string' && key.length >= 20 && key.length <= 500 && /^[\x21-\x7e]+$/.test(key);
export const hint = key => `${key.slice(0, 3)}…${key.slice(-4)}`;
export function createSecrets(filename = SECRETS_FILE) {
  // One write at a time: two saves reading the same file would lose one of the keys.
  let queue = Promise.resolve();
  const read = async () => {
    try { const stored = JSON.parse(await readFile(filename, 'utf8')); return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}; }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('The key file cannot be read.'); }
  };
  const change = edit => (queue = queue.catch(() => {}).then(async () => {
    const keys = await read(); edit(keys);
    await privateWrite(filename, Buffer.from(`${JSON.stringify(keys, null, 1)}\n`));
  }));
  const provider = name => { if (!PROVIDERS.includes(name)) throw new Error('There is no such provider.'); return name; };
  return {
    // What the browser may know: which providers have a key, and enough of it to tell two apart.
    async list() { const keys = await read(); return PROVIDERS.map(name => valid(keys[name]) ? { provider: name, configured: true, hint: hint(keys[name]) } : { provider: name, configured: false }); },
    async set(name, key) {
      provider(name);
      if (!valid(key)) throw new Error('That does not look like an API key. Paste the whole key, with no spaces.');
      await change(keys => { keys[name] = key; });
      return { provider: name, configured: true, hint: hint(key) };
    },
    async remove(name) { provider(name); await change(keys => { delete keys[name]; }); return { provider: name, configured: false }; },
    // Server side only. Never put this in a reply.
    async get(name) { const key = (await read())[provider(name)]; return valid(key) ? key : ''; },
  };
}
