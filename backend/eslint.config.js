// Lint rules for the Worker, its tests and the donation page's scripts.
// Run from this folder with: npm run lint (it lints from the project folder, so ../site is included).
import js from '@eslint/js';
import globals from 'globals';

const rules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['error', { caughtErrors: 'none' }],
};

export default [
  {
    files: ['**/backend/src/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.serviceworker },
    rules,
  },
  {
    files: ['**/backend/test/**/*.js', '**/eslint.config.*'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
    rules,
  },
  {
    // The page: plain browser scripts, no build step.
    files: ['**/site/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, KoivikkoApi: 'readonly' } },
    rules,
  },
];
