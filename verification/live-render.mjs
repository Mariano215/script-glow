// Integration check against the running app and real local Chatterbox service.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:3001';
const reportDir = new URL('../artifacts/', import.meta.url);
await mkdir(reportDir, { recursive: true });
async function json(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const result = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(result)}`);
  return result;
}
const { voices } = await json('/api/voices');
const { casting } = await json('/api/connections');
const actorVoice = casting.preferredActorVoice || voices[0];
assert.ok(voices.includes(actorVoice), 'The preferred actor voice must be installed.');
const partnerVoice = voices.find((voice) => voice === 'Stock-Mica') || voices.find((voice) => voice === 'British-Female') || voices.find((voice) => ![actorVoice, 'default'].includes(voice));
assert.ok(partnerVoice, 'A distinct scene partner voice is required.');
const scene = {
  id: 'live-smoke', title: 'The rehearsal room', lines: [
    { id: 'cue-1', kind: 'dialogue', character: 'PARTNER', text: 'Are you ready to begin?' },
    { id: 'cue-2', kind: 'dialogue', character: 'JORDAN', text: 'Yes. Let us take it from the top.' },
    { id: 'cue-3', kind: 'dialogue', character: 'PARTNER', text: 'Good. The stage is yours.' },
  ],
};
const { jobId } = await json('/api/render', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ scene, voices: { JORDAN: actorVoice, PARTNER: partnerVoice }, myCharacter: 'JORDAN', gapSeconds: 0.5, includeDirections: false }),
});
let job;
let previous = '';
const deadline = Date.now() + 600_000;
do {
  job = await json(`/api/jobs/${jobId}`);
  const status = `${job.status} ${job.completed}/${job.total}`;
  if (status !== previous) console.log(status);
  previous = status;
  assert.notEqual(job.status, 'error', job.error);
  assert.ok(Date.now() < deadline, 'Render timed out.');
  if (job.status !== 'complete') await new Promise((resolve) => setTimeout(resolve, 1500));
} while (job.status !== 'complete');
function wav(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  let format;
  let samples;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + size <= buffer.length);
    const id = buffer.toString('ascii', offset, offset + 4);
    if (id === 'fmt ') format = { kind: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), rate: buffer.readUInt32LE(start + 4), frameSize: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14) };
    if (id === 'data') samples = buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  assert.ok(format && samples);
  assert.ok([1, 3].includes(format.kind));
  assert.ok(format.bits >= 16, 'Zero-byte silence check requires signed PCM or float.');
  return { ...format, samples, duration: samples.length / format.frameSize / format.rate };
}
const [fullBuffer, practiceBuffer] = await Promise.all([job.result.fullUrl, job.result.practiceUrl].map(async (url) => {
  const response = await fetch(new URL(url, base));
  assert.ok(response.ok);
  return Buffer.from(await response.arrayBuffer());
}));
const full = wav(fullBuffer);
const practice = wav(practiceBuffer);
assert.equal(full.duration, practice.duration);
assert.ok(Math.abs(full.duration - job.result.duration) < 0.01);
assert.equal(job.result.cues.length, 3);
for (const cue of job.result.cues) {
  const start = Math.round(cue.start * full.rate) * full.frameSize;
  const end = Math.round(cue.end * full.rate) * full.frameSize;
  const spoken = full.samples.subarray(start, end);
  const rehearsal = practice.samples.subarray(start, end);
  assert.ok(spoken.some((value) => value !== 0), `${cue.lineId} contains real audio`);
  if (cue.character === 'JORDAN') assert.ok(rehearsal.every((value) => value === 0), 'actor cue is sample-exact silence');
  else assert.deepEqual(rehearsal, spoken, 'Partner cue is identical in both tracks');
}
await writeFile(new URL('live-full.wav', reportDir), fullBuffer);
await writeFile(new URL('live-practice.wav', reportDir), practiceBuffer);
await writeFile(new URL('live-render.json', reportDir), JSON.stringify({ base, checkedAt: new Date().toISOString(), partnerVoice, scene, job, verified: ['real voiced cues', 'identical track lengths', 'sample-exact muted role', 'unchanged partner audio'] }, null, 2));
console.log(`PASS: ${full.duration.toFixed(2)}s; real actor voice; identical timelines; silent practice role. Artifacts saved.`);
