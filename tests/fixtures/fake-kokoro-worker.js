// Stands in for server/kokoro/worker.js in tests: the same messages, no model. The text decides
// what happens: "hang" never answers, "crash" exits, "crash-once" exits only the first time,
// "fail" answers with an error, "slow ..." takes a moment. Every request is logged to calls.log in
// the folder given as the first argument, and this process id to worker.pid there. The audio carries
// this process id and what was asked.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const port = process.parentPort;
writeFileSync(path.join(dir, 'worker.pid'), String(process.pid));
const reply = message => port ? port.postMessage(message) : process.send(message);
let busy = false;
async function handle({ id, voice, text }) {
  appendFileSync(path.join(dir, 'calls.log'), `${voice}|${text}\n`);
  if (busy) { reply({ id, error: 'Two requests at once.' }); return; }
  busy = true;
  if (text === 'hang') return;
  if (text === 'crash') process.exit(3);
  if (text === 'crash-once' && !existsSync(path.join(dir, 'crashed'))) { writeFileSync(path.join(dir, 'crashed'), ''); process.exit(3); }
  if (text.startsWith('slow')) await new Promise(resolve => setTimeout(resolve, 200));
  busy = false;
  if (text === 'fail') { reply({ id, error: 'The model could not read this line.' }); return; }
  const pcm = Buffer.alloc(4800), said = Buffer.from(`${voice}|${text}`);
  pcm.writeInt32LE(process.pid, 0); pcm.writeInt32LE(said.length, 4); said.copy(pcm, 8);
  reply({ id, pcm: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length) });
}
if (port) port.on('message', event => handle(event.data)); else process.on('message', handle);
process.on('disconnect', () => process.exit(0));
