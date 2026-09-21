import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Dépenses (migration 067) : un Responsable qui saisit une dépense au-dessus
 * du seuil de validation la voit passer "En attente" (et pas directement
 * "Validée"), et n'a AUCUN bouton pour la valider lui-même. Le compte E2E est
 * un MANAGER — la décision par le Propriétaire est couverte au niveau RPC
 * (voir l'historique de la migration), pas ici.
 */
test.describe('Dépenses — seuil de validation', () => {
  const suffix = uniqueSuffix();
  const bigLabel = `E2E dépense importante ${suffix}`;
  const smallLabel = `E2E petite dépense ${suffix}`;

  test.afterAll(async () => {
    const admin = supabaseAdmin();
    const { data } = await admin.from('expenses').select('id').eq('tenant_id', TENANT_ID).in('description', [bigLabel, smallLabel]);
    const ids = (data ?? []).map(r => r.id);
    if (ids.length) {
      await admin.from('audit_log').delete().in('entity_id', ids);
      await admin.from('expenses').delete().in('id', ids);
    }
  });

  test('une petite dépense est validée directement, une grosse attend la validation', async ({ page }) => {
    const admin = supabaseAdmin();
    const { data: tenant } = await admin.from('tenants').select('expense_approval_threshold').eq('id', TENANT_ID).single();
    const threshold = tenant!.expense_approval_threshold as number;

    await page.goto('/expenses');
    await expect(page.getByRole('heading', { name: 'Dépenses' })).toBeVisible();

    const create = async (amount: number, label: string) => {
      await page.getByRole('button', { name: 'Nouvelle dépense' }).first().click();
      await page.getByLabel('Montant (FCFA) *').fill(String(amount));
      await page.getByLabel('Motif *').fill(label);
      await page.getByRole('button', { name: 'Enregistrer' }).click();
      await expect(page.getByRole('heading', { name: 'Nouvelle dépense' })).toBeHidden();
    };

    await create(1_000, smallLabel);
    await expect(page.locator('tr', { hasText: smallLabel })).toContainText('Validée');

    await create(threshold + 1_000, bigLabel);
    const bigRow = page.locator('tr', { hasText: bigLabel });
    await expect(bigRow).toContainText('En attente');
    // Le Responsable ne peut pas valider : aucun bouton, aucune colonne d'actions.
    await expect(page.getByRole('button', { name: 'Valider' })).toHaveCount(0);
  });
});
