import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Suite RLS séparée de la suite par défaut (vitest.config.ts) : parle à un
// vrai Postgres local (`supabase start`, voir supabase/config.toml — port
// 54322), donc pas de sens à la faire tourner dans `npm test` (pas de
// Docker en CI/environnement standard sans setup préalable). Lancée via
// `npm run test:rls`, après `supabase start` + `supabase db reset`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['__tests__/rls/**/*.test.ts'],
    // Isolation par transaction+rollback (voir __tests__/rls/helpers/rls-client.ts)
    // suffit déjà entre tests ; pas besoin d'isoler par fichier/worker en plus,
    // et le faire en séquentiel évite toute contention sur la connexion `pg`
    // partagée par fichier de test.
    fileParallelism: false,
  },
});
