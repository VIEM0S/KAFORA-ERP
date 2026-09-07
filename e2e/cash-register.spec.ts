import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, STORE_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Ouverture, une vente, fermeture avec rapprochement exact — le calcul
 * "fond de caisse + ventes espèces = attendu" est au cœur de la confiance
 * du commerçant dans l'outil (voir l'audit du 2026-09-07).
 *
 * Utilise un produit dédié (comme pos-sale.spec.ts) plutôt que "Yaourt 500g" :
 * la première version empruntait au stock partagé du tenant QA et ne
 * supprimait jamais la vente créée — chaque exécution laissait une ligne de
 * plus dans l'historique des ventes, sans jamais la nettoyer.
 */
test.describe('Caisse — ouverture, vente, fermeture', () => {
  let productId: string;

  test.beforeAll(async () => {
    const admin = supabaseAdmin();
    const { data: product, error } = await admin
      .from('products')
      .insert({
        tenant_id: TENANT_ID,
        name: 'Produit Caisse E2E',
        sku: `E2E-CASH-${uniqueSuffix()}`,
        selling_price: 500,
        purchase_price: 300,
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    productId = product.id;

    const { error: invError } = await admin
      .from('inventory')
      .insert({ tenant_id: TENANT_ID, product_id: productId, store_id: STORE_ID, quantity: 20 });
    if (invError) throw invError;
  });

  test.afterEach(async () => {
    // Filet de sécurité : si une assertion échoue en cours de route, ne pas
    // laisser une session ouverte polluer les tests suivants (ou le tenant
    // QA partagé par les vérifications manuelles).
    const admin = supabaseAdmin();
    await admin
      .from('cash_sessions')
      .delete()
      .eq('tenant_id', TENANT_ID)
      .eq('store_id', STORE_ID)
      .is('closed_at', null);
  });

  test.afterAll(async () => {
    const admin = supabaseAdmin();
    await admin.from('inventory_movements').delete().eq('product_id', productId);
    const { data: sales } = await admin.from('sale_items').select('sale_id').eq('product_id', productId);
    const saleIds = [...new Set((sales ?? []).map((s) => s.sale_id))];
    if (saleIds.length) {
      await admin.from('sync_dedup').delete().in('sale_id', saleIds);
      await admin.from('sale_items').delete().in('sale_id', saleIds);
      await admin.from('sales').delete().in('id', saleIds);
    }
    await admin.from('inventory').delete().eq('product_id', productId);
    await admin.from('products').delete().eq('id', productId);
  });

  test('le solde attendu à la fermeture correspond exactement au fond initial + ventes espèces', async ({ page }) => {
    await page.goto('/cash-register');

    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('15000');
    await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    await expect(page.getByText('Caisse ouverte')).toBeVisible({ timeout: 10_000 });

    await page.goto('/pos');
    await page.getByText('Produit Caisse E2E').first().click();
    await page.getByRole('button', { name: /Payer/ }).click();
    await page.getByRole('button', { name: 'Confirmer la vente' }).click();
    await expect(page.getByText('Vente enregistrée')).toBeVisible({ timeout: 10_000 });

    await page.goto('/cash-register');
    await expect(page.getByText('15 500 FCFA').first()).toBeVisible(); // 15 000 fond + 500 (Produit Caisse E2E) — session fraîchement ouverte, aucune autre vente dedans

    await page.getByRole('button', { name: 'Fermer la caisse' }).click();
    // Montant compté = attendu (15 000 fond + 500 vente), connu par
    // construction — plus robuste que de re-parser "Solde attendu" affiché
    // deux fois sur la page (déclenchait une violation de mode strict).
    const closingInput = page.locator('[role="dialog"] input[type="number"]').first();
    await closingInput.fill('15500');
    await page.getByRole('button', { name: 'Confirmer la fermeture' }).click();

    await expect(page.getByText('Caisse fermée')).toBeVisible({ timeout: 10_000 });

    const admin = supabaseAdmin();
    const { data: session } = await admin
      .from('cash_sessions')
      .select('opening_balance, expected_balance, closing_balance, difference')
      .eq('tenant_id', TENANT_ID)
      .eq('store_id', STORE_ID)
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: false })
      .limit(1)
      .single();
    expect(Number(session?.difference)).toBe(0);
  });
});
