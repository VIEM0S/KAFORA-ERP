/**
 * decide_stocktake() / cancel_stocktake() — aucun test avant ce fichier
 * (trouvé lors de l'audit du 2026-09-29), alors que le commentaire
 * d'en-tête de e2e/stocktake.spec.ts affirme à tort que la décision du
 * Propriétaire "est couverte au niveau RPC" — ça n'était vrai nulle part.
 *
 * Ces deux RPC vérifient qui appelle via auth.uid()/auth_role() (lus dans
 * le JWT), pas via un paramètre explicite — impossible à tester avec le
 * client service-role de __tests__/rpc/ (aucun JWT). D'où la suite RLS
 * (Postgres local, `supabase start`) : RlsTestClient.actingAs() simule le
 * JWT de plusieurs acteurs distincts dans le même test, nécessaire pour
 * couvrir le blocage d'auto-approbation (un créateur ne peut pas valider
 * son propre inventaire).
 *
 * Nécessite `supabase start`. Lancé séparément via `npm run test:rls`.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { RlsTestClient } from './helpers/rls-client';
import {
  createTenant, createStore, createProduct, createInventoryRow,
  createUser, createStocktake, createStocktakeLine,
} from './helpers/fixtures';

let db: RlsTestClient;

beforeAll(async () => { db = await RlsTestClient.connect(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.begin(); });
afterEach(async () => { await db.rollback(); });

describe('decide_stocktake', () => {
  it('NOT_FOUND pour un inventaire inexistant', async () => {
    const tenantId = await createTenant(db);
    const owner = await createUser(db);
    await db.actingAs({ tenantId, role: 'OWNER', sub: owner });
    const err = await db.queryExpectingError(
      `select decide_stocktake('00000000-0000-0000-0000-000000000000', true, null, 'Test')`
    );
    expect(err.message).toMatch(/NOT_FOUND/);
  });

  it('FORBIDDEN pour un rôle non Propriétaire/Administrateur (MANAGER)', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const manager = await createUser(db);
    const stocktakeId = await createStocktake(db, tenantId, storeId, {
      status: 'PENDING_APPROVAL', createdBy: creator, lossValue: 10000, submitted: true,
    });

    await db.actingAs({ tenantId, role: 'MANAGER', storeIds: [storeId], sub: manager });
    const err = await db.queryExpectingError(`select decide_stocktake($1, true, null, 'Test')`, [stocktakeId]);
    expect(err.message).toMatch(/FORBIDDEN/);
  });

  it('INVALID_STATUS si l\'inventaire n\'est pas en attente de validation (encore IN_PROGRESS)', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const owner = await createUser(db);
    const stocktakeId = await createStocktake(db, tenantId, storeId, { status: 'IN_PROGRESS', createdBy: creator });

    await db.actingAs({ tenantId, role: 'OWNER', sub: owner });
    const err = await db.queryExpectingError(`select decide_stocktake($1, true, null, 'Test')`, [stocktakeId]);
    expect(err.message).toMatch(/INVALID_STATUS/);
  });

  it('FORBIDDEN : le créateur de l\'inventaire ne peut pas valider sa propre soumission, même Propriétaire', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creatorOwner = await createUser(db);
    const stocktakeId = await createStocktake(db, tenantId, storeId, {
      status: 'PENDING_APPROVAL', createdBy: creatorOwner, lossValue: 10000, submitted: true,
    });

    // Même personne, même rôle OWNER — seule l'identité (sub) compte ici.
    await db.actingAs({ tenantId, role: 'OWNER', sub: creatorOwner });
    const err = await db.queryExpectingError(`select decide_stocktake($1, true, null, 'Test')`, [stocktakeId]);
    expect(err.message).toMatch(/FORBIDDEN/);
  });

  it('INVALID_INPUT : un refus sans motif est rejeté', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const approver = await createUser(db);
    const stocktakeId = await createStocktake(db, tenantId, storeId, {
      status: 'PENDING_APPROVAL', createdBy: creator, lossValue: 10000, submitted: true,
    });

    await db.actingAs({ tenantId, role: 'OWNER', sub: approver });
    const err = await db.queryExpectingError(`select decide_stocktake($1, false, null, 'Test')`, [stocktakeId]);
    expect(err.message).toMatch(/INVALID_INPUT/);
  });

  it('un refus motivé, par une autre personne que le créateur, passe l\'inventaire à REJECTED sans toucher au stock', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const approver = await createUser(db);
    const productId = await createProduct(db, tenantId);
    await createInventoryRow(db, tenantId, productId, storeId, 10);
    const stocktakeId = await createStocktake(db, tenantId, storeId, {
      status: 'PENDING_APPROVAL', createdBy: creator, lossValue: 10000, submitted: true,
    });
    await createStocktakeLine(db, tenantId, storeId, stocktakeId, productId, { expectedQty: 10, countedQty: 3, unitCost: 1000 });

    await db.actingAs({ tenantId, role: 'ADMIN', sub: approver });
    const { rows } = await db.query<{ success: boolean }>(
      `select (decide_stocktake($1, false, 'Comptage suspect, à refaire', 'Test')->>'success')::boolean as success`, [stocktakeId]
    );
    expect(rows[0].success).toBe(true);

    await db.actingAsService();
    const { rows: st } = await db.query<{ status: string; decision_note: string }>(
      `select status, decision_note from stocktakes where id = $1`, [stocktakeId]
    );
    expect(st[0].status).toBe('REJECTED');
    expect(st[0].decision_note).toBe('Comptage suspect, à refaire');
    const { rows: inv } = await db.query<{ quantity: number }>(
      `select quantity from inventory where tenant_id = $1 and product_id = $2`, [tenantId, productId]
    );
    expect(Number(inv[0].quantity)).toBe(10); // inchangé — un refus n'ajuste jamais le stock
  });

  it('une approbation, par une autre personne que le créateur, applique l\'écart au stock et passe l\'inventaire à COMPLETED', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const approver = await createUser(db);
    const productId = await createProduct(db, tenantId);
    await createInventoryRow(db, tenantId, productId, storeId, 10);
    const stocktakeId = await createStocktake(db, tenantId, storeId, {
      status: 'PENDING_APPROVAL', createdBy: creator, lossValue: 7000, submitted: true,
    });
    // Compté 3, théorique 10 : écart de -7 doit s'appliquer au stock réel.
    await createStocktakeLine(db, tenantId, storeId, stocktakeId, productId, { expectedQty: 10, countedQty: 3, unitCost: 1000 });

    await db.actingAs({ tenantId, role: 'OWNER', sub: approver });
    const { rows } = await db.query<{ success: boolean }>(
      `select (decide_stocktake($1, true, null, 'Test')->>'success')::boolean as success`, [stocktakeId]
    );
    expect(rows[0].success).toBe(true);

    await db.actingAsService();
    const { rows: st } = await db.query<{ status: string }>(`select status from stocktakes where id = $1`, [stocktakeId]);
    expect(st[0].status).toBe('COMPLETED');
    const { rows: inv } = await db.query<{ quantity: number }>(
      `select quantity from inventory where tenant_id = $1 and product_id = $2`, [tenantId, productId]
    );
    expect(Number(inv[0].quantity)).toBe(3); // 10 + (3 − 10) = 3
  });
});

describe('cancel_stocktake', () => {
  it('NOT_FOUND pour un inventaire inexistant', async () => {
    const tenantId = await createTenant(db);
    const owner = await createUser(db);
    await db.actingAs({ tenantId, role: 'OWNER', sub: owner });
    const err = await db.queryExpectingError(`select cancel_stocktake('00000000-0000-0000-0000-000000000000', 'Test')`);
    expect(err.message).toMatch(/NOT_FOUND/);
  });

  it('FORBIDDEN pour un rôle non manager (CASHIER)', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const cashier = await createUser(db);
    const stocktakeId = await createStocktake(db, tenantId, storeId, { status: 'IN_PROGRESS', createdBy: creator });

    await db.actingAs({ tenantId, role: 'CASHIER', storeIds: [storeId], sub: cashier });
    const err = await db.queryExpectingError(`select cancel_stocktake($1, 'Test')`, [stocktakeId]);
    expect(err.message).toMatch(/FORBIDDEN/);
  });

  it('un MANAGER peut annuler un inventaire encore IN_PROGRESS', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const manager = await createUser(db);
    const stocktakeId = await createStocktake(db, tenantId, storeId, { status: 'IN_PROGRESS', createdBy: creator });

    await db.actingAs({ tenantId, role: 'MANAGER', storeIds: [storeId], sub: manager });
    const { rows } = await db.query<{ success: boolean }>(`select (cancel_stocktake($1, 'Test')->>'success')::boolean as success`, [stocktakeId]);
    expect(rows[0].success).toBe(true);
  });

  it('FORBIDDEN : un MANAGER (non Propriétaire/Administrateur) ne peut pas annuler un inventaire déjà SOUMIS', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const manager = await createUser(db);
    const stocktakeId = await createStocktake(db, tenantId, storeId, {
      status: 'PENDING_APPROVAL', createdBy: creator, lossValue: 10000, submitted: true,
    });

    await db.actingAs({ tenantId, role: 'MANAGER', storeIds: [storeId], sub: manager });
    const err = await db.queryExpectingError(`select cancel_stocktake($1, 'Test')`, [stocktakeId]);
    expect(err.message).toMatch(/FORBIDDEN/);
  });

  it('un Propriétaire peut annuler un inventaire déjà SOUMIS (PENDING_APPROVAL)', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const owner = await createUser(db);
    const stocktakeId = await createStocktake(db, tenantId, storeId, {
      status: 'PENDING_APPROVAL', createdBy: creator, lossValue: 10000, submitted: true,
    });

    await db.actingAs({ tenantId, role: 'OWNER', sub: owner });
    const { rows } = await db.query<{ success: boolean }>(`select (cancel_stocktake($1, 'Test')->>'success')::boolean as success`, [stocktakeId]);
    expect(rows[0].success).toBe(true);
  });

  it('INVALID_STATUS pour un inventaire déjà terminé (COMPLETED)', async () => {
    const tenantId = await createTenant(db);
    const storeId = await createStore(db, tenantId);
    const creator = await createUser(db);
    const owner = await createUser(db);
    const stocktakeId = await createStocktake(db, tenantId, storeId, { status: 'COMPLETED', createdBy: creator });

    await db.actingAs({ tenantId, role: 'OWNER', sub: owner });
    const err = await db.queryExpectingError(`select cancel_stocktake($1, 'Test')`, [stocktakeId]);
    expect(err.message).toMatch(/INVALID_STATUS/);
  });
});
