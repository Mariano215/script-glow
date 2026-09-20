import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createProjectStore, validatePreferences } from '../server/projects.js';
import { encodeWav } from '../server/audio.js';

const preferences = () => ({ source: 'INT. ROOM - DAY\n\nDAVID\nHello.', name: 'Test script', role: 'DAVID', cast: { DAVID: 'MyVoice' }, guesses: {}, genders: {}, manualVoices: {}, sceneId: 'scene-1', gap: 0, directions: false, hide: false, follow: true, loop: false, rate: 1, mode: 'full' });
const input = (number = 1) => ({ scene: { id: `scene-${number}`, title: `Scene ${number}`, lines: [{ id: `line-${number}`, character: 'DAVID', text: 'Hello.', kind: 'dialogue' }] }, voices: { DAVID: 'MyVoice' }, myCharacter: 'DAVID', gapSeconds: 0, includeDirections: false });
const wav = encodeWav(Buffer.alloc(4800, 16));
const post = (base, endpoint, body, method = 'POST', headers = {}) => fetch(base + endpoint, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function fixture(fn) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'script-glow-projects-')); const projectsDir = path.join(temp, '.apps', 'library'); /* a dot folder above the app, as in ~/.local */ const cacheDir = path.join(temp, 'cache'); let calls = 0;
  const app = createApp({ cacheDir, projectsDir, previewDir: path.join(temp, 'previews'), connectionsFile: path.join(temp, 'connections.json'), secretsFile: path.join(temp, 'secrets.json'), serviceFetch: async url => { if (url.endsWith('/v1/voices')) return Buffer.from('["MyVoice"]'); if (url.endsWith('/health')) return Buffer.from('{}'); calls++; return wav; } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ base, projectsDir, cacheDir, calls: () => calls, store: createProjectStore(projectsDir, cacheDir) }); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
}
async function render(base, projectId, number = 1) {
  const body = input(number); const key = JSON.stringify(body);
  const response = await post(base, '/api/render', { ...body, ...(projectId ? { projectId, renderKey: key } : {}) }); assert.equal(response.status, 202, await response.clone().text());
  const { jobId } = await response.json();
  for (let n = 0; n < 500; n++) { const job = await (await fetch(`${base}/api/jobs/${jobId}`)).json(); if (!['queued', 'running'].includes(job.status)) { assert.equal(job.status, 'complete', job.error); return { key, result: job.result }; } await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Render did not finish.');
}

test('project create is idempotent; validated autosave revision prevents stale-tab overwrite', async () => fixture(async ({ base, store }) => {
  const id = randomUUID(); const prefs = preferences(); const created = await post(base, '/api/projects', { id, preferences: prefs }); assert.equal(created.status, 201);
  assert.equal((await created.json()).revision, 1);
  assert.equal((await post(base, '/api/projects', { id, preferences: prefs })).status, 201);
  assert.equal((await post(base, '/api/projects', { id, preferences: { ...prefs, name: 'Other' } })).status, 409);
  const changes = await Promise.all(['First', 'Second'].map(name => post(base, `/api/projects/${id}`, { revision: 1, preferences: { ...prefs, name } }, 'PUT')));
  assert.deepEqual(changes.map(item => item.status).sort(), [200, 409]);
  assert.equal((await store.get(id)).revision, 2);
  assert.equal((await post(base, `/api/projects/${id}`, { revision: 2, preferences: { ...prefs, gap: -1 } }, 'PUT')).status, 400);
  assert.equal((await post(base, `/api/projects/${id}`, { revision: 2, preferences: prefs }, 'PUT', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(`${base}/api/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${base}/api/projects/not-a-uuid`)).status, 400);
}));

test('durable render commits before complete, survives restart/cache removal and retains over twenty scenes', async () => fixture(async ({ base, projectsDir, cacheDir, calls }) => {
  const document = await (await post(base, '/api/projects', { preferences: preferences() })).json(); let first;
  for (let i = 1; i <= 22; i++) { const item = await render(base, document.id, i); if (!first) first = item; }
  assert.equal(calls(), 1);
  const restarted = createProjectStore(projectsDir, cacheDir); const saved = await restarted.get(document.id);
  assert.equal(saved.renders.length, 22); assert.equal(saved.revision, 1);
  assert.deepEqual(saved.renders[0], first);
  const original = Buffer.from(await (await fetch(base + first.result.fullUrl)).arrayBuffer()); assert.deepEqual(original, wav);
  await rm(path.join(cacheDir, 'renders'), { recursive: true, force: true });
  assert.deepEqual(Buffer.from(await (await fetch(base + first.result.fullUrl)).arrayBuffer()), wav);
  const range = await fetch(base + first.result.fullUrl, { headers: { Range: 'bytes=0-43' } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 44);
  const summary = await (await fetch(base + '/api/projects')).json(); assert.equal(summary.projects[0].renderCount, 22);
  const wrong = input(); assert.equal((await post(base, '/api/render', { ...wrong, projectId: document.id, renderKey: JSON.stringify({ ...wrong, gapSeconds: 2 }) })).status, 400);
}));

test('legacy migration copies only known WAV pairs and explicitly reports expired files', async () => fixture(async ({ base, cacheDir }) => {
  const document = await (await post(base, '/api/projects', { preferences: preferences() })).json(); const item = await render(base);
  const response = await post(base, `/api/projects/${document.id}/renders`, item); assert.equal(response.status, 200);
  const durable = await response.json(); assert.match(durable.result.fullUrl, /\/api\/projects\//);
  assert.deepEqual(await (await post(base, `/api/projects/${document.id}/renders`, item)).json(), durable);
  const expired = await render(base, undefined, 2); await unlink(path.join(cacheDir, 'renders', expired.result.fullUrl.slice(7)));
  assert.equal((await post(base, `/api/projects/${document.id}/renders`, expired)).status, 404);
  assert.equal((await post(base, `/api/projects/${document.id}/renders`, { ...expired, result: { ...expired.result, fullUrl: '/audio/../../secret.wav' } })).status, 400);
  assert.equal((await post(base, `/api/projects/${document.id}/renders`, { ...expired, result: { ...expired.result, fullUrl: 'http://example.com/file.wav' } })).status, 400);
}));

test('missing durable WAV is excluded from saved badges and warns without deleting metadata', async () => fixture(async ({ base, projectsDir }) => {
  const document = await (await post(base, '/api/projects', { preferences: preferences() })).json(); const item = await render(base, document.id);
  await unlink(path.join(projectsDir, document.id, path.basename(item.result.fullUrl)));
  const loaded = await (await fetch(`${base}/api/projects/${document.id}`)).json(); assert.equal(loaded.renders.length, 0); assert.match(loaded.warnings.join(), /missing or invalid/);
  const raw = JSON.parse(await readFile(path.join(projectsDir, document.id, 'project.json'), 'utf8')); assert.equal(raw.renders.length, 1);
  assert.equal((await fetch(base + item.result.fullUrl)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/${document.id}/backup-info`)).status, 422, 'Export preflight exposes missing audio as a UI-readable error');
  const repaired = await render(base, document.id); assert.equal((await fetch(base + repaired.result.fullUrl)).status, 200);
}));

test('corrupt primary recovers previous manifest and preserves it on next save', async () => fixture(async ({ base, projectsDir }) => {
  const prefs = preferences(); const document = await (await post(base, '/api/projects', { preferences: prefs })).json();
  await post(base, `/api/projects/${document.id}`, { revision: 1, preferences: { ...prefs, name: 'New name' } }, 'PUT');
  const filename = path.join(projectsDir, document.id, 'project.json'); await writeFile(filename, '{broken');
  const recovered = await (await fetch(`${base}/api/projects/${document.id}`)).json(); assert.equal(recovered.preferences.name, prefs.name); assert.match(recovered.warnings.join(), /previous/);
  assert.equal((await post(base, `/api/projects/${document.id}`, { revision: 1, preferences: prefs }, 'PUT')).status, 200);
  assert.equal(JSON.parse(await readFile(filename + '.previous', 'utf8')).preferences.name, prefs.name);
  await writeFile(filename, '{broken'); await writeFile(filename + '.previous', '{broken');
  assert.equal((await fetch(`${base}/api/projects/${document.id}`)).status, 422);
  const listing = await (await fetch(base + '/api/projects')).json(); assert.equal(listing.projects.length, 0); assert.match(listing.warnings.join(), /preserved/);
}));

test('backup restores a fresh project with byte-identical audio, and rejects corrupt/truncated/traversal/trailing bundles', async () => fixture(async ({ base, projectsDir }) => {
  const document = await (await post(base, '/api/projects', { preferences: preferences() })).json(); const item = await render(base, document.id);
  const response = await fetch(`${base}/api/projects/${document.id}/backup`); assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /sgbackup/);
  const backup = Buffer.from(await response.arrayBuffer()); assert.equal(backup.toString('ascii', 0, 8), 'SGLOWB01');
  const info = await (await fetch(`${base}/api/projects/${document.id}/backup-info`)).json(); assert.equal(info.bytes, backup.length);
  const restore = bytes => fetch(base + '/api/projects/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  const restoredResponse = await restore(backup); assert.equal(restoredResponse.status, 201, await restoredResponse.clone().text()); const restored = await restoredResponse.json();
  assert.notEqual(restored.id, document.id); assert.deepEqual(restored.preferences, document.preferences); assert.equal(restored.renders.length, 1);
  assert.deepEqual(Buffer.from(await (await fetch(base + restored.renders[0].result.fullUrl)).arrayBuffer()), wav);
  assert.deepEqual(Buffer.from(await (await fetch(base + item.result.practiceUrl)).arrayBuffer()), Buffer.concat([wav.subarray(0, 44), Buffer.alloc(4800)]));
  const corrupted = Buffer.from(backup); corrupted[corrupted.length - 1] ^= 1;
  for (const bytes of [backup.subarray(0, 6), backup.subarray(0, backup.length - 20), Buffer.concat([backup, Buffer.from('extra')]), corrupted]) assert.equal((await restore(bytes)).status, 422);
  const metaSize = backup.readUInt32BE(8); const metadata = JSON.parse(backup.toString('utf8', 12, 12 + metaSize)); metadata.files[0].name = '../../outside.wav';
  const changed = Buffer.from(JSON.stringify(metadata)); const header = Buffer.from(backup.subarray(0, 12)); header.writeUInt32BE(changed.length, 8);
  assert.equal((await restore(Buffer.concat([header, changed, backup.subarray(12 + metaSize)]))).status, 422);
  assert.equal((await fetch(base + '/api/projects/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: 'https://evil.example' }, body: backup })).status, 403);
  assert.equal((await post(base, '/api/projects/restore', {})).status, 415);
  assert.equal((await readdir(projectsDir)).filter(name => name.startsWith('.restore-')).length, 0);
  assert.equal((await (await fetch(base + '/api/projects')).json()).projects.length, 2);
}));

test('re-render keeps the pair the recovery manifest needs and deletes older superseded audio', async () => fixture(async ({ base, projectsDir }) => {
  const document = await (await post(base, '/api/projects', { preferences: preferences() })).json();
  const first = await render(base, document.id); const second = await render(base, document.id); const third = await render(base, document.id);
  assert.notEqual(first.result.fullUrl, second.result.fullUrl);
  const saved = await (await fetch(`${base}/api/projects/${document.id}`)).json();
  assert.equal(saved.renders.length, 1); assert.equal(saved.renders[0].result.fullUrl, third.result.fullUrl);
  const files = (await readdir(path.join(projectsDir, document.id))).filter(name => name.endsWith('.wav')).sort();
  const names = run => ['fullUrl', 'practiceUrl'].map(key => path.basename(run.result[key]));
  assert.deepEqual(files, [...names(second), ...names(third)].sort());
}));

test('old render versions are evicted beyond the per-project limit and their audio is removed', async () => fixture(async ({ base, projectsDir, cacheDir }) => {
  const store = createProjectStore(projectsDir, cacheDir, { maxRenders: 2 });
  const document = await (await post(base, '/api/projects', { preferences: preferences() })).json();
  const runs = [];
  for (let number = 1; number <= 4; number++) { const run = await render(base, undefined, number); runs.push(await store.attach(document.id, run.key, run.result)); }
  const saved = await store.get(document.id);
  assert.deepEqual(saved.renders.map(entry => entry.key), runs.slice(2).map(entry => entry.key));
  const files = await readdir(path.join(projectsDir, document.id));
  for (const url of [runs[0].result.fullUrl, runs[0].result.practiceUrl]) assert.ok(!files.includes(path.basename(url)));
}));

test('deleting a project moves all of it to .trash, lists it no more, and needs this launch\'s secret from a browser', async () => fixture(async ({ base, projectsDir }) => {
  const created = await (await post(base, '/api/projects', { preferences: preferences() })).json();
  const { session } = await (await fetch(`${base}/api/session`)).json();
  const outsider = await fetch(`${base}/api/projects/${created.id}`, { method: 'DELETE', headers: { Origin: base } });
  assert.equal(outsider.status, 403, 'A page elsewhere cannot delete a project');
  const removed = await fetch(`${base}/api/projects/${created.id}`, { method: 'DELETE', headers: { Origin: base, 'x-script-glow-session': session } });
  assert.equal(removed.status, 200);
  const { keptIn } = await removed.json();
  assert.match(keptIn, new RegExp(`^\\.trash[\\\\/]${created.id}-\\d+$`));
  assert.equal(JSON.parse(await readFile(path.join(projectsDir, keptIn, 'project.json'), 'utf8')).id, created.id, 'The project is kept whole in the trash');
  assert.equal((await (await fetch(`${base}/api/projects`)).json()).projects.some(item => item.id === created.id), false);
  assert.equal((await fetch(`${base}/api/projects/${created.id}`, { method: 'DELETE' })).status, 404, 'A project cannot be deleted twice');
  assert.equal((await fetch(`${base}/api/projects/..%2F..%2Fetc`, { method: 'DELETE' })).status >= 400, true);
}));

test('build up line by line and its repeat count are kept with the project', () => {
  const kept = validatePreferences({ ...preferences(), build: true, buildRepeats: 3 });
  assert.equal(kept.build, true);
  assert.equal(kept.buildRepeats, 3);
  assert.equal(validatePreferences(preferences()).buildRepeats, 2);
  for (const buildRepeats of [0, 1.5, '3', 11]) assert.throws(() => validatePreferences({ ...preferences(), buildRepeats }), /rehearsal settings/);
});

test('say it like respellings are kept per character and checked', () => {
  assert.deepEqual(validatePreferences({ ...preferences(), sayAs: { SIOBHAN: 'shi-VAWN' } }).sayAs, { SIOBHAN: 'shi-VAWN' });
  assert.deepEqual(validatePreferences(preferences()).sayAs, {}, 'Projects saved before this feature have none');
  for (const how of ['x'.repeat(101), 'a\nb', '', 3]) assert.throws(() => validatePreferences({ ...preferences(), sayAs: { SIOBHAN: how } }), /casting preferences/);
});

test('listening travels with the project, and a nonsense pause is refused', () => {
  const base = validatePreferences(preferences());
  assert.equal(base.autoContinue, false, 'A project saved before listening existed opens with it off');
  assert.equal(base.holdMs, 500);
  const listening = validatePreferences({ ...preferences(), autoContinue: true, holdMs: 3000 });
  assert.equal(listening.autoContinue, true);
  assert.equal(listening.holdMs, 3000, 'The pause the actor set is kept with the project');
  for (const holdMs of [250, 700, 5500, 0, '500', 1.5]) {
    assert.throws(() => validatePreferences({ ...preferences(), holdMs }), /rehearsal settings/, `Refused: ${holdMs}`);
  }
  assert.throws(() => validatePreferences({ ...preferences(), autoContinue: 'yes' }), /rehearsal settings/);
  assert.equal(base.checkLines, false, 'Checking what was said is off until the actor asks for it');
  assert.equal(validatePreferences({ ...preferences(), checkLines: true }).checkLines, true);
  assert.throws(() => validatePreferences({ ...preferences(), checkLines: 'sure' }), /rehearsal settings/);
});
