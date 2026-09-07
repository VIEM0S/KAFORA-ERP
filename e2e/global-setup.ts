import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Se connecte UNE fois via le vrai formulaire de login (compte E2E dédié,
 * voir scripts/create-e2e-test-user.js) et sauvegarde la session — chaque
 * test réutilise cet état plutôt que de se reconnecter, comme recommandé
 * par Playwright pour une suite qui partage un seul compte.
 */
export default async function globalSetup(config: FullConfig) {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_TEST_EMAIL / E2E_TEST_PASSWORD manquantes — lancer d'abord " +
      "`node --env-file=.env scripts/create-e2e-test-user.js`, puis " +
      "charger .env.test.local (voir package.json script test:e2e)."
    );
  }

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseURL}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  // La redirection post-login dépend du rôle (voir app/(auth)/login/page.tsx)
  // — le compte E2E est MANAGER, direction /dashboard.
  await page.waitForURL('**/dashboard', { timeout: 15_000 });

  const storatePath = path.join(process.cwd(), '.playwright', 'auth.json');
  fs.mkdirSync(path.dirname(storatePath), { recursive: true });
  await page.context().storageState({ path: storatePath });

  await browser.close();
}
