import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, STORE_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Inventaire physique (migration 069) : un Responsable compte un produit ;
 * sous le seuil de perte le stock est ajusté directement, au-dessus l'inventaire
 * attend la validation du Propriétaire/Administrateur et le stock N'EST PAS
 * touché. (La décision par le Propriétaire est couverte au niveau RPC.)
 */
test.describe('Inventaire physique', () => {
  const suffix = uniqueSuffix();
  const smallName = `E2E Stock Petit ${suffix}`;
  const bigName = `E2E Stock Gros ${suffix}`;
  const productIds: string[] = [];

  const cleanup = async () => {
    const admin = supabaseAdmin();
    const { data: st } = await admin.from('stocktakes').select('id').eq('tenant_id', TENANT_ID).eq('store_id', STORE_ID);
    const ids = (st ?? []).map(r => r.id);
    if (ids.length) {
      await admin.from('audit_log').delete().in('entity_id', ids);
      await admin.from('stocktake_lines').delete().in('stocktake_id', ids);
      await admin.from('stocktakes').delete().in('id', ids);
    }
    if (productIds.length) {
      await admin.from('inventory_movements').delete().in('product_id', productIds);
      await admin.from('inventory').delete().in('product_id', productIds);
      await admin.from('products').delete().in('id', productIds);
    }
  };

  test.beforeAll(async () => {
    const admin = supabaseAdmin();
    await cleanup();
    for (const [name, cost, qty] of [[smallName, 1_000, 10], [bigName, 100_000, 5]] as const) {
      const { data: p, error } = await admin.from('products').insert({
        tenant_id: TENANT_ID, name, sku: `E2E-STK-${name.slice(-8)}-${cost}`, selling_price: cost * 2, purchase_price: cost,
      }).select('id').single();
      if (error) throw error;
      productIds.push(p.id);
      await admin.from('inventory').insert({ tenant_id: TENANT_ID, product_id: p.id, store_id: STORE_ID, quantity: qty });
    }
  });

  test.afterAll(cleanup);

  test('un petit écart est appliqué directement, un gros écart attend la validation sans toucher au stock', async ({ page }) => {
    const admin = supabaseAdmin();
    const stockOf = async (id: string) =>
      (await admin.from('inventory').select('quantity').eq('product_id', id).eq('store_id', STORE_ID).single()).data!.quantity;

    await page.goto('/inventory/stocktake');
    await page.getByRole('button', { name: 'Démarrer un inventaire' }).click();
    await expect(page.getByText('produits comptés')).toBeVisible();

    // Petit écart : 10 -> 8 = perte de 2 000 FCFA (sous le seuil) — grosse perte sur l'autre : 5 -> 2 = 300 000 FCFA.
    await page.getByLabel(`Quantité comptée — ${smallName}`).fill('8');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Progression enregistrée.')).toBeVisible();
    await page.getByRole('button', { name: 'Terminer' }).click();
    await expect(page.getByText('Inventaire terminé : le stock a été ajusté.')).toBeVisible();
    expect(await stockOf(productIds[0])).toBe(8);

    // Deuxième inventaire : gros écart.
    await page.getByRole('button', { name: 'Démarrer un inventaire' }).click();
    await page.getByLabel(`Quantité comptée — ${bigName}`).fill('2');
    await page.getByRole('button', { name: 'Terminer' }).click();
    await expect(page.getByText(/dépasse le seuil/)).toBeVisible();
    await expect(page.getByText('En attente de validation').first()).toBeVisible();
    // Le Responsable ne peut pas valider, et le stock n'a pas bougé.
    await expect(page.getByRole('button', { name: 'Valider et ajuster le stock' })).toHaveCount(0);
    expect(await stockOf(productIds[1])).toBe(5);
  });
});
