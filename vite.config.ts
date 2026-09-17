import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
// The version shown under the logo comes from package.json, so it cannot drift from the release.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001', '/audio': 'http://127.0.0.1:3001' },
  },
});
