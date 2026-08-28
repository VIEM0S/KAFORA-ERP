/**
 * RLS — gel d'écriture si abonnement expiré/annulé (subscription_active(),
 * can_write() — supabase/migrations/006_auth_helper_functions.sql).
 *
 * Permissif par défaut : un tenant sans ligne `subscriptions` du tout, ou
 * dans un état non bloquant, peut toujours écrire — même politique que
 * subDocAllows() côté firestore.rules (voir lib/subscription/status.ts).
 * La tolérance de grâce spécifique au POS (3 jours de plus) n'est PAS
 * couverte ici : elle reste un contrôle applicatif dans la RPC de
 * checkout, pas dans can_write() — voir plan de migration.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { RlsTestClient } from './helpers/rls-client';
import { createTenant, setSubscriptionStatus } from './helpers/fixtures';

let db: RlsTestClient;

beforeAll(async () => { db = await RlsTestClient.connect(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.begin(); });
afterEach(async () => { await db.rollback(); });

describe('products — gel d\'écriture selon l\'état de l\'abonnement', () => {
  it("un tenant sans ligne subscriptions peut écrire (permissif par défaut)", async () => {
    const tenant = await createTenant(db);

    await db.actingAs({ tenantId: tenant, role: 'OWNER' });
    const { rows } = await db.query(
      'insert into products (tenant_id, name, selling_price) values ($1, $2, $3) returning id',
      [tenant, 'Produit', 1000]
    );
    expect(rows).toHaveLength(1);
  });

  it("un abonnement CANCELLED bloque l'écriture mais pas la lecture", async () => {
    const tenant = await createTenant(db);
    await setSubscriptionStatus(db, tenant, 'CANCELLED');

    await db.actingAs({ tenantId: tenant, role: 'OWNER' });

    const err = await db.queryExpectingError(
      'insert into products (tenant_id, name, selling_price) values ($1, $2, $3)',
      [tenant, 'Produit refusé', 1000]
    );
    expect(err.message).toMatch(/row-level security/i);

    // La lecture, elle, doit toujours fonctionner après l'échec de l'écriture
    // (le SAVEPOINT de queryExpectingError a nettoyé la transaction) — c'est
    // ce qui distingue un gel d'écriture d'un blocage total du tenant.
    const { rows } = await db.query('select id from products');
    expect(rows).toHaveLength(0); // lecture OK, juste rien à lire ici
  });

  it("un abonnement EXPIRED bloque l'écriture même pour un OWNER", async () => {
    const tenant = await createTenant(db);
    await setSubscriptionStatus(db, tenant, 'EXPIRED');

    await db.actingAs({ tenantId: tenant, role: 'OWNER' });
    await expect(
      db.query('insert into products (tenant_id, name, selling_price) values ($1, $2, $3)', [
        tenant,
        'Produit refusé',
        1000,
      ])
    ).rejects.toThrow(/row-level security/i);
  });

  it("un abonnement TRIAL actif n'entrave pas l'écriture", async () => {
    const tenant = await createTenant(db);
    await setSubscriptionStatus(db, tenant, 'TRIAL');

    await db.actingAs({ tenantId: tenant, role: 'OWNER' });
    const { rows } = await db.query(
      'insert into products (tenant_id, name, selling_price) values ($1, $2, $3) returning id',
      [tenant, 'Produit', 1000]
    );
    expect(rows).toHaveLength(1);
  });
});
