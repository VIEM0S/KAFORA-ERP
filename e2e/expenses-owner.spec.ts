import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, STORE_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Parcours Propriétaire (migration 067/068) : valider une dépense en attente,
 * puis la retrouver dans le Journal d'audit. Le compte E2E est un MANAGER :
 * on le promeut temporairement OWNER (ligne users + reconnexion par le vrai
 * formulaire, qui resynchronise les revendications JWT) et on restaure
 * TOUJOURS l'état d'origine dans afterAll.
 */
test.describe('Dépenses — parcours Propriétaire', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const suffix = uniqueSuffix();
  const label = `E2E dépense à valider ${suffix}`;
  let userId = '';
  let original: { role: string; store_ids: string[] | null } | null = null;
  let expenseId = '';

  test.beforeAll(async () => {
    const admin = supabaseAdmin();
    const email = process.env.E2E_TEST_EMAIL!;
    const { data: row, error } = await admin.from('users').select('id, role, store_ids').eq('email', email).single();
    if (error) throw error;
    userId = row.id;
    original = { role: row.role as string, store_ids: row.store_ids as string[] | null };
    await admin.from('users').update({ role: 'OWNER', store_ids: null }).eq('id', userId);

    const { data: exp, error: expError } = await admin.from('expenses').insert({
      tenant_id: TENANT_ID, store_id: STORE_ID, category: 'TRANSPORT', amount: 75_000,
      description: label, status: 'PENDING', created_by_name: 'Responsable E2E',
    }).select('id').single();
    if (expError) throw expError;
    expenseId = exp.id;
  });

  test.afterAll(async () => {
    const admin = supabaseAdmin();
    if (expenseId) {
      await admin.from('audit_log').delete().eq('entity_id', expenseId);
      await admin.from('expenses').delete().eq('id', expenseId);
    }
    if (userId && original) {
      await admin.from('users').update({ role: original.role, store_ids: original.store_ids }).eq('id', userId);
      await admin.auth.admin.updateUserById(userId, {
        app_metadata: { tenant_id: TENANT_ID, role: original.role, store_ids: original.store_ids },
      });
    }
  });

  test('le Propriétaire valide une dépense en attente, visible ensuite dans le Journal d\'audit', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.E2E_TEST_EMAIL!);
    await page.getByLabel('Mot de passe').fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.goto('/expenses');
    await expect(page.getByText(/en attente de votre validation/)).toBeVisible();
    const row = page.locator('tr', { hasText: label });
    await expect(row).toContainText('En attente');
    await row.getByRole('button', { name: 'Valider' }).click();
    await expect(row).toContainText('Validée');

    await page.goto('/audit-log');
    await expect(page.getByRole('heading', { name: "Journal d'audit" })).toBeVisible();
    await expect(page.locator('tr', { hasText: label }).first()).toContainText('Dépense validée');
  });
});
