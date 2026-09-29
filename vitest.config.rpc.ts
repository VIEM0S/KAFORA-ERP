import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Même chargement que playwright.config.ts : .env puis .env.test.local
// (le second peut surcharger le premier). `vitest run` ne charge rien
// automatiquement, contrairement à `next dev`.
const loadEnvFile = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
try { loadEnvFile?.('.env'); } catch { /* absent : ok si les vars viennent d'ailleurs (CI) */ }
try { loadEnvFile?.('.env.test.local'); } catch { /* optionnel */ }

// Suite RPC séparée de la suite par défaut (vitest.config.ts) et de la
// suite RLS locale (vitest.config.rls.ts) : parle au VRAI projet Supabase
// distant via un client service-role (pas de Postgres local — ce poste n'a
// pas Docker). Chaque test crée/nettoie ses propres tenants/codes promo
// jetables, jamais de données client réelles touchées. Lancée via
// `npm run test:rpc`, jamais dans `npm test`/CI courant (nécessite les
// vraies variables d'environnement Supabase, voir .env / .env.test.local).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['__tests__/rpc/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
