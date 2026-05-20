import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'warn',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
    },
  },
  {
    files: ['packages/web/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            'JSXAttribute[name.name="href"][value.type="JSXExpressionContainer"]:not([value.expression.type="Literal"]):not([value.expression.type="TemplateLiteral"])',
          message:
            'Dynamic href detected. Validate with isSafeUrl() before rendering to prevent javascript: URL injection.',
        },
        {
          selector:
            'JSXAttribute[name.name="src"][value.type="JSXExpressionContainer"]:not([value.expression.type="Literal"]):not([value.expression.type="TemplateLiteral"])',
          message:
            'Dynamic src detected. Validate with isSafeUrl() before rendering to prevent unsafe URL injection.',
        },
      ],
    },
  },
  {
    files: ['packages/server/src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['packages/server/src/config.ts'],
    rules: {
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/generated/**',
      '**/node_modules/**',
      'vitest.workspace.ts',
      '**/vitest.config.ts',
      '**/.storybook/**',
      '**/*.stories.tsx',
      'scripts/**',
      'packages/*/scripts/**',
    ],
  },
);
