import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, STORE_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Régression directe de deux bugs trouvés le 2026-09-07 :
 * 1. Une vente REFUNDED s'affichait "Annulée" dans la liste (le badge ne
 *    connaissait que COMPLETED/CANCELLED).
 * 2. Le panneau de détail ne se rafraîchissait jamais après un retour.
 */
test.describe('Vente — retour client', () => {
  let productId: string;
  let saleId: string;
  let saleReference: string;

  test.beforeAll(async () => {
    const admin = supabaseAdmin();
    const suffix = uniqueSuffix();

    const { data: product, error: prodError } = await admin
      .from('products')
      .insert({
        tenant_id: TENANT_ID,
        name: 'Produit Retour E2E',
        sku: `E2E-RET-${suffix}`,
        selling_price: 3000,
        purchase_price: 1800,
        is_active: true,
      })
      .select('id')
      .single();
    if (prodError) throw prodError;
    productId = product.id;

    await admin.from('inventory').insert({ tenant_id: TENANT_ID, product_id: productId, store_id: STORE_ID, quantity: 5 });

    saleReference = `FAC-E2E-${suffix}`;
    const { data: sale, error: saleError } = await admin
      .from('sales')
      .insert({
        tenant_id: TENANT_ID,
        store_id: STORE_ID,
        reference: saleReference,
        status: 'COMPLETED',
        subtotal: 3000,
        tax_amount: 0,
        discount_amount: 0,
        total: 3000,
        paid_amount: 3000,
        change_given: 0,
        payment_method: 'CASH',
        customer_name: 'Client comptoir',
        item_count: 1,
      })
      .select('id')
      .single();
    if (saleError) throw saleError;
    saleId = sale.id;

    const { error: itemError } = await admin.from('sale_items').insert({
      sale_id: saleId,
      tenant_id: TENANT_ID,
      product_id: productId,
      product_name: 'Produit Retour E2E',
      product_sku: `E2E-RET-${suffix}`,
      quantity: 1,
      unit_price: 3000,
      discount_percent: 0,
      tax_rate: 0,
      total: 3000,
    });
    if (itemError) throw itemError; // sans ce contrôle, un insert cassé (ex. tenant_id manquant) échoue en silence
  });

  test.afterAll(async () => {
    const admin = supabaseAdmin();
    await admin.from('sale_return_items').delete().in(
      'sale_return_id',
      (await admin.from('sale_returns').select('id').eq('sale_id', saleId)).data?.map((r) => r.id) ?? []
    );
    await admin.from('sale_returns').delete().eq('sale_id', saleId);
    await admin.from('inventory_movements').delete().eq('product_id', productId);
    await admin.from('sync_dedup').delete().eq('sale_id', saleId);
    await admin.from('sale_items').delete().eq('sale_id', saleId);
    await admin.from('sales').delete().eq('id', saleId);
    await admin.from('inventory').delete().eq('product_id', productId);
    await admin.from('products').delete().eq('id', productId);
  });

  test('un retour complet affiche "Remboursée" (pas "Annulée") et met à jour le panneau sans rechargement', async ({ page }) => {
    await page.goto('/sales');
    // La recherche ne filtre pas la liste (vérifié en direct). Le montant
    // seul n'est PAS fiable comme identifiant (une vente orpheline d'un run
    // interrompu peut partager le même montant) — cibler l'id de vente, vrai
    // identifiant unique par exécution, affiché en 8 caractères dans la
    // colonne "N° Vente".
    await page.locator('tr', { hasText: saleId.slice(0, 8).toUpperCase() }).first().click();

    // Les articles de la vente sélectionnée viennent d'un fetch séparé
    // (sale_items, useEffect keyé sur selected.id) — attendre qu'ils soient
    // affichés dans le panneau AVANT d'ouvrir "Retourner des articles",
    // sinon le dialogue s'ouvre sur un tableau encore vide et affiche à tort
    // "Tous les articles ont déjà été retournés" (vrai vacuité sur [].every()).
    await expect(page.getByText('Produit Retour E2E')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Retourner des articles' }).click();
    await expect(page.locator('[role="dialog"]').getByText('Produit Retour E2E')).toBeVisible({ timeout: 10_000 });
    // "Remettre en stock" est déjà coché par défaut — seule la quantité (0
    // par défaut = rien à retourner) doit être renseignée.
    await page.locator('input[type="number"]').first().fill('1');
    await page.getByPlaceholder(/motif|Ex : article/i).fill('Test E2E — retour');
    await page.getByRole('button', { name: 'Confirmer le retour' }).click();

    // Régression bug #1 : ne doit JAMAIS afficher "Annulée" pour ce retour.
    // getByText est insensible à la casse (comportement Playwright) — "Annulée"
    // correspond aussi à la carte de stats "Ventes annulées" si on ne scope
    // pas au tableau des lignes.
    await expect(page.getByText('Remboursée').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('table').getByText('Annulée', { exact: true })).toHaveCount(0);

    const admin = supabaseAdmin();
    const { data: sale } = await admin.from('sales').select('status').eq('id', saleId).single();
    expect(sale?.status).toBe('REFUNDED');

    const { data: inv } = await admin.from('inventory').select('quantity').eq('product_id', productId).eq('store_id', STORE_ID).single();
    // La vente de départ est insérée directement en base (pas via un vrai
    // passage en caisse) : le stock initial (5) n'a jamais été décrémenté à
    // la création. Le retour ajoute +1 par-dessus, comme il le ferait pour
    // n'importe quelle vente réelle — 5 + 1 = 6 est donc la valeur correcte
    // ici, pas une régression.
    expect(inv?.quantity).toBe(6);
  });
});
