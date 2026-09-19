// Logs every resolved module whose path mentions phonemizer, espeak or kokoro-js.
import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, next) { const r = next(s, c); if (/node_modules\/(phonemizer|espeak[^/]*|kokoro-js)\//.test(r.url)) console.log("LOADED:", r.url); return r; } });
