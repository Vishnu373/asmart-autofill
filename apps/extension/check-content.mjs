import { readFile } from 'node:fs/promises';

const built = await readFile(new URL('dist/content.js', import.meta.url), 'utf8');

// A classic script cannot import. Bare `import` at the head of the file is what
// a shared chunk looks like; `import(` would be a dynamic one, equally fatal.
if (/(^|[;\s])import\s*[({*'"]/.test(built)) {
  console.error(
    'dist/content.js carries an import, so Chrome will refuse it as a content script.\n' +
      'Something it uses is now shared with another entry. See vite.content.config.ts.',
  );
  process.exit(1);
}
