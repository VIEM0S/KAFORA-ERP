/**
 * cancel_sale() — aucun test avant ce fichier (trouvé lors de l'audit du
 * 2026-09-29/30). Son propre commentaire SQL documente explicitement le
 * risque qu'elle corrige : annuler une vente déjà PARTIELLEMENT remboursée
 * restaurerait le stock une seconde fois (une première fois par le retour,
 * une seconde par l'annulation) — jamais vérifié par un test avant celui-ci.
 *
 * Ne vérifie pas l'identité de l'appelant via le JWT (fait confiance à
 * p_tenant_id/p_caller_id, transmis par la route après son propre contrôle
 * de permission) et est révoquée pour anon/authenticated (migration 038) —
 * suite RPC (service-role), pas RLS.
 *
 * Nécessite `npm run test:rpc` (charge .env puis .env.test.local).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes — lancer via `npm run test:rpc`.');
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function createTestTenant(suffix: string) {
  const { data, error } = await admin.from('tenants')
    .insert({ name: `RPC Test ${suffix}`, slug: `rpc-cancelsale-${suffix}-${Date.now()}`, email: `rpc-cancelsale-${suffix}@example.com` })
    .select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function deleteTestTenant(tenantId: string) {
  await admin.from('tenants').delete().eq('id', tenantId);
}

async function createStore(tenantId: string) {
  const { data, error } = await admin.from('stores').insert({ tenant_id: tenantId, name: 'Magasin test', code: 'MT' }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function createProduct(tenantId: string, name = 'Produit test') {
  const { data, error } = await admin.from('products').insert({ tenant_id: tenantId, name, selling_price: 1000 }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function createInventory(tenantId: string, storeId: string, productId: string, quantity: number) {
  const { error } = await admin.from('inventory').insert({ tenant_id: tenantId, store_id: storeId, product_id: productId, quantity });
  if (error) throw error;
}

async function getInventoryQty(tenantId: string, storeId: string, productId: string): Promise<number | null> {
  const { data } = await admin.from('inventory').select('quantity').eq('tenant_id', tenantId).eq('store_id', storeId).eq('product_id', productId).maybeSingle();
  return data ? Number(data.quantity) : null;
}

async function createCustomer(tenantId: string, creditUsed: number) {
  const { data, error } = await admin.from('customers').insert({ tenant_id: tenantId, first_name: 'Client', last_name: 'Test', credit_used: creditUsed }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function createSale(tenantId: string, storeId: string, overrides: { status?: string; customerId?: string | null; paymentMethod?: string; total?: number } = {}) {
  const { data, error } = await admin.from('sales').insert({
    tenant_id: tenantId, store_id: storeId, reference: `SALE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: overrides.status ?? 'COMPLETED', customer_id: overrides.customerId ?? null,
    payment_method: overrides.paymentMethod ?? 'CASH', total: overrides.total ?? 0, paid_amount: overrides.total ?? 0,
  }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function addSaleItem(saleId: string, tenantId: string, productId: string | null, productName: string, quantity: number, unitPrice = 1000) {
  const { error } = await admin.from('sale_items').insert({
    sale_id: saleId, tenant_id: tenantId, product_id: productId, product_name: productName,
    quantity, unit_price: unitPrice, total: quantity * unitPrice,
  });
  if (error) throw error;
}

async function createCredit(tenantId: string, customerId: string, saleId: string, totalAmount: number, remainingAmount: number) {
  const { data, error } = await admin.from('credits').insert({
    tenant_id: tenantId, customer_id: customerId, sale_id: saleId,
    total_amount: totalAmount, paid_amount: totalAmount - remainingAmount, remaining_amount: remainingAmount, status: 'PENDING',
  }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

let tenantId: string;
let storeId: string;

beforeEach(async () => {
  tenantId = await createTestTenant(Math.random().toString(36).slice(2, 8));
  storeId = await createStore(tenantId);
});

afterEach(async () => {
  await deleteTestTenant(tenantId);
});

describe('cancel_sale', () => {
  it('NOT_FOUND pour une vente inexistante', async () => {
    const { error } = await admin.rpc('cancel_sale', {
      p_tenant_id: tenantId, p_sale_id: '00000000-0000-0000-0000-000000000000', p_caller_id: null, p_motif: 'Test',
    });
    expect(error?.message).toMatch(/NOT_FOUND/);
  });

  it('ALREADY_CANCELLED pour une vente déjà annulée', async () => {
    const saleId = await createSale(tenantId, storeId, { status: 'CANCELLED' });
    const { error } = await admin.rpc('cancel_sale', { p_tenant_id: tenantId, p_sale_id: saleId, p_caller_id: null, p_motif: 'Test' });
    expect(error?.message).toMatch(/ALREADY_CANCELLED/);
  });

  it('ALREADY_CANCELLED pour une vente PARTIALLY_REFUNDED (évite de restaurer le stock une seconde fois)', async () => {
    const saleId = await createSale(tenantId, storeId, { status: 'PARTIALLY_REFUNDED' });
    const { error } = await admin.rpc('cancel_sale', { p_tenant_id: tenantId, p_sale_id: saleId, p_caller_id: null, p_motif: 'Test' });
    expect(error?.message).toMatch(/ALREADY_CANCELLED/);
  });

  it('chemin normal : restaure le stock de chaque ligne et passe la vente à CANCELLED', async () => {
    const productId = await createProduct(tenantId);
    await createInventory(tenantId, storeId, productId, 10);
    const saleId = await createSale(tenantId, storeId, { total: 2000 });
    await addSaleItem(saleId, tenantId, productId, 'Produit test', 2);

    const { data, error } = await admin.rpc('cancel_sale', { p_tenant_id: tenantId, p_sale_id: saleId, p_caller_id: null, p_motif: 'Erreur de saisie' });
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true });

    expect(await getInventoryQty(tenantId, storeId, productId)).toBe(12); // 10 + 2 restaurés
    const { data: sale } = await admin.from('sales').select('status, cancellation_reason').eq('id', saleId).single();
    expect(sale?.status).toBe('CANCELLED');
    expect(sale?.cancellation_reason).toBe('Erreur de saisie');
  });

  it('ignore sans erreur une ligne sans product_id (produit supprimé depuis)', async () => {
    const productId = await createProduct(tenantId);
    await createInventory(tenantId, storeId, productId, 10);
    const saleId = await createSale(tenantId, storeId, { total: 3000 });
    await addSaleItem(saleId, tenantId, productId, 'Produit test', 2);
    await addSaleItem(saleId, tenantId, null, 'Produit supprimé', 1); // product_id null

    const { error } = await admin.rpc('cancel_sale', { p_tenant_id: tenantId, p_sale_id: saleId, p_caller_id: null, p_motif: 'Test' });
    expect(error).toBeNull();
    expect(await getInventoryQty(tenantId, storeId, productId)).toBe(12); // seule la ligne valide est restaurée
    const { data: sale } = await admin.from('sales').select('status').eq('id', saleId).single();
    expect(sale?.status).toBe('CANCELLED');
  });

  it('ne restaure QUE le solde restant du crédit lié (pas le montant total) au crédit utilisé du client', async () => {
    const customerId = await createCustomer(tenantId, 20000);
    const saleId = await createSale(tenantId, storeId, { customerId, total: 20000, paymentMethod: 'CREDIT' });
    // Le client a déjà remboursé 12 000 sur les 20 000 : le solde restant n'est que de 8 000.
    await createCredit(tenantId, customerId, saleId, 20000, 8000);

    const { error } = await admin.rpc('cancel_sale', { p_tenant_id: tenantId, p_sale_id: saleId, p_caller_id: null, p_motif: 'Test' });
    expect(error).toBeNull();

    const { data: customer } = await admin.from('customers').select('credit_used').eq('id', customerId).single();
    // 20 000 − 8 000 (seul le solde restant est libéré, pas le total) = 12 000.
    expect(Number(customer?.credit_used)).toBe(12000);

    const { data: credit } = await admin.from('credits').select('status, remaining_amount').eq('sale_id', saleId).single();
    expect(credit?.status).toBe('CANCELLED');
    expect(Number(credit?.remaining_amount)).toBe(0);
  });
});
