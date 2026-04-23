import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  esbuildOptions(options) {
    options.alias = {
      '@': srcDir,
    };
  },
});
