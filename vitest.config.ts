import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    // Motifs non ancres ('node_modules', '.next') n'excluaient que la racine :
    // un node_modules imbrique (ex. .claude/worktrees/<agent>/node_modules,
    // laisse par un agent travaillant en worktree isole) etait quand meme
    // parcouru, avec ses propres fichiers *.test.ts internes (vus une fois :
    // des tests internes de zod executes par erreur, en echec car il leur
    // manque des dependances non installees a ce niveau). '**/…/**' exclut
    // a toute profondeur, y compris les worktrees d'agents eux-memes.
    // '.worktree-*' couvre aussi les worktrees crees ad hoc a la racine du
    // repo (ex. .worktree-netlify-preview), pas seulement ceux d'agents sous
    // .claude/worktrees/ — meme categorie de bug, revu une seconde fois.
    //
    // __tests__/rls/** exclu ici : ces tests parlent a un vrai Postgres
    // local (supabase start, port 54322) et echoueraient au demarrage sans
    // lui — ils ont leur propre config (vitest.config.rls.ts) et leur
    // propre script (`npm run test:rls`), a lancer separement.
    exclude: ['**/node_modules/**', '**/.next/**', '**/.claude/worktrees/**', '**/.worktree-*/**', '**/__tests__/rls/**'],
  },
});
