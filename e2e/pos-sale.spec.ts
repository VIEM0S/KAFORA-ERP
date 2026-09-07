import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, STORE_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Vente au comptant au POS — le flux le plus fréquent de l'app. Vérifie que
 * la vente, le stock et le mouvement de stock sont TOUS corrects après
 * paiement, pas seulement que l'écran affiche "Vente enregistrée".
 */
test.describe('Vente POS (espèces)', () => {
  let productId: string;
  let initialQty: number;

  test.beforeAll(async () => {
    const admin = supabaseAdmin();
    const sku = `E2E-${uniqueSuffix()}`;
    const { data: product, error } = await admin
      .from('products')
      .insert({
        tenant_id: TENANT_ID,
        name: 'Produit Test E2E',
        sku,
        selling_price: 2500,
        purchase_price: 1500,
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    productId = product.id;
    initialQty = 10;

    const { error: invError } = await admin
      .from('inventory')
      .insert({ tenant_id: TENANT_ID, product_id: productId, store_id: STORE_ID, quantity: initialQty });
    if (invError) throw invError;
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

  test('encaisse une vente et décrémente le stock exactement de la quantité vendue', async ({ page }) => {
    await page.goto('/pos');

    // Le champ de recherche du POS ne filtre pas la grille de produits (vérifié
    // en direct) — cliquer directement sur la tuile, toujours visible.
    await page.getByText('Produit Test E2E').first().click();

    await expect(page.getByText('Panier vide')).toHaveCount(0);

    await page.getByRole('button', { name: /Payer/ }).click();
    await page.getByRole('button', { name: 'Confirmer la vente' }).click();

    await expect(page.getByText('Vente enregistrée')).toBeVisible({ timeout: 10_000 });

    // Vérité en base, pas seulement le message de succès à l'écran.
    const admin = supabaseAdmin();
    const { data: inv } = await admin
      .from('inventory')
      .select('quantity')
      .eq('product_id', productId)
      .eq('store_id', STORE_ID)
      .single();
    expect(inv?.quantity).toBe(initialQty - 1);

    const { data: movement } = await admin
      .from('inventory_movements')
      .select('type, quantity, previous_quantity, new_quantity')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(movement?.type).toBe('SALE');
    expect(movement?.quantity).toBe(-1);
    expect(movement?.previous_quantity).toBe(initialQty);
    expect(movement?.new_quantity).toBe(initialQty - 1);
  });
});
