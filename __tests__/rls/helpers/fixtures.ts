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

/**
 * Ligne auth.users minimale — nécessaire pour tout test appelant une RPC qui
 * écrit audit_log (actor_id référence auth.users) sous un acteur simulé via
 * actingAs() : celle-ci ne fait que poser des claims JWT, elle ne crée
 * jamais de ligne réelle. Sans ça, l'écriture audit_log échoue sur une
 * violation de clé étrangère plutôt que de tester la branche visée — piège
 * documenté lors de l'audit de couverture de tests du 2026-09-29.
 */
export async function createUser(db: RlsTestClient, overrides: { email?: string } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id, email, instance_id, aud, role)
     values (gen_random_uuid(), $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
     returning id`,
    [overrides.email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`]
  );
  return rows[0].id;
}

export async function createStocktake(
  db: RlsTestClient,
  tenantId: string,
  storeId: string,
  overrides: { status?: string; createdBy?: string | null; lossValue?: number; submitted?: boolean } = {}
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into stocktakes (tenant_id, store_id, status, created_by, created_by_name, loss_value, submitted_at)
     values ($1, $2, $3, $4, 'Créateur Test', $5, case when $6 then now() else null end)
     returning id`,
    [tenantId, storeId, overrides.status ?? 'IN_PROGRESS', overrides.createdBy ?? null, overrides.lossValue ?? null, overrides.submitted ?? false]
  );
  return rows[0].id;
}

export async function createStocktakeLine(
  db: RlsTestClient,
  tenantId: string,
  storeId: string,
  stocktakeId: string,
  productId: string,
  overrides: { expectedQty?: number; countedQty?: number | null; unitCost?: number; productName?: string } = {}
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into stocktake_lines (tenant_id, store_id, stocktake_id, product_id, product_name, expected_qty, counted_qty, unit_cost)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      tenantId, storeId, stocktakeId, productId, overrides.productName ?? 'Produit Test',
      overrides.expectedQty ?? 10, overrides.countedQty ?? null, overrides.unitCost ?? 1000,
    ]
  );
  return rows[0].id;
}

export async function createCustomer(
  db: RlsTestClient,
  tenantId: string,
  overrides: { firstName?: string; creditUsed?: number; registeredStoreId?: string | null } = {}
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into customers (tenant_id, first_name, last_name, credit_used, registered_store_id)
     values ($1, $2, 'Test', $3, $4) returning id`,
    [tenantId, overrides.firstName ?? 'Client', overrides.creditUsed ?? 0, overrides.registeredStoreId ?? null]
  );
  return rows[0].id;
}

export async function createCredit(
  db: RlsTestClient,
  tenantId: string,
  customerId: string,
  overrides: {
    totalAmount?: number; remainingAmount?: number; status?: string;
    writeOffStatus?: string; writeOffRequestedBy?: string | null;
  } = {}
) {
  const totalAmount = overrides.totalAmount ?? 20000;
  const { rows } = await db.query<{ id: string }>(
    `insert into credits (tenant_id, customer_id, total_amount, paid_amount, remaining_amount, status, write_off_status, write_off_requested_by)
     values ($1, $2, $3, 0, $4, $5, $6, $7) returning id`,
    [
      tenantId, customerId, totalAmount, overrides.remainingAmount ?? totalAmount,
      overrides.status ?? 'PENDING', overrides.writeOffStatus ?? 'NONE', overrides.writeOffRequestedBy ?? null,
    ]
  );
  return rows[0].id;
}

export async function setWriteOffThreshold(db: RlsTestClient, tenantId: string, threshold: number) {
  await db.query(`update tenants set write_off_approval_threshold = $1 where id = $2`, [threshold, tenantId]);
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
