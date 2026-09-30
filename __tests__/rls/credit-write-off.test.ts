/**
 * write_off_credit() / approve_credit_write_off() / reject_credit_write_off()
 * — aucun test avant ce fichier (trouvé lors de l'audit du 2026-09-29),
 * alors qu'approve_credit_write_off() est exactement la fonction où une
 * vraie faille de privilège a été prouvée et corrigée (migration 048) :
 * un Propriétaire pouvait demander ET valider sa propre annulation de
 * crédit au-dessus du seuil, vidant de son sens la double validation.
 * Cette régression n'a jamais eu de test qui l'aurait détectée si
 * quelqu'un la réintroduisait.
 *
 * Même approche que stocktake-decision.test.ts : ces RPC vérifient
 * l'identité de l'appelant via auth.uid()/auth_role() (JWT), pas via un
 * paramètre — suite RLS (Postgres local), pas RPC (service-role).
 *
 * Nécessite `supabase start`. Lancé séparément via `npm run test:rls`.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { RlsTestClient } from './helpers/rls-client';
import {
  createTenant, createCustomer, createCredit, createUser, setWriteOffThreshold,
} from './helpers/fixtures';

let db: RlsTestClient;

beforeAll(async () => { db = await RlsTestClient.connect(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.begin(); });
afterEach(async () => { await db.rollback(); });

describe('write_off_credit', () => {
  it('NOT_FOUND pour un crédit inexistant', async () => {
    const tenantId = await createTenant(db);
    const manager = await createUser(db);
    await db.actingAs({ tenantId, role: 'MANAGER', sub: manager });
    const err = await db.queryExpectingError(
      `select write_off_credit('00000000-0000-0000-0000-000000000000', 'Motif', 'Test')`
    );
    expect(err.message).toMatch(/NOT_FOUND/);
  });

  it('FORBIDDEN pour un rôle non manager (CASHIER)', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId);
    const creditId = await createCredit(db, tenantId, customerId);
    const cashier = await createUser(db);

    await db.actingAs({ tenantId, role: 'CASHIER', sub: cashier });
    const err = await db.queryExpectingError(`select write_off_credit($1, 'Motif', 'Test')`, [creditId]);
    expect(err.message).toMatch(/FORBIDDEN/);
  });

  it('INVALID_STATUS pour un crédit déjà soldé (PAID)', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId);
    const creditId = await createCredit(db, tenantId, customerId, { status: 'PAID', remainingAmount: 0 });
    const manager = await createUser(db);

    await db.actingAs({ tenantId, role: 'MANAGER', sub: manager });
    const err = await db.queryExpectingError(`select write_off_credit($1, 'Motif', 'Test')`, [creditId]);
    expect(err.message).toMatch(/INVALID_STATUS/);
  });

  it('INVALID_STATUS si une demande est déjà en attente pour ce crédit', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId);
    const creditId = await createCredit(db, tenantId, customerId, { writeOffStatus: 'PENDING' });
    const manager = await createUser(db);

    await db.actingAs({ tenantId, role: 'MANAGER', sub: manager });
    const err = await db.queryExpectingError(`select write_off_credit($1, 'Motif', 'Test')`, [creditId]);
    expect(err.message).toMatch(/INVALID_STATUS/);
  });

  it('sous le seuil : annule immédiatement, solde à 0, crédit du client libéré', async () => {
    const tenantId = await createTenant(db);
    await setWriteOffThreshold(db, tenantId, 100000);
    const customerId = await createCustomer(db, tenantId, { creditUsed: 20000 });
    const creditId = await createCredit(db, tenantId, customerId, { totalAmount: 20000, remainingAmount: 20000 });
    const manager = await createUser(db);

    await db.actingAs({ tenantId, role: 'MANAGER', sub: manager });
    const { rows } = await db.query<{ status: string }>(
      `select decide->>'status' as status from write_off_credit($1, 'Client injoignable', 'Test') as decide`, [creditId]
    );
    expect(rows[0].status).toBe('WRITTEN_OFF');

    await db.actingAsService();
    const { rows: credit } = await db.query<{ status: string; remaining_amount: number }>(
      `select status, remaining_amount from credits where id = $1`, [creditId]
    );
    expect(credit[0].status).toBe('WRITTEN_OFF');
    expect(Number(credit[0].remaining_amount)).toBe(0);
    const { rows: customer } = await db.query<{ credit_used: number }>(`select credit_used from customers where id = $1`, [customerId]);
    expect(Number(customer[0].credit_used)).toBe(0);
  });

  it('au-dessus du seuil : crée une demande en attente, ne touche ni le statut du crédit ni le crédit utilisé du client', async () => {
    const tenantId = await createTenant(db);
    await setWriteOffThreshold(db, tenantId, 5000);
    const customerId = await createCustomer(db, tenantId, { creditUsed: 20000 });
    const creditId = await createCredit(db, tenantId, customerId, { totalAmount: 20000, remainingAmount: 20000 });
    const manager = await createUser(db);

    await db.actingAs({ tenantId, role: 'MANAGER', sub: manager });
    const { rows } = await db.query<{ status: string }>(
      `select decide->>'status' as status from write_off_credit($1, 'Client injoignable', 'Test') as decide`, [creditId]
    );
    expect(rows[0].status).toBe('PENDING_APPROVAL');

    await db.actingAsService();
    const { rows: credit } = await db.query<{ status: string; write_off_status: string; remaining_amount: number }>(
      `select status, write_off_status, remaining_amount from credits where id = $1`, [creditId]
    );
    expect(credit[0].status).toBe('PENDING'); // statut du crédit inchangé, seul write_off_status bouge
    expect(credit[0].write_off_status).toBe('PENDING');
    expect(Number(credit[0].remaining_amount)).toBe(20000);
    const { rows: customer } = await db.query<{ credit_used: number }>(`select credit_used from customers where id = $1`, [customerId]);
    expect(Number(customer[0].credit_used)).toBe(20000); // pas encore libéré, la demande n'est pas encore validée
  });
});

describe('approve_credit_write_off — régression migration 048', () => {
  it('NOT_FOUND pour un crédit inexistant', async () => {
    const tenantId = await createTenant(db);
    const owner = await createUser(db);
    await db.actingAs({ tenantId, role: 'OWNER', sub: owner });
    const err = await db.queryExpectingError(
      `select approve_credit_write_off('00000000-0000-0000-0000-000000000000', 'Test')`
    );
    expect(err.message).toMatch(/NOT_FOUND/);
  });

  it('FORBIDDEN pour un rôle non Propriétaire/Administrateur (MANAGER)', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId);
    const requester = await createUser(db);
    const creditId = await createCredit(db, tenantId, customerId, { writeOffStatus: 'PENDING', writeOffRequestedBy: requester });
    const manager = await createUser(db);

    await db.actingAs({ tenantId, role: 'MANAGER', sub: manager });
    const err = await db.queryExpectingError(`select approve_credit_write_off($1, 'Test')`, [creditId]);
    expect(err.message).toMatch(/FORBIDDEN/);
  });

  it('INVALID_STATUS si aucune demande n\'est en attente pour ce crédit', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId);
    const creditId = await createCredit(db, tenantId, customerId); // write_off_status = NONE par défaut
    const owner = await createUser(db);

    await db.actingAs({ tenantId, role: 'OWNER', sub: owner });
    const err = await db.queryExpectingError(`select approve_credit_write_off($1, 'Test')`, [creditId]);
    expect(err.message).toMatch(/INVALID_STATUS/);
  });

  it('FORBIDDEN : le demandeur ne peut pas valider sa propre demande, même Propriétaire (régression migration 048)', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId, { creditUsed: 20000 });
    const requesterOwner = await createUser(db);
    const creditId = await createCredit(db, tenantId, customerId, {
      totalAmount: 20000, remainingAmount: 20000, writeOffStatus: 'PENDING', writeOffRequestedBy: requesterOwner,
    });

    // Même personne, même rôle OWNER que le demandeur — seule l'identité compte.
    await db.actingAs({ tenantId, role: 'OWNER', sub: requesterOwner });
    const err = await db.queryExpectingError(`select approve_credit_write_off($1, 'Test')`, [creditId]);
    expect(err.message).toMatch(/FORBIDDEN/);

    // Le crédit et le solde client ne doivent PAS avoir bougé.
    await db.actingAsService();
    const { rows: credit } = await db.query<{ status: string }>(`select status from credits where id = $1`, [creditId]);
    expect(credit[0].status).toBe('PENDING');
    const { rows: customer } = await db.query<{ credit_used: number }>(`select credit_used from customers where id = $1`, [customerId]);
    expect(Number(customer[0].credit_used)).toBe(20000);
  });

  it('une approbation par une AUTRE personne habilitée passe le crédit à WRITTEN_OFF et libère le crédit du client', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId, { creditUsed: 20000 });
    const requester = await createUser(db);
    const approver = await createUser(db);
    const creditId = await createCredit(db, tenantId, customerId, {
      totalAmount: 20000, remainingAmount: 20000, writeOffStatus: 'PENDING', writeOffRequestedBy: requester,
    });

    await db.actingAs({ tenantId, role: 'ADMIN', sub: approver });
    const { rows } = await db.query<{ success: boolean }>(
      `select (approve_credit_write_off($1, 'Test')->>'success')::boolean as success`, [creditId]
    );
    expect(rows[0].success).toBe(true);

    await db.actingAsService();
    const { rows: credit } = await db.query<{ status: string; write_off_status: string; remaining_amount: number }>(
      `select status, write_off_status, remaining_amount from credits where id = $1`, [creditId]
    );
    expect(credit[0].status).toBe('WRITTEN_OFF');
    expect(credit[0].write_off_status).toBe('NONE');
    expect(Number(credit[0].remaining_amount)).toBe(0);
    const { rows: customer } = await db.query<{ credit_used: number }>(`select credit_used from customers where id = $1`, [customerId]);
    expect(Number(customer[0].credit_used)).toBe(0);
    const { rows: log } = await db.query<{ action: string }>(
      `select action from audit_log where entity_id = $1 and action = 'CREDIT_WRITE_OFF_APPROVED'`, [creditId]
    );
    expect(log).toHaveLength(1);
  });
});

describe('reject_credit_write_off', () => {
  it('NOT_FOUND pour un crédit inexistant', async () => {
    const tenantId = await createTenant(db);
    const owner = await createUser(db);
    await db.actingAs({ tenantId, role: 'OWNER', sub: owner });
    const err = await db.queryExpectingError(
      `select reject_credit_write_off('00000000-0000-0000-0000-000000000000', 'Test', 'Motif')`
    );
    expect(err.message).toMatch(/NOT_FOUND/);
  });

  it('FORBIDDEN pour un rôle non Propriétaire/Administrateur (MANAGER)', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId);
    const requester = await createUser(db);
    const creditId = await createCredit(db, tenantId, customerId, { writeOffStatus: 'PENDING', writeOffRequestedBy: requester });
    const manager = await createUser(db);

    await db.actingAs({ tenantId, role: 'MANAGER', sub: manager });
    const err = await db.queryExpectingError(`select reject_credit_write_off($1, 'Test', 'Motif')`, [creditId]);
    expect(err.message).toMatch(/FORBIDDEN/);
  });

  it('INVALID_STATUS si aucune demande n\'est en attente', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId);
    const creditId = await createCredit(db, tenantId, customerId);
    const owner = await createUser(db);

    await db.actingAs({ tenantId, role: 'OWNER', sub: owner });
    const err = await db.queryExpectingError(`select reject_credit_write_off($1, 'Test', 'Motif')`, [creditId]);
    expect(err.message).toMatch(/INVALID_STATUS/);
  });

  it('un refus ne modifie ni le statut du crédit ni le crédit utilisé du client (contrairement à une approbation)', async () => {
    const tenantId = await createTenant(db);
    const customerId = await createCustomer(db, tenantId, { creditUsed: 20000 });
    const requester = await createUser(db);
    const approver = await createUser(db);
    const creditId = await createCredit(db, tenantId, customerId, {
      totalAmount: 20000, remainingAmount: 20000, writeOffStatus: 'PENDING', writeOffRequestedBy: requester,
    });

    // Contrairement à approve_credit_write_off, le refus n'a pas de blocage
    // d'auto-refus documenté — testé ici avec un approbateur distinct par
    // cohérence avec le flux réel (le siège qui traite la demande).
    await db.actingAs({ tenantId, role: 'OWNER', sub: approver });
    const { rows } = await db.query<{ success: boolean }>(
      `select (reject_credit_write_off($1, 'Test', 'Justificatif manquant')->>'success')::boolean as success`, [creditId]
    );
    expect(rows[0].success).toBe(true);

    await db.actingAsService();
    const { rows: credit } = await db.query<{ status: string; write_off_status: string; write_off_rejected_reason: string; remaining_amount: number }>(
      `select status, write_off_status, write_off_rejected_reason, remaining_amount from credits where id = $1`, [creditId]
    );
    expect(credit[0].status).toBe('PENDING'); // statut du crédit inchangé
    expect(credit[0].write_off_status).toBe('REJECTED');
    expect(credit[0].write_off_rejected_reason).toBe('Justificatif manquant');
    expect(Number(credit[0].remaining_amount)).toBe(20000);
    const { rows: customer } = await db.query<{ credit_used: number }>(`select credit_used from customers where id = $1`, [customerId]);
    expect(Number(customer[0].credit_used)).toBe(20000); // inchangé
  });
});
