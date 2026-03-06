import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/coverage/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      'react-hooks': reactHooks
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      ...reactHooks.configs.recommended.rules,
      'max-lines': ['error', { max: 2000, skipBlankLines: true, skipComments: true }],
      'import/no-cycle': 'error',
      'import/no-self-import': 'error'
    }
  }
];
