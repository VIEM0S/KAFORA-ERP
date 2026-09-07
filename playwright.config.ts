import { defineConfig, devices } from '@playwright/test';

// Node >= 20.6 : charge .env puis .env.test.local (E2E_TEST_EMAIL/PASSWORD,
// écrits par scripts/create-e2e-test-user.js) dans process.env — évite de
// dépendre du chaînage de commandes shell, qui ne propage rien d'un process
// à l'autre. .env.test.local en second pour pouvoir surcharger .env en local.
// Cast local : présent à l'exécution (Node 20.9, voir engines dans
// package.json) mais absent des types @types/node@20.6 installés.
const loadEnvFile = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
try { loadEnvFile?.('.env'); } catch { /* .env absent : ok en CI si les vars viennent d'ailleurs */ }
try { loadEnvFile?.('.env.test.local'); } catch { /* voir `npm run test:e2e:setup` */ }

// Suite E2E sur les flux financiers réels (vente, crédit, retour, transfert,
// commande fournisseur, caisse) — complète la suite RLS (vitest.config.rls.ts,
// __tests__/rls/) qui teste les policies Postgres en isolation, mais jamais
// un parcours utilisateur complet dans un vrai navigateur. Les deux ont été
// trouvées nécessaires pendant l'audit du 2026-09-07 : plusieurs bugs réels
// (badge de statut incorrect, panneau de détail jamais rafraîchi, solde
// jamais remis à zéro) n'étaient visibles qu'en cliquant vraiment dans
// l'interface, pas en testant les policies ou les fonctions isolément.
//
// Tourne contre le serveur de dev Next.js local (voir webServer ci-dessous)
// et le tenant "QA Onboarding Test" déjà utilisé pour toutes les
// vérifications manuelles de cette session — même Supabase de prod, jamais
// touché aux données des vrais clients (chaque test crée ses propres
// données et les nettoie).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // les tests partagent le même tenant/magasin QA — le stock d'un test ne doit pas interférer avec un autre en parallèle
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: '.playwright/auth.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
