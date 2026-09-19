import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const preferences = { source: 'SCENE 1\n\nDAVID: Hello.\n', name: 'Home', role: 'DAVID', cast: {}, guesses: {}, genders: {}, manualVoices: {}, sceneId: 'scene-1', gap: 0, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' };
// The server reads SCRIPT_GLOW_HOME at import time, so each case runs in its own Node process.
const probe = `
  const { CONNECTIONS_FILE } = await import('./server/connections.js');
  const { createApp } = await import('./server/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: ${JSON.stringify(preferences)} }) });
  console.log(JSON.stringify({ file: CONNECTIONS_FILE, status: response.status }));
  process.exit(0);`;
const run = env => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, env }).toString());

test('SCRIPT_GLOW_HOME moves the profile and projects out of the code folder', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'script-glow-home-'));
  try {
    const { file, status } = run({ ...process.env, SCRIPT_GLOW_HOME: home });
    assert.equal(file, path.join(home, 'data', 'connections.json'));
    assert.equal(status, 201);
    assert.equal((await readdir(path.join(home, 'data', 'projects'))).length > 0, true);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('without SCRIPT_GLOW_HOME the profile stays next to the code', () => {
  const { SCRIPT_GLOW_HOME, ...env } = process.env;
  const script = "const { CONNECTIONS_FILE } = await import('./server/connections.js'); console.log(CONNECTIONS_FILE);";
  const file = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env }).toString().trim();
  assert.equal(file, path.join(root, 'data', 'connections.json'));
});
