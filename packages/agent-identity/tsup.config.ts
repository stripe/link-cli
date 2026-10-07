import { defineConfig } from 'tsup';

// Keep the module tree and shared caches intact in both module systems.
export default defineConfig(
  (['esm', 'cjs'] as const).map((format) => ({
    entry: ['src/**/*.ts'],
    format: [format],
    bundle: false,
    platform: 'neutral',
    target: 'es2022',
    outDir: `dist/${format}`,
    outExtension: () => ({ js: '.js' }),
    clean: true,
    sourcemap: true,
  })),
);
