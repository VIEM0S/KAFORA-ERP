import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';

/**
 * Retour de marchandise.
 *
 * Un retour doit d'abord effacer ce que le client DOIT, avant de lui rendre
 * de l'argent. Rembourser en espèces un client encore débiteur revient à le
 * payer pour une marchandise qu'il n'a jamais réglée — le commerce perd deux
 * fois : la marchandise revient en stock, et l'argent sort du tiroir.
 */

const TENANT_ID = 'tenant-1';
const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';
const CUSTOMER_ID = 'cust-1';
const SALE_ID = 'sale-1';
const CREDIT_ID = 'credit-1';

const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifySessionCookie: vi.fn(async () => ({
      uid: 'user-1', tenantId: TENANT_ID, role: 'MANAGER', storeIds: null,
    })),
  },
  get adminDb() { return db; },
}));

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'session' }) }),
}));

const { POST: createReturn } = await import('@/app/api/sales/returns/create/route');

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/sales/returns/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Vente de 10 sacs à 10 000 l'unité = 100 000, réglée à crédit.
 * `soldeRestant` = ce que le client doit encore.
 */
function seedSale(opts?: { soldeRestant?: number | null; stock?: number }) {
  db.store.clear();

  db.seed(`tenants/${TENANT_ID}/sales/${SALE_ID}`, {
    tenantId: TENANT_ID, storeId: STORE_ID, status: 'COMPLETED',
    total: 100_000, paymentMethod: 'CREDIT', customerId: CUSTOMER_ID,
    reference: 'FA-001',
  });
  db.seed(`tenants/${TENANT_ID}/sales/${SALE_ID}/sale_items/item-1`, {
    productId: PRODUCT_ID, productName: 'Ciment', quantity: 10,
    unitPrice: 10_000, discount: 0, tax: 0, returnedQuantity: 0,
  });
  db.seed(`tenants/${TENANT_ID}/inventory/inv-1`, {
    tenantId: TENANT_ID, productId: PRODUCT_ID, storeId: STORE_ID,
    quantity: opts?.stock ?? 0,
  });

  if (opts?.soldeRestant !== null) {
    const solde = opts?.soldeRestant ?? 100_000;
    db.seed(`tenants/${TENANT_ID}/credits/${CREDIT_ID}`, {
      tenantId: TENANT_ID, saleId: SALE_ID, customerId: CUSTOMER_ID,
      montantTotal: 100_000, solde, status: 'PENDING',
    });
    db.seed(`tenants/${TENANT_ID}/customers/${CUSTOMER_ID}`, {
      firstName: 'Amadou', creditLimit: 500_000, creditUsed: solde,
    });
  }
}

const credit = () => db.read(`tenants/${TENANT_ID}/credits/${CREDIT_ID}`);
const customer = () => db.read(`tenants/${TENANT_ID}/customers/${CUSTOMER_ID}`);
const stock = () => db.read(`tenants/${TENANT_ID}/inventory/inv-1`)?.quantity;

function savedReturn(): Record<string, unknown> | undefined {
  for (const [path, data] of db.store.entries()) {
    if (path.includes('/sale_returns/')) return data;
  }
  return undefined;
}

/**
 * Retourne `qty` sacs.
 *
 * `restock` distingue un article revendable d'un article défectueux : seul
 * le premier revient en stock. Un retour pour casse rembourse le client
 * SANS remettre la marchandise en vente — c'est le comportement attendu.
 */
function returnBody(qty: number, refundMethod = 'CASH', restock = true) {
  return {
    tenantId: TENANT_ID, saleId: SALE_ID,
    items: [{ productId: PRODUCT_ID, quantity: qty, restock }],
    reason: 'Erreur de commande',
    refundMethod,
  };
}

describe('retour sur une vente à crédit', () => {
  beforeEach(() => { db.store.clear(); });

  it('remet la marchandise en stock quand elle est revendable', async () => {
    seedSale({ stock: 0 });
    const res = await createReturn(post(returnBody(4)));
    expect(res.status).toBe(200);
    expect(stock()).toBe(4);
  });

  it('ne remet PAS en stock un article défectueux, mais rembourse quand même', async () => {
    // Un sac déchiré revient au commerçant sans revenir en rayon : le client
    // est remboursé, la marchandise est perdue. Remettre en stock fausserait
    // l'inventaire avec des articles invendables.
    seedSale({ soldeRestant: 0, stock: 0 });
    const res = await createReturn(post(returnBody(4, 'CASH', false)));
    expect(res.status).toBe(200);
    expect(stock()).toBe(0);
    expect(savedReturn()?.cashRefund).toBe(40_000);
  });

  it('impute le remboursement sur la dette avant de sortir des espèces', async () => {
    // Le client doit encore 100 000 et rend pour 40 000 de marchandise :
    // rien ne doit sortir du tiroir, sa dette passe simplement à 60 000.
    seedSale({ soldeRestant: 100_000 });
    await createReturn(post(returnBody(4)));

    expect(credit()?.solde).toBe(60_000);
    expect(savedReturn()?.creditReduction).toBe(40_000);
    expect(savedReturn()?.cashRefund).toBe(0);
  });

  it('libère le plafond de crédit à hauteur de ce qui est effacé', async () => {
    seedSale({ soldeRestant: 100_000 });
    await createReturn(post(returnBody(4)));
    expect(customer()?.creditUsed).toBe(60_000);
  });

  it('ne rend en espèces que ce qui dépasse la dette restante', async () => {
    // Le client ne doit plus que 15 000 mais rend pour 40 000 : on efface
    // les 15 000, et on lui rend réellement 25 000.
    seedSale({ soldeRestant: 15_000 });
    await createReturn(post(returnBody(4)));

    expect(credit()?.solde).toBe(0);
    expect(credit()?.status).toBe('PAID');
    expect(savedReturn()?.creditReduction).toBe(15_000);
    expect(savedReturn()?.cashRefund).toBe(25_000);
  });

  it('rend tout en espèces quand la dette est déjà soldée', async () => {
    seedSale({ soldeRestant: 0 });
    await createReturn(post(returnBody(4)));
    expect(savedReturn()?.creditReduction).toBe(0);
    expect(savedReturn()?.cashRefund).toBe(40_000);
  });
});

describe('retour sur une vente comptant', () => {
  beforeEach(() => { db.store.clear(); });

  it('rend la totalité en espèces, sans chercher de dette', async () => {
    seedSale({ soldeRestant: null, stock: 2 });
    const res = await createReturn(post(returnBody(3)));
    expect(res.status).toBe(200);
    expect(savedReturn()?.cashRefund).toBe(30_000);
    expect(stock()).toBe(5);
  });
});

describe('garde-fous', () => {
  beforeEach(() => { db.store.clear(); });

  it('refuse de retourner plus que ce qui a été vendu', async () => {
    seedSale();
    const res = await createReturn(post(returnBody(12)));
    expect(res.status).toBe(400);
    expect(stock()).toBe(0);
  });

  it('refuse un second retour dépassant le total vendu', async () => {
    seedSale({ stock: 0 });
    await createReturn(post(returnBody(7)));
    const second = await createReturn(post(returnBody(5))); // 7 + 5 > 10
    expect(second.status).toBe(400);
  });

  it("refuse l'avoir en magasin, qui n'est pas implémenté", async () => {
    // L'option était proposée et enregistrée sans qu'aucun avoir ne soit
    // créé : le client repartait avec une promesse sans trace.
    seedSale();
    const res = await createReturn(post(returnBody(2, 'STORE_CREDIT')));
    expect(res.status).toBe(400);
  });

  it('exige un motif', async () => {
    seedSale();
    const res = await createReturn(post({
      tenantId: TENANT_ID, saleId: SALE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
      reason: '  ', refundMethod: 'CASH',
    }));
    expect(res.status).toBe(400);
  });
});
