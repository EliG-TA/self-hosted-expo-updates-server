import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const tsFiles = ['API/**/*.{ts,tsx}', 'Web/**/*.{ts,tsx}']

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'API/uploads/**',
      'API/certs/**',
      'Web/public/env-config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      'no-console': 'off',
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
      'simple-import-sort/imports': [
        'error',
        {
          groups: [['^\\u0000'], ['^react$', '^react', '^@?\\w'], ['^@/', '^~'], ['^\\.'], ['^.+\\.(css|scss|sass)$']],
        },
      ],
      'simple-import-sort/exports': 'error',
      'unused-imports/no-unused-imports': 'error',
    },
  },
  {
    files: tsFiles,
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          args: 'none',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['API/**/*.{js,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.bun,
      },
    },
  },
  {
    files: ['Web/**/*.{js,jsx,ts,tsx}'],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      ...react.configs.flat.recommended.plugins,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  eslintConfigPrettier,
)
