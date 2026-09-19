import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// The timeout turns a regression (a server that keeps running) into a failure instead of a hang.
test('a taken port stops startup with an error and a non-zero exit', { timeout: 30000 }, async () => {
  const blocker = http.createServer().listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const home = await mkdtemp(path.join(os.tmpdir(), 'script-glow-port-'));
  try {
    const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(blocker.address().port), SCRIPT_GLOW_HOME: home, SCRIPT_GLOW_SECRETS: path.join(home, 'secrets.json') } });
    let stderr = '', stdout = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => { stdout += chunk; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(stderr, /could not start on port/);
    assert.doesNotMatch(stdout, /Script Glow: http/, 'No address is printed for a server that is not running');
  } finally { blocker.close(); await rm(home, { recursive: true, force: true }); }
});
