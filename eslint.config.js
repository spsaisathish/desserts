import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

const unusedVariables = { argsIgnorePattern: '^_' };

export default defineConfig([
  globalIgnores(['dist/', 'public/', 'uploads/']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    rules: {
      'no-unused-vars': ['error', unusedVariables],
    },
  },
  {
    files: ['server/**/*.js', 'test/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.nodeBuiltin },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.jsx'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      // The JSX transform uses the React import for createElement calls.
      'no-unused-vars': ['error', { ...unusedVariables, varsIgnorePattern: '^React$' }],
    },
  },
]);
