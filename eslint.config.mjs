import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next (as of 15.x) still ships a legacy (.eslintrc-style)
// shareable config, not a native ESLint 9 flat config. FlatCompat bridges
// it into the flat config system used by the `eslint` CLI (`next lint`
// itself was removed as of Next.js 16).
const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals'),
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
];

export default eslintConfig;
