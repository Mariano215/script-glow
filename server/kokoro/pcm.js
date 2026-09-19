// Model output (float samples, -1 to 1) to the app's 16-bit PCM. NaN would round to 0 and pass as
// silence, so output that is not all numbers, or has no sound at all, is refused. Kept in this folder
// because the worker is unpacked from app.asar with server/kokoro/** only.
export function floatToPcm(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('the voice model gave audio that is not a number');
    const value = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    peak = Math.max(peak, Math.abs(value));
    pcm.writeInt16LE(value, i * 2);
  }
  if (!peak) throw new Error('the voice model gave audio with no sound');
  return pcm;
}
