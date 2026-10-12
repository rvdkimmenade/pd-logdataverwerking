import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', 'artifacts/**', '.local/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: [
      'apps/register/public/*.js',
      'apps/console/public/*.js',
      'scripts/register-test.mjs',
      'scripts/console-test.mjs',
    ],
    languageOptions: { globals: globals.browser },
  },
);
