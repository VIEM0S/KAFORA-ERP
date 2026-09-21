import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Prix d'achat (migrations 070/072) : il vit dans product_costs, lisible des
 * seuls Managers+. Le formulaire produit doit l'écrire (création ET
 * modification) et le tableau doit l'afficher avec la marge calculée.
 */
test.describe('Produit — prix d\'achat', () => {
  const suffix = uniqueSuffix();
  const sku = `E2E-COST-${suffix.slice(-8)}`.toUpperCase();
  const name = `E2E Produit Cout ${suffix.slice(-8)}`;

  const findProduct = async () =>
    (await supabaseAdmin().from('products').select('id').eq('tenant_id', TENANT_ID).eq('sku', sku).maybeSingle()).data;

  test.afterAll(async () => {
    const p = await findProduct();
    if (p) {
      await supabaseAdmin().from('audit_log').delete().eq('entity_id', p.id);
      await supabaseAdmin().from('products').delete().eq('id', p.id);
    }
  });

  test('créer puis modifier un produit enregistre et affiche le prix d\'achat', async ({ page }) => {
    const admin = supabaseAdmin();
    await page.goto('/products');
    await page.getByRole('button', { name: 'Nouveau produit' }).first().click();
    await page.getByPlaceholder('ex: CM-PT-50').fill(sku);
    await page.getByPlaceholder('Nom du produit').fill(name);
    const numbers = page.getByRole('dialog').locator('input[type=number]'); // achat, vente, TVA, seuil
    await numbers.nth(0).fill('1000');
    await numbers.nth(1).fill('1500');
    await page.getByRole('button', { name: 'Créer le produit' }).click();

    const row = page.locator('tr', { hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText('1 000');
    await expect(row).toContainText('50%'); // marge (1500-1000)/1000

    const created = await findProduct();
    const { data: cost } = await admin.from('product_costs').select('purchase_price').eq('product_id', created!.id).single();
    expect(Number(cost!.purchase_price)).toBe(1000);

    // Modification du prix d'achat
    await row.getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Modifier' }).click();
    await page.getByRole('dialog').locator('input[type=number]').nth(0).fill('1200');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.locator('tr', { hasText: name })).toContainText('1 200');
    const { data: cost2 } = await admin.from('product_costs').select('purchase_price').eq('product_id', created!.id).single();
    expect(Number(cost2!.purchase_price)).toBe(1200);
  });
});
