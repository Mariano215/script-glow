import { defineConfig } from 'vite';
// The phone reuses the desktop's parser and player logic from ../src, so Vite may read one level up.
export default defineConfig({
  publicDir: false,
  build: { target: 'safari16', outDir: 'dist' },
  server: { fs: { allow: ['..'] } },
});
