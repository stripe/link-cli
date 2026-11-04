import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  entry: ['src/index.ts', 'src/tools/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle mppx so SDK consumers that compile it (such as Eve) never load its viem-based exports.
  noExternal: ['mppx'],
  esbuildOptions(options) {
    options.alias = {
      '@': srcDir,
    };
  },
});
