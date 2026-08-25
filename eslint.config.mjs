import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/target/**', 'src-tauri/gen/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    files: ['apps/extension/**/*.ts'],
    languageOptions: { globals: { chrome: 'readonly' } },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { URL: 'readonly', console: 'readonly', process: 'readonly' },
    },
  },
);
