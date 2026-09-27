import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, STORE_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Vente en quantité fractionnée (kg/mètre/litre..., migration 076) —
 * régression directe d'un bug trouvé en construisant la fonctionnalité :
 * la route /api/pos/checkout arrondissait TOUJOURS la quantité à l'entier
 * (Math.floor), ce qui aurait cassé silencieusement toute vente au détail
 * en dessous de l'unité (2,5 m devenait 2 m). Corrigé pour respecter
 * products.fractional_quantity.
 */
test.describe('Vente POS — quantité fractionnée', () => {
  let productId: string;
  let initialQty: number;

  test.beforeAll(async () => {
    const admin = supabaseAdmin();
    const sku = `E2E-FRAC-${uniqueSuffix()}`;
    const { data: product, error } = await admin
      .from('products')
      .insert({
        tenant_id: TENANT_ID,
        name: 'Corde Test E2E',
        sku,
        unit: 'm',
        fractional_quantity: true,
        selling_price: 1000,
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
    const { data: sales } = await admin.from('sale_items').select('sale_id').eq('product_id', productId);
    const saleIds = [...new Set((sales ?? []).map((s) => s.sale_id))];
    if (saleIds.length) {
      await admin.from('sync_dedup').delete().in('sale_id', saleIds);
      await admin.from('sale_items').delete().in('sale_id', saleIds);
      await admin.from('sales').delete().in('id', saleIds);
    }
    await admin.from('inventory_movements').delete().eq('product_id', productId);
    await admin.from('inventory').delete().eq('product_id', productId);
    await admin.from('products').delete().eq('id', productId);
  });

  test('vend 2,5 mètres et décrémente le stock exactement de cette quantité', async ({ page }) => {
    await page.goto('/pos');

    await page.getByText('Corde Test E2E').first().click();
    await expect(page.getByText('Panier vide')).toHaveCount(0);

    // Champ décimal du panier (pas de stepper +/- pour un produit
    // fractional_quantity, voir components/pos/cart-panel.tsx) — le seul
    // input[type=number] présent avant le pavé de remise (Manager+).
    const qtyInput = page.locator('input[type="number"]').first();
    await qtyInput.fill('2.5');
    await qtyInput.blur();

    await page.getByRole('button', { name: /Payer/ }).click();
    await page.getByRole('button', { name: 'Confirmer la vente' }).click();
    await expect(page.getByText('Vente enregistrée')).toBeVisible({ timeout: 10_000 });

    const admin = supabaseAdmin();
    const { data: inv } = await admin
      .from('inventory')
      .select('quantity')
      .eq('product_id', productId)
      .eq('store_id', STORE_ID)
      .single();
    expect(inv?.quantity).toBe(initialQty - 2.5);

    const { data: item } = await admin
      .from('sale_items')
      .select('quantity')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(item?.quantity).toBe(2.5);
  });
});
