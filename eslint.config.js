import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'examples/**/build/**',
      'examples/**/.docusaurus/**',
      '.tmp-integration/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {...globals.browser, ...globals.node},
    },
    plugins: {react, 'react-hooks': reactHooks},
    settings: {react: {version: 'detect'}},
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
      'no-console': ['error', {allow: ['warn', 'error']}],
    },
  },
  {
    // Node scripts and the ESLint config itself are plain ESM outside the typed program,
    // so the project service must not try to resolve them to a tsconfig.
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {projectService: false, project: false},
    },
    rules: {
      // Spread, not replaced: overwriting `rules` here would silently re-enable every
      // type-aware rule for files that have no type information at all.
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-console': 'off',
    },
  },
  prettier,
);
