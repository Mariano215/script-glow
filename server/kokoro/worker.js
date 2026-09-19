// Runs Kokoro-82M and the G2P for client.js, one line at a time, in order. The files come from the
// folder in argv[2] (downloaded by assets.js); nothing is fetched from the network. speak() does
// what kokoro-js's generate_from_ids does (Apache-2.0) without kokoro-js, which imports the
// espeak-ng phonemizer (GPL).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AutoTokenizer, StyleTextToSpeech2Model, Tensor, env } from '@huggingface/transformers';
import { floatToPcm } from './pcm.js';
import { loadG2P } from './g2p.js';

const dir = process.argv[2];
env.allowRemoteModels = false;
env.localModelPath = `${dir}${path.sep}`;
let model = null;
const g2ps = new Map(), styles = new Map();
const once = (map, key, make) => { if (!map.has(key)) map.set(key, make()); return map.get(key); };

async function speak(voice, text) {
  if (!/^[ab][fm]_[a-z]+$/.test(voice)) throw new Error('that is not a built-in voice');
  model ??= Promise.all([StyleTextToSpeech2Model.from_pretrained('kokoro', { dtype: 'fp16', device: 'cpu' }), AutoTokenizer.from_pretrained('kokoro')]);
  const [tts, tokenizer] = await model;
  // Voices whose names start with b are British and read with the British word lists.
  const g2p = await once(g2ps, voice[0], () => loadG2P(path.join(dir, 'g2p'), { british: voice[0] === 'b' }));
  const style = await once(styles, voice, async () => {
    const bytes = await readFile(path.join(dir, 'kokoro', 'voices', `${voice}.bin`));
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  });
  const { input_ids } = tokenizer(await g2p(text), { truncation: true });
  // A voice holds one 256-value style for each input length; the one for this line's length is used.
  const at = Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509) * 256;
  const { waveform } = await tts({ input_ids, style: new Tensor('float32', style.slice(at, at + 256), [1, 256]), speed: new Tensor('float32', [1], [1]) });
  // 24 kHz float samples to the app's 16-bit PCM at the same rate. Throws on NaN or silence.
  const pcm = floatToPcm(waveform.data);
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length);
}

// The desktop app starts this file as an Electron utility process (messages on process.parentPort);
// plain Node forks it with child_process.
const port = process.parentPort;
const reply = message => port ? port.postMessage(message) : process.send(message);
let queue = Promise.resolve();
function receive({ id, voice, text }) {
  queue = queue.then(async () => {
    try { reply({ id, pcm: await speak(voice, text) }); }
    catch (error) { reply({ id, error: `Built-in voices could not read this line: ${error.message}` }); }
  });
}
if (port) port.on('message', event => receive(event.data)); else process.on('message', receive);
// Under plain Node the worker goes when the server does.
process.on('disconnect', () => process.exit(0));
