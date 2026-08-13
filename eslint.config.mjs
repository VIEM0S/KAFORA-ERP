import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      // eslint-config-next 16 pulls in a newer eslint-plugin-react-hooks
      // that promotes these two rules to errors by default. Both flag
      // pre-existing patterns across ~10 files (hooks/*, components/*)
      // that were never enforced pre-upgrade — e.g. calling setState
      // synchronously inside a useEffect that sets up a Firestore
      // onSnapshot subscription, or defining a small inline component in
      // a render path. Fixing them for real requires understanding each
      // call site's intended behavior, which is out of scope for a
      // framework-version upgrade. Downgraded to warnings (not silenced)
      // so they stay visible for a dedicated follow-up review.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  // Override default ignores of eslint-config-next.
  //
  // Motifs ancres a la racine ('.next/**', etc.) : un .next ou .netlify
  // imbrique (ex. .worktree-<agent>/.next, laisse par un agent travaillant
  // en worktree isole) etait quand meme parcouru -- code de build genere/
  // minifie, jamais du code source, qui remontait des dizaines de "erreurs"
  // sans rapport avec le projet (memes symptomes que le bug corrige dans
  // vitest.config.ts : exclude non recursif). '**/…/**' exclut a toute
  // profondeur.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '**/.next/**',
    '**/out/**',
    '**/build/**',
    'next-env.d.ts',
    '**/.netlify/**',
    '**/node_modules/**',
    '**/.claude/worktrees/**',
    // Worktrees crees ad hoc a la racine du repo (ex. .worktree-netlify-preview),
    // pas seulement ceux d'agents sous .claude/worktrees/.
    '**/.worktree-*/**',
  ]),
]);

export default eslintConfig;
