/**
 * mark_lot_expired() — RPC sans aucun test avant ce fichier (trouvé lors de
 * l'audit du 2026-09-29), alors qu'elle est la plus récente et touche du
 * stock/de l'argent réel : elle remplace un flux "Marquer périmé" qui
 * faisait avant deux écritures séparées (product_lots puis inventory) et
 * pouvait laisser les deux désynchronisées si la seconde échouait après la
 * première (voir migration 079).
 *
 * Même approche que admin-extend-subscription.test.ts : parle au VRAI
 * projet Supabase distant via le client service-role, chaque test crée son
 * propre tenant/magasin/produit/lot jetables et les supprime. Suite séparée
 * de `npm test` — lancée explicitement via `npm run test:rpc`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes — ' +
    'lancer via `npm run test:rpc` (charge .env puis .env.test.local).'
  );
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Défaut réel de tenants.stock_loss_approval_threshold (migration 069) —
// recopié ici plutôt qu'importé, comme admin-extend-subscription.test.ts :
// ce test doit rester valide même si la valeur par défaut change côté
// schéma, seul le comportement de la RPC est sous test (chaque tenant de
// test fixe explicitement sa propre valeur ci-dessous de toute façon).
const DEFAULT_THRESHOLD = 50000;

async function createTestTenant(suffix: string, threshold = DEFAULT_THRESHOLD) {
  const { data: tenant, error } = await admin
    .from('tenants')
    .insert({
      name: `RPC Test ${suffix}`, slug: `rpc-lot-${suffix}-${Date.now()}`,
      email: `rpc-lot-${suffix}@example.com`, stock_loss_approval_threshold: threshold,
    })
    .select('id').single();
  if (error) throw error;
  return tenant.id as string;
}

async function deleteTestTenant(tenantId: string) {
  await admin.from('tenants').delete().eq('id', tenantId);
}

async function createStore(tenantId: string) {
  const { data, error } = await admin.from('stores')
    .insert({ tenant_id: tenantId, name: 'Magasin test', code: 'MT' })
    .select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function createProduct(tenantId: string, sellingPrice: number) {
  const { data, error } = await admin.from('products')
    .insert({ tenant_id: tenantId, name: 'Produit test', selling_price: sellingPrice, track_expiry: true })
    .select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function createInventory(tenantId: string, storeId: string, productId: string, quantity: number) {
  const { data, error } = await admin.from('inventory')
    .insert({ tenant_id: tenantId, store_id: storeId, product_id: productId, quantity })
    .select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function createLot(tenantId: string, storeId: string, productId: string, quantity: number) {
  const { data, error } = await admin.from('product_lots')
    .insert({ tenant_id: tenantId, store_id: storeId, product_id: productId, quantity, expiry_date: '2020-01-01' })
    .select('id').single();
  if (error) throw error;
  return data.id as string;
}

// p_caller_id n'est utilisé par la RPC que pour inventory_movements.created_by
// (une FK vers auth.users) — null plutôt qu'un UUID fictif, qui violerait
// cette contrainte sans rien apporter au test (aucune branche de la RPC ne
// vérifie l'identité de l'appelant via ce paramètre, seul p_caller_role le
// fait, transmis depuis la route qui a déjà authentifié l'appelant).
function callRpc(lotId: string, callerRole: string) {
  return admin.rpc('mark_lot_expired', {
    p_lot_id: lotId, p_caller_id: null, p_caller_role: callerRole,
  });
}

let tenantId: string;
let storeId: string;
let productId: string;

beforeEach(async () => {
  tenantId = await createTestTenant(Math.random().toString(36).slice(2, 8));
  storeId = await createStore(tenantId);
  productId = await createProduct(tenantId, 1000);
});

afterEach(async () => {
  await deleteTestTenant(tenantId);
});

describe('mark_lot_expired — chemin normal', () => {
  it('remet le lot à 0, décrémente inventory.quantity et écrit un mouvement de stock cohérent', async () => {
    await createInventory(tenantId, storeId, productId, 20);
    const lotId = await createLot(tenantId, storeId, productId, 7);

    const { data, error } = await callRpc(lotId, 'MANAGER');
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true, previousQuantity: 20, newQuantity: 13, lotQuantity: 7 });

    const { data: lot } = await admin.from('product_lots').select('quantity').eq('id', lotId).single();
    expect(lot?.quantity).toBe(0);

    const { data: inv } = await admin.from('inventory').select('quantity').eq('tenant_id', tenantId).eq('product_id', productId).single();
    expect(inv?.quantity).toBe(13);

    const { data: movements } = await admin.from('inventory_movements')
      .select('type, quantity, previous_quantity, new_quantity').eq('product_id', productId);
    expect(movements).toHaveLength(1);
    expect(movements?.[0]).toMatchObject({ type: 'ADJUSTMENT', quantity: -7, previous_quantity: 20, new_quantity: 13 });
  });

  it('crée la ligne inventory (quantité 0) si elle n\'existait pas encore pour ce magasin', async () => {
    // Aucun createInventory ici : le lot existe sans ligne inventory associée
    // (cas limite, ex. import de stock initial jamais passé par l'ajustement).
    const lotId = await createLot(tenantId, storeId, productId, 5);

    const { data, error } = await callRpc(lotId, 'OWNER');
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true, previousQuantity: 0, newQuantity: 0, lotQuantity: 5 });

    const { data: inv } = await admin.from('inventory').select('quantity').eq('tenant_id', tenantId).eq('product_id', productId).single();
    expect(inv?.quantity).toBe(0);
  });

  it('NOT_FOUND pour un lot inexistant', async () => {
    const { error } = await callRpc('00000000-0000-0000-0000-000000000000', 'OWNER');
    expect(error?.message).toMatch(/NOT_FOUND/);
  });

  it('INVALID_STATUS pour un lot déjà à zéro (déjà marqué périmé)', async () => {
    await createInventory(tenantId, storeId, productId, 10);
    const lotId = await createLot(tenantId, storeId, productId, 10);
    const first = await callRpc(lotId, 'OWNER');
    expect(first.error).toBeNull();

    const { error } = await callRpc(lotId, 'OWNER');
    expect(error?.message).toMatch(/INVALID_STATUS/);
  });
});

describe('mark_lot_expired — gouvernance du seuil de perte (migration 069)', () => {
  it('FORBIDDEN pour un rôle non OWNER/ADMIN dont la perte dépasse le seuil du tenant', async () => {
    // Seuil à 5 000 FCFA ; produit à 1 000 FCFA/unité ; lot de 10 unités =
    // perte de 10 000 FCFA, au-dessus du seuil.
    tenantId = await createTestTenant(`${Math.random().toString(36).slice(2, 8)}-low`, 5000);
    storeId = await createStore(tenantId);
    productId = await createProduct(tenantId, 1000);
    await createInventory(tenantId, storeId, productId, 10);
    const lotId = await createLot(tenantId, storeId, productId, 10);

    const { error } = await callRpc(lotId, 'MANAGER');
    expect(error?.message).toMatch(/FORBIDDEN/);

    // Le lot ne doit PAS avoir été touché par la tentative refusée.
    const { data: lot } = await admin.from('product_lots').select('quantity').eq('id', lotId).single();
    expect(lot?.quantity).toBe(10);
  });

  it('autorise un rôle non OWNER/ADMIN quand la perte reste sous le seuil', async () => {
    tenantId = await createTestTenant(`${Math.random().toString(36).slice(2, 8)}-ok`, 50000);
    storeId = await createStore(tenantId);
    productId = await createProduct(tenantId, 1000);
    await createInventory(tenantId, storeId, productId, 10);
    const lotId = await createLot(tenantId, storeId, productId, 10); // perte = 10 000 FCFA < 50 000

    const { error } = await callRpc(lotId, 'MANAGER');
    expect(error).toBeNull();
  });

  it('un OWNER/ADMIN contourne toujours le seuil, même très dépassé', async () => {
    tenantId = await createTestTenant(`${Math.random().toString(36).slice(2, 8)}-bypass`, 100);
    storeId = await createStore(tenantId);
    productId = await createProduct(tenantId, 1000);
    await createInventory(tenantId, storeId, productId, 50);
    const lotId = await createLot(tenantId, storeId, productId, 50); // perte = 50 000 FCFA >> seuil 100

    const { error } = await callRpc(lotId, 'OWNER');
    expect(error).toBeNull();
  });
});

describe('mark_lot_expired — verrou de permission', () => {
  it('un appel direct sans le JWT applicatif (anon) est refusé', async () => {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY manquante');
    const anon = createClient(url!, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await createInventory(tenantId, storeId, productId, 5);
    const lotId = await createLot(tenantId, storeId, productId, 5);

    const { error } = await anon.rpc('mark_lot_expired', {
      p_lot_id: lotId, p_caller_id: null, p_caller_role: 'OWNER',
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/permission denied/);
  });
});
