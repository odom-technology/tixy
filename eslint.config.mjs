import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      /* The codebase keeps reference constants and tuning values around
         under a leading underscore (pool physics, reward tables) —
         honor that convention instead of warning on each one. */
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  globalIgnores([
    '.claude/**',
    '.next/**',
    'dist/**',
    'next-env.d.ts',
    'node_modules/**',
    'tsconfig.tsbuildinfo',
    // Vendored design-system reference (specimens/prototypes, not app code)
    'docs/design/midway/**',
  ]),
]);
