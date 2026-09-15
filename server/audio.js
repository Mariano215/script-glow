export const SAMPLE_RATE = 24000;
const MAX_LINE_SECONDS = 120;

// Decode RIFF chunks, including non-audio chunks emitted by torchaudio.
// Normalize to one fixed PCM16 mono format so every export shares a timeline.
export function decodeWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('TTS returned an invalid WAV file.');
  const declaredEnd = buffer.readUInt32LE(4) + 8;
  if (declaredEnd > buffer.length || declaredEnd < 44) throw new Error('Truncated WAV file.');
  let fmt, data;
  for (let offset = 12; offset + 8 <= declaredEnd;) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > declaredEnd) throw new Error('Truncated WAV chunk.');
    if (type === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format.');
      let format = buffer.readUInt16LE(start);
      if (format === 65534 && size >= 40) format = buffer.readUInt16LE(start + 24);
      fmt = { format, channels: buffer.readUInt16LE(start + 2), rate: buffer.readUInt32LE(start + 4), align: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14) };
    }
    if (type === 'data') data = buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!fmt || !data || ![1, 3].includes(fmt.format) || ![1, 2].includes(fmt.channels) || fmt.rate < 8000 || fmt.rate > 96000 || ![16, 24, 32].includes(fmt.bits) || (fmt.format === 3 && fmt.bits !== 32)) throw new Error('Unsupported WAV audio format.');
  const bytes = fmt.bits / 8;
  if (fmt.align !== bytes * fmt.channels || data.length % fmt.align !== 0) throw new Error('Invalid WAV sample alignment.');
  const frames = data.length / fmt.align;
  if (frames === 0 || frames / fmt.rate > MAX_LINE_SECONDS) throw new Error('TTS line audio must be between 0 and 120 seconds.');
  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let value = 0;
    for (let channel = 0; channel < fmt.channels; channel++) {
      const offset = frame * fmt.align + channel * bytes;
      const sample = fmt.format === 3 ? data.readFloatLE(offset) : data.readIntLE(offset, bytes) / (2 ** (fmt.bits - 1));
      if (!Number.isFinite(sample)) throw new Error('Invalid non-finite WAV sample.');
      value += sample / fmt.channels;
    }
    mono[frame] = Math.max(-1, Math.min(1, value));
  }
  const output = Buffer.alloc(Math.round(frames * SAMPLE_RATE / fmt.rate) * 2);
  for (let i = 0; i < output.length / 2; i++) {
    const source = i * fmt.rate / SAMPLE_RATE;
    const lo = Math.min(Math.floor(source), frames - 1);
    const hi = Math.min(lo + 1, frames - 1);
    const value = mono[lo] + (mono[hi] - mono[lo]) * (source - lo);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32768))), i * 2);
  }
  return output;
}

export function wavHeader(pcmBytes) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcmBytes, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcmBytes, 40);
  return header;
}

export function encodeWav(pcm) {
  return Buffer.concat([wavHeader(pcm.length), pcm]);
}

export function assembleScene(items, myCharacter, gapSeconds) {
  const full = [], practice = [], cues = [];
  const gap = Buffer.alloc(Math.round(gapSeconds * SAMPLE_RATE) * 2);
  let samples = 0;
  for (const { line, pcm } of items) {
    const start = samples / SAMPLE_RATE;
    samples += pcm.length / 2;
    if (samples / SAMPLE_RATE > 1800) throw new Error('Scene exceeds the 30 minute export limit. Split it into smaller scenes.');
    cues.push({ lineId: line.id, character: line.character, start, end: samples / SAMPLE_RATE });
    full.push(pcm, gap);
    practice.push(line.kind === 'dialogue' && line.character === myCharacter ? Buffer.alloc(pcm.length) : pcm, gap);
    samples += gap.length / 2;
    if (samples / SAMPLE_RATE > 1800) throw new Error('Scene exceeds the 30 minute export limit. Split it into smaller scenes.');
  }
  return { full: encodeWav(Buffer.concat(full)), practice: encodeWav(Buffer.concat(practice)), duration: samples / SAMPLE_RATE, cues };
}
