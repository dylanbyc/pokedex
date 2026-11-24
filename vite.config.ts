import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (e.g. GitHub Pages /pokedex/).
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  server: { host: true },
});
