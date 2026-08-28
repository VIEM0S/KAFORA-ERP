/**
 * RLS — cloisonnement par magasin (`store_ids` du JWT) sur `inventory`.
 *
 * Couvre le cas REGIONAL_MANAGER : accès restreint à un sous-ensemble de
 * magasins du tenant, via can_access_store() (supabase/migrations,
 * fonctions auth helper) — équivalent Postgres du even storeIds côté
 * Firebase custom claims. `store_ids: null` (OWNER/ADMIN typiquement)
 * signifie accès à tous les magasins du tenant, sans liste à maintenir.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { RlsTestClient } from './helpers/rls-client';
import { createTenant, createStore, createProduct, createInventoryRow } from './helpers/fixtures';

let db: RlsTestClient;

beforeAll(async () => { db = await RlsTestClient.connect(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.begin(); });
afterEach(async () => { await db.rollback(); });

describe('inventory — cloisonnement par magasin', () => {
  it("un REGIONAL_MANAGER ne voit le stock que des magasins listés dans son JWT", async () => {
    const tenant = await createTenant(db);
    const storeAllowed = await createStore(db, tenant);
    const storeForbidden = await createStore(db, tenant);
    const product = await createProduct(db, tenant);
    await createInventoryRow(db, tenant, product, storeAllowed, 5);
    await createInventoryRow(db, tenant, product, storeForbidden, 99);

    await db.actingAs({ tenantId: tenant, role: 'REGIONAL_MANAGER', storeIds: [storeAllowed] });
    const { rows } = await db.query<{ quantity: string }>('select quantity from inventory');

    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe('5');
  });

  it("un OWNER (store_ids null) voit le stock de tous les magasins du tenant", async () => {
    const tenant = await createTenant(db);
    const store1 = await createStore(db, tenant);
    const store2 = await createStore(db, tenant);
    const product = await createProduct(db, tenant);
    await createInventoryRow(db, tenant, product, store1);
    await createInventoryRow(db, tenant, product, store2);

    await db.actingAs({ tenantId: tenant, role: 'OWNER', storeIds: null });
    const { rows } = await db.query('select id from inventory');

    expect(rows).toHaveLength(2);
  });

  it("un REGIONAL_MANAGER ne peut pas ajuster le stock d'un magasin hors de sa liste", async () => {
    const tenant = await createTenant(db);
    const storeForbidden = await createStore(db, tenant);
    const product = await createProduct(db, tenant);
    const otherAllowedStore = await createStore(db, tenant);

    await db.actingAs({ tenantId: tenant, role: 'REGIONAL_MANAGER', storeIds: [otherAllowedStore] });
    await expect(
      db.query(
        'insert into inventory (tenant_id, product_id, store_id, quantity) values ($1, $2, $3, $4)',
        [tenant, product, storeForbidden, 10]
      )
    ).rejects.toThrow(/row-level security/i);
  });
});
