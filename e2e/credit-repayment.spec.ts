import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Régression directe du bug trouvé le 2026-09-07 : "Total versé" restait
 * affiché à 0 FCFA après un versement (le panneau de détail n'était pas
 * repatché). Ce test aurait fait échouer la suite avant le correctif.
 */
test.describe('Crédit — versements', () => {
  let customerId: string;
  let creditId: string;

  test.beforeAll(async () => {
    const admin = supabaseAdmin();
    const suffix = uniqueSuffix();
    const { data: customer, error } = await admin
      .from('customers')
      .insert({
        tenant_id: TENANT_ID,
        first_name: 'E2E',
        last_name: `Credit-${suffix}`,
        customer_type: 'INDIVIDUAL',
        phone: `+223 60 00 ${suffix.slice(-4)}`,
        credit_limit: 100_000,
      })
      .select('id')
      .single();
    if (error) throw error;
    customerId = customer.id;

    const { data: credit, error: creditError } = await admin
      .from('credits')
      .insert({
        tenant_id: TENANT_ID,
        customer_id: customerId,
        reference: `CR-E2E-${suffix}`,
        total_amount: 20_000,
        paid_amount: 0,
        remaining_amount: 20_000,
        due_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        status: 'PENDING',
        customer_name: `E2E Credit-${suffix}`,
        customer_phone: `+223 60 00 ${suffix.slice(-4)}`,
      })
      .select('id')
      .single();
    if (creditError) throw creditError;
    creditId = credit.id;
  });

  test.afterAll(async () => {
    const admin = supabaseAdmin();
    await admin.from('credit_payments').delete().eq('credit_id', creditId);
    await admin.from('credits').delete().eq('id', creditId);
    await admin.from('customers').delete().eq('id', customerId);
  });

  test("'Total versé' et le solde se mettent à jour immédiatement après un versement, sans rechargement", async ({ page }) => {
    await page.goto('/credits');
    await page.getByRole('button', { name: 'Tous' }).click();
    // La recherche ne filtre pas la liste (même comportement que /sales,
    // vérifié en direct) — cibler la ligne par le montant du crédit, unique.
    await page.locator('tr', { hasText: '20 000 FCFA' }).first().click();

    await page.getByPlaceholder(/Max/).fill('8000');
    await page.getByRole('button', { name: 'Valider' }).click();

    // Les deux assertions qui auraient échoué avant le correctif du
    // 2026-09-07 : le panneau affichait encore "0 FCFA" ici.
    await expect(page.getByText('8 000 FCFA').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('12 000 FCFA').first()).toBeVisible();

    const admin = supabaseAdmin();
    const { data: credit } = await admin
      .from('credits')
      .select('paid_amount, remaining_amount, status')
      .eq('id', creditId)
      .single();
    expect(Number(credit?.paid_amount)).toBe(8000);
    expect(Number(credit?.remaining_amount)).toBe(12_000);
    expect(credit?.status).toBe('PARTIALLY_PAID');
  });
});
