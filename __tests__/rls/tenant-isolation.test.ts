/**
 * RLS — cloisonnement tenant sur `products`.
 *
 * Aucune règle équivalente n'existait quand ces politiques étaient encore
 * du code Firestore (firestore.rules n'était testé nulle part) — ces tests
 * sont un vrai gain de couverture apporté par la migration, pas un portage.
 *
 * Nécessite `supabase start` (Postgres local, voir supabase/config.toml).
 * Lancé séparément de la suite par défaut via `npm run test:rls`.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { RlsTestClient } from './helpers/rls-client';
import { createTenant, createProduct } from './helpers/fixtures';

let db: RlsTestClient;

beforeAll(async () => { db = await RlsTestClient.connect(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.begin(); });
afterEach(async () => { await db.rollback(); });

describe('products — cloisonnement par tenant', () => {
  it("un OWNER ne voit que les produits de son propre tenant", async () => {
    const tenantA = await createTenant(db);
    const tenantB = await createTenant(db);
    await createProduct(db, tenantA, { name: 'Produit A' });
    await createProduct(db, tenantB, { name: 'Produit B' });

    await db.actingAs({ tenantId: tenantA, role: 'OWNER' });
    const { rows } = await db.query<{ name: string }>('select name from products');

    expect(rows.map((r) => r.name)).toEqual(['Produit A']);
  });

  it("un utilisateur non authentifié (rôle anon) ne voit aucun produit", async () => {
    const tenantA = await createTenant(db);
    await createProduct(db, tenantA);

    await db.actingAs({ tenantId: null, role: null });
    const { rows } = await db.query('select id from products');

    expect(rows).toHaveLength(0);
  });

  it("un OWNER ne peut pas créer un produit pour un autre tenant que le sien", async () => {
    const tenantA = await createTenant(db);
    const tenantB = await createTenant(db);

    await db.actingAs({ tenantId: tenantA, role: 'OWNER' });
    await expect(
      db.query('insert into products (tenant_id, name, selling_price) values ($1, $2, $3)', [
        tenantB,
        'Produit intrus',
        500,
      ])
    ).rejects.toThrow(/row-level security/i);
  });

  it("un CASHIER peut lire les produits de son tenant mais pas en créer", async () => {
    const tenantA = await createTenant(db);
    await createProduct(db, tenantA, { name: 'Existant' });

    await db.actingAs({ tenantId: tenantA, role: 'CASHIER' });
    const read = await db.query('select id from products');
    expect(read.rows).toHaveLength(1);

    await expect(
      db.query('insert into products (tenant_id, name, selling_price) values ($1, $2, $3)', [
        tenantA,
        'Nouveau',
        500,
      ])
    ).rejects.toThrow(/row-level security/i);
  });

  it("un MANAGER peut créer un produit dans son propre tenant", async () => {
    const tenantA = await createTenant(db);

    await db.actingAs({ tenantId: tenantA, role: 'MANAGER' });
    const { rows } = await db.query<{ id: string }>(
      'insert into products (tenant_id, name, selling_price) values ($1, $2, $3) returning id',
      [tenantA, 'Créé par manager', 750]
    );
    expect(rows).toHaveLength(1);
  });
});
