import { resolve } from 'node:path';

import { defineConfig } from 'vite';

/**
 * The content script gets a build of its own because a manifest content script
 * is a classic script: an `import` at the top of it is a syntax error and the
 * fill never runs. Given more than one entry, Rollup lifts anything two of them
 * share into a chunk and imports it — correct for the popup and the worker,
 * fatal here. One entry leaves it nothing to share with, so everything the
 * script needs is inlined. `check-content.mjs` holds the build to it.
 */
export default defineConfig({
  build: {
    // The main build runs first and this must not wipe it.
    emptyOutDir: false,
    rollupOptions: {
      input: { content: resolve(import.meta.dirname, 'src/content/index.ts') },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
