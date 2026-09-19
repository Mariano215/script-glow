# Kokoro research, 2026-09-19

Evidence for `docs/superpowers/specs/2026-09-19-kokoro-engine-design.md`. Everything here comes from two throwaway spikes. The code is reference material for the implementation, not production code.

## Spike 1: can Kokoro run inside the desktop app?

Verdict: feasible with conditions. The spike agent could not write its own findings file, so this summary records its reported results.

- Runs on CPU with `kokoro-js` over transformers.js and the native onnxruntime-node binding, under plain Node, under Electron 44.4.3 with `ELECTRON_RUN_AS_NODE`, and inside a real `utilityProcess.fork`. No Python.
- Seconds per line on an Apple M2 Pro CPU: fp32 0.74 s (real-time factor 0.175), fp16 0.79 s (0.19), q8 1.96 s (0.46). q8 is slower than fp32 here. A first call after a cached load takes 0.9 to 1.5 s.
- Model size: q8 92 MB, fp16 163 MB, fp32 326 MB. By default transformers.js caches downloads inside `node_modules`, which is read-only in the packed app. Loading from a chosen folder with network lookups off works.
- Runtime added to the installer: about 55 MB zipped (130 to 220 MB unpacked).
- Output: 24 kHz mono Float32. The app works at 24 kHz, so no resampling. Converting to 16-bit PCM is one line.
- Voices: 54 in total, 28 English (US 11 female and 9 male, UK 4 female and 4 male). About 10 are rated C+ or better.
- Windows: onnxruntime-node 1.21.0 ships win32 x64 binaries. Not run on Windows.
- License: model, voices, kokoro-js and transformers.js are Apache-2.0, and ONNX Runtime is MIT. The `phonemizer` package used by kokoro-js is labeled Apache-2.0 but embeds espeak-ng, which is GPL-3.0 or later.

## Spike 2: a GPL-free G2P

See `g2p-findings.md` (full findings), `twenty-lines.md` (espeak against the GPL-free path on 20 actor lines), and `spike-code/` (the throwaway code, including the Misaki port `g2p.mjs` and the BART export scripts).

The Misaki word lists and the exported BART ONNX files were not copied: they are large, and the word lists wait on the provenance question in `misaki-lexicon-question.md`. Re-download them from hexgrad/misaki and re-export the BART models with `spike-code/bart/export.py` when implementing.
