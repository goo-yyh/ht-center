import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      'src/App.tsx',
      'src/features/sourcing/components/**/*.tsx',
      'src/features/sourcing/pages/**/*.tsx',
    ],
    rules: {
      // These client views intentionally reset animation/form state and start
      // initial data loading from effects. Keep the stricter rule enabled for
      // the rest of the project while allowing those established UI patterns.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    '.playwright-cli/**',
    'coverage/**',
    'dist/**',
    'output/**',
    'next-env.d.ts',
  ]),
]);
