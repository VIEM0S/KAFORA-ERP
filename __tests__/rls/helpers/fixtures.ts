/**
 * Fixtures minimales pour les tests RLS — insérées en tant que rôle
 * `postgres` (superutilisateur du conteneur local Supabase, contourne RLS
 * par nature), avant de rebasculer sur `authenticated`/`anon` via
 * RlsTestClient.actingAs() pour l'assertion elle-même.
 */
import type { RlsTestClient } from './rls-client';

export async function createTenant(db: RlsTestClient, overrides: { name?: string } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into tenants (name, slug, email) values ($1, $2, $3) returning id`,
    [overrides.name ?? 'Tenant Test', `tenant-test-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'test@example.com']
  );
  return rows[0].id;
}

export async function createStore(db: RlsTestClient, tenantId: string, overrides: { code?: string } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into stores (tenant_id, name, code) values ($1, $2, $3) returning id`,
    [tenantId, 'Boutique Test', overrides.code ?? `ST-${Math.random().toString(36).slice(2, 8)}`]
  );
  return rows[0].id;
}

export async function createProduct(db: RlsTestClient, tenantId: string, overrides: { name?: string } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into products (tenant_id, name, selling_price) values ($1, $2, $3) returning id`,
    [tenantId, overrides.name ?? 'Produit Test', 1000]
  );
  return rows[0].id;
}

export async function createInventoryRow(
  db: RlsTestClient,
  tenantId: string,
  productId: string,
  storeId: string,
  quantity = 10
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into inventory (tenant_id, product_id, store_id, quantity) values ($1, $2, $3, $4) returning id`,
    [tenantId, productId, storeId, quantity]
  );
  return rows[0].id;
}

export async function setSubscriptionStatus(
  db: RlsTestClient,
  tenantId: string,
  status: 'TRIAL' | 'ACTIVE' | 'CANCELLED' | 'EXPIRED'
) {
  await db.query(
    `insert into subscriptions (tenant_id, status) values ($1, $2)
     on conflict (tenant_id) do update set status = excluded.status`,
    [tenantId, status]
  );
}
