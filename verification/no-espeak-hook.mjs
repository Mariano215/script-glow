// Fails any import of espeak-ng or of the packages that carry it (GPL). Loaded through NODE_OPTIONS,
// so it also runs inside the worker process. Used with verification/kokoro-speak.mjs.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (/node_modules\/(phonemizer|espeak[^/]*|kokoro-js)\//.test(result.url)) throw new Error(`GPL code was loaded: ${result.url}`);
    return result;
  },
});
