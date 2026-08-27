/**
 * Tables jamais écrites directement par le client — REVOKE INSERT/UPDATE/
 * DELETE du rôle authentifié plutôt qu'une politique RLS (voir
 * supabase/migrations/004_transactional_core.sql et
 * 005_cash_reporting_and_misc.sql, et le point 4 de "Ce qui reste
 * délibérément côté serveur" dans le plan de migration). Équivalent
 * Postgres de `allow write: if false` côté firestore.rules — toute
 * écriture passe forcément par une RPC `SECURITY DEFINER` ou le client
 * service-role.
 *
 * Ce test distingue volontairement REVOKE (permission Postgres, échoue
 * AVANT même d'évaluer une politique RLS — "permission denied for table")
 * d'un simple refus RLS ("new row violates row-level security policy",
 * couvert par les autres fichiers de ce dossier) : une régression qui
 * remplacerait le REVOKE par une politique RLS permissive romprait cette
 * garantie sans qu'aucun test de ce dossier ne le détecte autrement.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { RlsTestClient } from './helpers/rls-client';
import { createTenant } from './helpers/fixtures';

let db: RlsTestClient;

beforeAll(async () => { db = await RlsTestClient.connect(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.begin(); });
afterEach(async () => { await db.rollback(); });

// `default values` (aucune colonne nommée) plutôt qu'un insert ciblant
// tenant_id : plusieurs de ces tables sont des lignes enfants (sale_return_
// items, purchase_order_items, transfer_lines) sans colonne tenant_id
// propre — elles se rattachent à leur parent par FK. Nommer une colonne
// absente ferait échouer l'insert dès l'analyse de la requête ("column
// does not exist"), avant même que Postgres n'évalue la permission —
// ce n'est pas ce qu'on veut tester ici. `default values` reste
// syntaxiquement valide pour toutes ces tables, donc l'exécuteur atteint
// bien la vérification ACL en premier (le refus de permission est
// toujours vérifié avant les contraintes NOT NULL sur les colonnes non
// fournies).
const SERVER_ONLY_TABLES = [
  'sales', 'sale_items', 'payments', 'sale_cost_summary',
  'sale_returns', 'sale_return_items',
  'purchase_orders', 'purchase_order_items',
  'transfers', 'transfer_lines',
  'cash_sessions', 'daily_stats', 'audit_logs',
];

describe('tables à écriture serveur uniquement (REVOKE, pas RLS)', () => {
  it.each(SERVER_ONLY_TABLES)("%s : un utilisateur authentifié ne peut pas y insérer directement", async (table) => {
    const tenant = await createTenant(db);
    await db.actingAs({ tenantId: tenant, role: 'OWNER' });

    const err = await db.queryExpectingError(`insert into ${table} default values`);
    expect(err.message).toMatch(/permission denied for table/i);
  });

  it("inventory_movements : un utilisateur authentifié peut insérer (mouvement) mais jamais modifier/supprimer un historique déjà écrit", async () => {
    const tenant = await createTenant(db);
    await db.actingAs({ tenantId: tenant, role: 'OWNER' });

    // update/delete revoked même si la ligne n'existe pas : la permission
    // manque avant même que Postgres cherche la ligne à modifier.
    const updateErr = await db.queryExpectingError(
      `update inventory_movements set quantity = 0 where tenant_id = $1`,
      [tenant]
    );
    expect(updateErr.message).toMatch(/permission denied for table/i);

    const deleteErr = await db.queryExpectingError(
      `delete from inventory_movements where tenant_id = $1`,
      [tenant]
    );
    expect(deleteErr.message).toMatch(/permission denied for table/i);
  });
});
