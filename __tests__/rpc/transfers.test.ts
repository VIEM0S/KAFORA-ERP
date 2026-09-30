/**
 * ship_transfer() / receive_transfer() / decide_transfer() — aucun test
 * avant ce fichier (trouvé lors de l'audit du 2026-09-29/30), alors que ce
 * sont les seules RPC qui déplacent du stock entre DEUX magasins : un bug
 * ici crée ou détruit du stock plutôt que de simplement le comptabiliser
 * mal dans un seul magasin.
 *
 * Aucune des trois ne vérifie l'identité de l'appelant via auth.uid()/
 * auth_role() (elles font confiance à p_tenant_id/p_caller_id, transmis par
 * la route après son propre contrôle de permission) et sont révoquées pour
 * anon/authenticated (migration 038) — suite RPC (service-role), pas RLS,
 * comme admin-extend-subscription.test.ts.
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
    .insert({ name: `RPC Test ${suffix}`, slug: `rpc-transfer-${suffix}-${Date.now()}`, email: `rpc-transfer-${suffix}@example.com` })
    .select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function deleteTestTenant(tenantId: string) {
  await admin.from('tenants').delete().eq('id', tenantId);
}

async function createStore(tenantId: string, name: string) {
  const { data, error } = await admin.from('stores').insert({ tenant_id: tenantId, name, code: name.slice(0, 8) }).select('id').single();
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

async function createTransfer(tenantId: string, fromStoreId: string, toStoreId: string, status = 'PENDING') {
  const { data, error } = await admin.from('transfers')
    .insert({ tenant_id: tenantId, reference: `TR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, from_store_id: fromStoreId, to_store_id: toStoreId, status })
    .select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function addLine(transferId: string, productId: string, productName: string, quantity: number) {
  const { error } = await admin.from('transfer_lines').insert({ transfer_id: transferId, product_id: productId, product_name: productName, quantity });
  if (error) throw error;
}

let tenantId: string;
let storeA: string; // source
let storeB: string; // destination

beforeEach(async () => {
  tenantId = await createTestTenant(Math.random().toString(36).slice(2, 8));
  storeA = await createStore(tenantId, 'Magasin A');
  storeB = await createStore(tenantId, 'Magasin B');
});

afterEach(async () => {
  await deleteTestTenant(tenantId);
});

describe('ship_transfer', () => {
  it('NOT_FOUND pour un transfert inexistant', async () => {
    const { error } = await admin.rpc('ship_transfer', { p_tenant_id: tenantId, p_transfer_id: '00000000-0000-0000-0000-000000000000', p_caller_id: null });
    expect(error?.message).toMatch(/NOT_FOUND/);
  });

  it('INVALID_STATUS si le transfert n\'est pas APPROVED (encore PENDING)', async () => {
    const transferId = await createTransfer(tenantId, storeA, storeB, 'PENDING');
    const { error } = await admin.rpc('ship_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null });
    expect(error?.message).toMatch(/INVALID_STATUS/);
  });

  it('NO_STOCK si aucune ligne inventory n\'existe pour ce produit à la source', async () => {
    const productId = await createProduct(tenantId);
    const transferId = await createTransfer(tenantId, storeA, storeB, 'APPROVED');
    await addLine(transferId, productId, 'Produit test', 5);
    // Pas de createInventory ici — aucune ligne à la source.
    const { error } = await admin.rpc('ship_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null });
    expect(error?.message).toMatch(/NO_STOCK/);
  });

  it('INSUFFICIENT_STOCK si le stock à la source est inférieur à la quantité demandée', async () => {
    const productId = await createProduct(tenantId);
    await createInventory(tenantId, storeA, productId, 3);
    const transferId = await createTransfer(tenantId, storeA, storeB, 'APPROVED');
    await addLine(transferId, productId, 'Produit test', 5);
    const { error } = await admin.rpc('ship_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null });
    expect(error?.message).toMatch(/INSUFFICIENT_STOCK/);
  });

  it('chemin normal : décrémente le stock source et passe le transfert à SHIPPED', async () => {
    const productId = await createProduct(tenantId);
    await createInventory(tenantId, storeA, productId, 10);
    const transferId = await createTransfer(tenantId, storeA, storeB, 'APPROVED');
    await addLine(transferId, productId, 'Produit test', 4);

    const { data, error } = await admin.rpc('ship_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null });
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true });

    expect(await getInventoryQty(tenantId, storeA, productId)).toBe(6);
    const { data: transfer } = await admin.from('transfers').select('status').eq('id', transferId).single();
    expect(transfer?.status).toBe('SHIPPED');
    const { data: movements } = await admin.from('inventory_movements').select('type, quantity').eq('transfer_id', transferId);
    expect(movements).toMatchObject([{ type: 'TRANSFER_OUT', quantity: -4 }]);
  });

  it('tout-ou-rien : si une ligne échoue, le décrément déjà fait sur une ligne précédente est annulé (rollback)', async () => {
    const productOk = await createProduct(tenantId, 'Produit OK');
    const productShort = await createProduct(tenantId, 'Produit en rupture');
    await createInventory(tenantId, storeA, productOk, 10);
    await createInventory(tenantId, storeA, productShort, 2);
    const transferId = await createTransfer(tenantId, storeA, storeB, 'APPROVED');
    await addLine(transferId, productOk, 'Produit OK', 4);
    await addLine(transferId, productShort, 'Produit en rupture', 5); // insuffisant

    const { error } = await admin.rpc('ship_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null });
    expect(error?.message).toMatch(/INSUFFICIENT_STOCK/);

    // Le produit OK ne doit PAS avoir été décrémenté malgré son traitement
    // avant l'échec — toute la transaction a été annulée.
    expect(await getInventoryQty(tenantId, storeA, productOk)).toBe(10);
    const { data: transfer } = await admin.from('transfers').select('status').eq('id', transferId).single();
    expect(transfer?.status).toBe('APPROVED'); // pas passé à SHIPPED
  });
});

describe('receive_transfer', () => {
  it('NOT_FOUND pour un transfert inexistant', async () => {
    const { error } = await admin.rpc('receive_transfer', { p_tenant_id: tenantId, p_transfer_id: '00000000-0000-0000-0000-000000000000', p_caller_id: null });
    expect(error?.message).toMatch(/NOT_FOUND/);
  });

  it('INVALID_STATUS si le transfert n\'a pas encore été expédié (encore APPROVED)', async () => {
    const transferId = await createTransfer(tenantId, storeA, storeB, 'APPROVED');
    const { error } = await admin.rpc('receive_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null });
    expect(error?.message).toMatch(/INVALID_STATUS/);
  });

  it('crée la ligne inventory à destination si le produit n\'y avait jamais été vu', async () => {
    const productId = await createProduct(tenantId);
    const transferId = await createTransfer(tenantId, storeA, storeB, 'SHIPPED');
    await addLine(transferId, productId, 'Produit test', 4);

    const { data, error } = await admin.rpc('receive_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null });
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true });

    expect(await getInventoryQty(tenantId, storeB, productId)).toBe(4);
    const { data: transfer } = await admin.from('transfers').select('status').eq('id', transferId).single();
    expect(transfer?.status).toBe('RECEIVED');
  });

  it('incrémente la ligne inventory existante à destination', async () => {
    const productId = await createProduct(tenantId);
    await createInventory(tenantId, storeB, productId, 6);
    const transferId = await createTransfer(tenantId, storeA, storeB, 'SHIPPED');
    await addLine(transferId, productId, 'Produit test', 4);

    const { error } = await admin.rpc('receive_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null });
    expect(error).toBeNull();
    expect(await getInventoryQty(tenantId, storeB, productId)).toBe(10);
  });
});

describe('decide_transfer', () => {
  it('INVALID_ACTION pour une action inconnue', async () => {
    const transferId = await createTransfer(tenantId, storeA, storeB, 'PENDING');
    const { error } = await admin.rpc('decide_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null, p_action: 'YOLO', p_reason: null,
    });
    expect(error?.message).toMatch(/INVALID_ACTION/);
  });

  it('NOT_FOUND pour un transfert inexistant', async () => {
    const { error } = await admin.rpc('decide_transfer', {
      p_tenant_id: tenantId, p_transfer_id: '00000000-0000-0000-0000-000000000000', p_caller_id: null, p_action: 'APPROVE', p_reason: null,
    });
    expect(error?.message).toMatch(/NOT_FOUND/);
  });

  it('APPROVE puis REJECT ne sont valides que depuis PENDING', async () => {
    const transferId = await createTransfer(tenantId, storeA, storeB, 'APPROVED'); // déjà décidé
    const { error } = await admin.rpc('decide_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null, p_action: 'APPROVE', p_reason: null,
    });
    expect(error?.message).toMatch(/INVALID_STATUS/);
  });

  it('APPROVE depuis PENDING passe le transfert à APPROVED', async () => {
    const transferId = await createTransfer(tenantId, storeA, storeB, 'PENDING');
    const { data, error } = await admin.rpc('decide_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null, p_action: 'APPROVE', p_reason: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true, restocked: false });
    const { data: transfer } = await admin.from('transfers').select('status').eq('id', transferId).single();
    expect(transfer?.status).toBe('APPROVED');
  });

  it('REJECT depuis PENDING passe le transfert à REJECTED avec son motif', async () => {
    const transferId = await createTransfer(tenantId, storeA, storeB, 'PENDING');
    const { error } = await admin.rpc('decide_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null, p_action: 'REJECT', p_reason: 'Magasin B déjà approvisionné',
    });
    expect(error).toBeNull();
    const { data: transfer } = await admin.from('transfers').select('status, rejection_reason').eq('id', transferId).single();
    expect(transfer?.status).toBe('REJECTED');
    expect(transfer?.rejection_reason).toBe('Magasin B déjà approvisionné');
  });

  it('CANCEL depuis PENDING ou APPROVED ne restocke rien (le stock n\'est jamais sorti)', async () => {
    const productId = await createProduct(tenantId);
    await createInventory(tenantId, storeA, productId, 10);
    const transferId = await createTransfer(tenantId, storeA, storeB, 'APPROVED');
    await addLine(transferId, productId, 'Produit test', 4);

    const { data, error } = await admin.rpc('decide_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null, p_action: 'CANCEL', p_reason: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true, restocked: false });
    expect(await getInventoryQty(tenantId, storeA, productId)).toBe(10); // inchangé, jamais sorti
  });

  it('CANCEL depuis SHIPPED restocke le magasin source (le stock en était déjà sorti)', async () => {
    const productId = await createProduct(tenantId);
    await createInventory(tenantId, storeA, productId, 10);
    const transferId = await createTransfer(tenantId, storeA, storeB, 'APPROVED');
    await addLine(transferId, productId, 'Produit test', 4);
    const ship = await admin.rpc('ship_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null });
    expect(ship.error).toBeNull();
    expect(await getInventoryQty(tenantId, storeA, productId)).toBe(6); // sorti

    const { data, error } = await admin.rpc('decide_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null, p_action: 'CANCEL', p_reason: 'Erreur de destination',
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true, restocked: true });
    expect(await getInventoryQty(tenantId, storeA, productId)).toBe(10); // restitué
    const { data: movements } = await admin.from('inventory_movements').select('type').eq('transfer_id', transferId).eq('type', 'TRANSFER_CANCEL');
    expect(movements).toHaveLength(1);
  });

  it('CANCEL est refusé depuis un état terminal (RECEIVED)', async () => {
    const transferId = await createTransfer(tenantId, storeA, storeB, 'RECEIVED');
    const { error } = await admin.rpc('decide_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: null, p_action: 'CANCEL', p_reason: null,
    });
    expect(error?.message).toMatch(/INVALID_STATUS/);
  });
});
