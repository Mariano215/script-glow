import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assetName, assetsReady, cacheIdentity, createDownloader, voiceList } from '../server/kokoro/assets.js';

const bytes = (length, seed) => Buffer.from(Array.from({ length }, (_, i) => (i * 7 + seed) % 251));
const sha = data => createHash('sha256').update(data).digest('hex');
const FILES = { 'kokoro/onnx/model_fp16.onnx': bytes(300000, 1), 'kokoro/voices/af_heart.bin': bytes(5000, 2), 'g2p/us_gold.json': bytes(7000, 3) };
const MODEL = 'kokoro/onnx/model_fp16.onnx';
const manifestAt = base => ({ version: 1, tag: 'test', base, files: Object.entries(FILES).map(([file, data]) => ({ path: file, size: data.length, sha256: sha(data) })) });

// A fake release on this computer. cut: the first answer for the model stops after that many
// bytes. wrong: that file is served with other bytes. Every Range header asked for is kept.
async function release(t, { cut = 0, wrong = '' } = {}) {
  const ranges = [];
  let cutDone = false;
  const server = http.createServer((req, res) => {
    const found = Object.entries(FILES).find(([file]) => `/${assetName(file)}` === req.url);
    if (!found) { res.writeHead(404).end(); return; }
    let body = found[0] === wrong ? bytes(found[1].length, 99) : found[1];
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    if (range) { ranges.push(`${assetName(found[0])} ${req.headers.range}`); body = body.subarray(Number(range[1])); }
    res.writeHead(range ? 206 : 200, { 'Content-Length': body.length });
    if (cut && !cutDone && found[0] === MODEL) { cutDone = true; res.write(body.subarray(0, cut), () => setTimeout(() => res.destroy(), 100)); return; }
    res.end(body);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'script-glow-assets-'));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); });
  return { manifest: manifestAt(`http://127.0.0.1:${server.address().port}`), dir, ranges };
}

test('downloads every file, checks each hash, and only then says ready', async t => {
  const { manifest, dir } = await release(t);
  const download = createDownloader({ dir, manifest });
  assert.equal(await assetsReady(dir, manifest), false);
  assert.equal(download.start(), download.start(), 'A second start joins the running download');
  await download.start();
  assert.deepEqual(download.state(), { status: 'ready', received: 312000, total: 312000, error: '' });
  assert.equal(await assetsReady(dir, manifest), true);
  assert.deepEqual(await readFile(path.join(dir, MODEL)), FILES[MODEL]);
  await download.remove();
  assert.equal(await assetsReady(dir, manifest), false, 'Remove deletes the files');
});

test('an interrupted download is never used, and resumes where it stopped', async t => {
  const { manifest, dir, ranges } = await release(t, { cut: 100000 });
  const download = createDownloader({ dir, manifest });
  await download.start();
  assert.equal(download.state().status, 'error');
  assert.match(download.state().error, /internet connection/);
  assert.equal(await assetsReady(dir, manifest), false);
  const kept = (await stat(path.join(dir, `${MODEL}.part`))).size;
  assert.ok(kept > 0 && kept < FILES[MODEL].length, `A part of the model is kept (${kept} bytes)`);
  await download.start();
  assert.equal(download.state().status, 'ready', download.state().error);
  assert.deepEqual(ranges, [`${assetName(MODEL)} bytes=${kept}-`]);
  assert.deepEqual(await readFile(path.join(dir, MODEL)), FILES[MODEL]);
});

test('a file with the wrong hash is refused and removed', async t => {
  const { manifest, dir } = await release(t, { wrong: 'kokoro/voices/af_heart.bin' });
  const download = createDownloader({ dir, manifest });
  await download.start();
  assert.match(download.state().error, /damaged/);
  await assert.rejects(stat(path.join(dir, 'kokoro/voices/af_heart.bin')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(dir, 'kokoro/voices/af_heart.bin.part')), { code: 'ENOENT' });
  assert.equal(await assetsReady(dir, manifest), false);
});

test('a full disk says so, and no file is left looking finished', async t => {
  const { manifest, dir } = await release(t);
  const full = async (file, flags) => { const handle = await open(file, flags); return { appendFile: async () => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }); }, close: () => handle.close() }; };
  const download = createDownloader({ dir, manifest, openFile: full });
  await download.start();
  assert.match(download.state().error, /not enough free disk space/);
  await assert.rejects(stat(path.join(dir, MODEL)), { code: 'ENOENT' });
});

test('voices come from the voice files, best rated first, accent and gender from the name', () => {
  const list = voiceList({ files: ['bm_george', 'am_adam', 'af_heart', 'bf_emma'].map(name => ({ path: `kokoro/voices/${name}.bin`, size: 1, sha256: '' })) });
  assert.deepEqual(list.map(voice => voice.id), ['kokoro:af_heart', 'kokoro:bf_emma', 'kokoro:bm_george', 'kokoro:am_adam']);
  assert.deepEqual(list[0], { id: 'kokoro:af_heart', label: 'Heart', gender: 'female', accent: 'US' });
  assert.deepEqual(list[2], { id: 'kokoro:bm_george', label: 'George', gender: 'male', accent: 'UK' });
});

test('a manifest path outside the folder is refused, not followed', async t => {
  const { dir } = await release(t);
  const bad = ['../x.bin', '/etc/x', 'kokoro/../../x', 'C:\\x', 'kokoro//x.bin'];
  for (const file of bad) {
    const manifest = { version: 1, tag: 'test', base: 'http://127.0.0.1:1', files: [{ path: file, size: 1, sha256: sha(Buffer.from('x')) }] };
    assert.equal(await assetsReady(dir, manifest), false, file);
    const download = createDownloader({ dir, manifest });
    await download.start();
    assert.equal(download.state().status, 'error', file);
    assert.match(download.state().error, /invalid/, file);
  }
  await assert.rejects(stat(path.resolve(dir, '..', 'x.bin')), { code: 'ENOENT' });
});

test('the cache identity changes with the model file and with any G2P file', () => {
  const manifest = manifestAt('https://example.invalid');
  const before = cacheIdentity(manifest);
  const model = structuredClone(manifest); model.files[0].sha256 = 'new';
  const words = structuredClone(manifest); words.files[2].sha256 = 'new';
  assert.notEqual(cacheIdentity(model).model, before.model);
  assert.notEqual(cacheIdentity(words).g2p, before.g2p);
  assert.match(before.g2p, /^misaki-js-1:/);
});
