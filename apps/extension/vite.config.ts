import { resolve } from 'node:path';

import { defineConfig } from 'vite';

// Unhashed names, because the manifest names the files. The content script is
// built separately by `vite.content.config.ts` — see the note there.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
        popup: resolve(import.meta.dirname, 'popup.html'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
