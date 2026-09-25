import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readBackup, sceneTracks } from '../mobile/src/backup.ts';

const ID = '11111111-2222-3333-4444-555555555555';
const source = 'INT. DOCK - NIGHT\n\nTHEO\nYou came.\n\nMAYA\nI almost did not.\n\nINT. FERRY - LATER\n\nTHEO\nForty minutes.\n';
const render = (key: string, first: string, last: string, title?: string) => ({ key, ...(title ? { title } : {}), result: {
  fullUrl: `/api/projects/${ID}/audio/${ID}-full.wav`, practiceUrl: `/api/projects/${ID}/audio/${ID}-practice.wav`, duration: 2,
  cues: [{ lineId: first, character: 'THEO', start: 0, end: 1 }, { lineId: last, character: 'MAYA', start: 1, end: 2 }] } });
const project = { id: ID, updatedAt: '2026-09-23T00:00:00Z', preferences: { name: 'Ferry', role: 'MAYA', source }, renders: [render('r-old', 'line-1', 'line-2'), render('r-new', 'line-1', 'line-2')] };

function pack(meta: object, wavs: Buffer[]): ArrayBuffer {
  const json = Buffer.from(JSON.stringify(meta));
  const header = Buffer.alloc(12); header.write('SGLOWB01'); header.writeUInt32BE(json.length, 8);
  const all = Buffer.concat([header, json, ...wavs]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}
const wav = (fill: number) => Buffer.alloc(100, fill);
const entry = (name: string, bytes: Buffer) => ({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });

test('reads the project and every WAV from a backup', async () => {
  const [full, practice] = [wav(1), wav(2)];
  const backup = await readBackup(pack({ version: 1, project, files: [entry(`${ID}-full.wav`, full), entry(`${ID}-practice.wav`, practice)] }, [full, practice]));
  assert.equal(backup.project.preferences.role, 'MAYA');
  assert.deepEqual([...backup.audio.keys()], [`${ID}-full.wav`, `${ID}-practice.wav`]);
  assert.equal((await backup.audio.get(`${ID}-practice.wav`)!.arrayBuffer()).byteLength, 100);
});

test('refuses a backup that is not one, is cut short or has damaged audio', async () => {
  await assert.rejects(readBackup(new ArrayBuffer(40)), /not a Script Glow backup/);
  const full = wav(1);
  const good = pack({ version: 1, project, files: [entry(`${ID}-full.wav`, full)] }, [full]);
  await assert.rejects(readBackup(good.slice(0, good.byteLength - 1)), /cut short/);
  await assert.rejects(readBackup(pack({ version: 1, project, files: [entry(`${ID}-full.wav`, full)] }, [wav(9)])), /damaged/);
});

test('one track per span of lines, newest render wins, lines include what sits between cues', () => {
  const tracks = sceneTracks({ ...project, renders: [...project.renders, render('r-two', 'line-3', 'line-3', 'Ferry, later')] } as never);
  assert.deepEqual(tracks.map(track => [track.key, track.title]), [['r-new', 'INT. DOCK - NIGHT'], ['r-two', 'Ferry, later']]);
  assert.deepEqual(tracks[0].lines.map(line => line.text), ['You came.', 'I almost did not.']);
  assert.equal(tracks[0].practice, `${ID}-practice.wav`);
});
