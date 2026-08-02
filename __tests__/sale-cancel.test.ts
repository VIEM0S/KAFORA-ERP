import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';

/**
 * Annulation d'une vente.
 *
 * Une annulation doit défaire TOUT ce que la vente a fait, pas seulement le
 * stock. Elle laissait auparavant le crédit client intact : le client restait
 * débiteur d'une vente qui n'existait plus, et son plafond restait consommé.
 * Après quelques annulations, un bon client se retrouvait bloqué en caisse
 * sans que personne ne comprenne pourquoi.
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

const { POST: cancel } = await import('@/app/api/sales/cancel/route');

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/sales/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Vente à crédit : 100 000 au total, 20 000 d'acompte, 80 000 restant dû.
 * Le client a un plafond de 200 000, dont 80 000 déjà consommés par cette vente.
 */
function seedCreditSale(opts?: { soldeRestant?: number; creditUsed?: number }) {
  const solde = opts?.soldeRestant ?? 80_000;
  db.store.clear();

  db.seed(`tenants/${TENANT_ID}/sales/${SALE_ID}`, {
    tenantId: TENANT_ID, storeId: STORE_ID, status: 'COMPLETED',
    total: 100_000, paymentMethod: 'CREDIT', acompte: 20_000,
    customerId: CUSTOMER_ID,
  });
  db.seed(`tenants/${TENANT_ID}/sales/${SALE_ID}/sale_items/item-1`, {
    productId: PRODUCT_ID, productName: 'Ciment', quantity: 10,
  });
  db.seed(`tenants/${TENANT_ID}/inventory/inv-1`, {
    tenantId: TENANT_ID, productId: PRODUCT_ID, storeId: STORE_ID, quantity: 5,
  });
  db.seed(`tenants/${TENANT_ID}/credits/${CREDIT_ID}`, {
    tenantId: TENANT_ID, saleId: SALE_ID, customerId: CUSTOMER_ID,
    montantTotal: 100_000, acompte: 20_000, solde, status: 'PENDING',
  });
  db.seed(`tenants/${TENANT_ID}/customers/${CUSTOMER_ID}`, {
    firstName: 'Amadou', creditLimit: 200_000, creditUsed: opts?.creditUsed ?? solde,
  });
}

const sale = () => db.read(`tenants/${TENANT_ID}/sales/${SALE_ID}`);
const credit = () => db.read(`tenants/${TENANT_ID}/credits/${CREDIT_ID}`);
const customer = () => db.read(`tenants/${TENANT_ID}/customers/${CUSTOMER_ID}`);
const stock = () => db.read(`tenants/${TENANT_ID}/inventory/inv-1`)?.quantity;

describe("annulation d'une vente à crédit", () => {
  beforeEach(() => { db.store.clear(); });

  it('restaure le stock', async () => {
    seedCreditSale();
    const res = await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: 'Erreur de saisie' }));
    expect(res.status).toBe(200);
    expect(stock()).toBe(15); // 5 + 10
  });

  it('marque la vente comme annulée avec son motif', async () => {
    seedCreditSale();
    await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: 'Erreur de saisie' }));
    expect(sale()?.status).toBe('CANCELLED');
    expect(sale()?.motifAnnulation).toBe('Erreur de saisie');
  });

  it('solde le crédit : le client ne doit plus rien pour cette vente', async () => {
    seedCreditSale();
    await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: 'Erreur' }));
    expect(credit()?.solde).toBe(0);
    expect(credit()?.status).toBe('CANCELLED');
  });

  it('libère le plafond de crédit du client', async () => {
    // Sans cela, le plafond reste consommé indéfiniment et le client finit
    // par être refusé en caisse pour des achats qu'il n'a jamais faits.
    seedCreditSale({ soldeRestant: 80_000, creditUsed: 80_000 });
    await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: 'Erreur' }));
    expect(customer()?.creditUsed).toBe(0);
  });

  it('ne libère que le solde RESTANT, pas le montant initial', async () => {
    // Le client a déjà remboursé 30 000 : son encours n'est plus que de
    // 50 000. Libérer 80 000 le créditerait de 30 000 qu'il n'a jamais eus.
    seedCreditSale({ soldeRestant: 50_000, creditUsed: 50_000 });
    await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: 'Erreur' }));
    expect(customer()?.creditUsed).toBe(0);
  });

  it("n'entame pas les autres dettes du client", async () => {
    // Le client doit 120 000 au total, dont 80 000 pour cette vente.
    // Annuler celle-ci doit laisser les 40 000 restants intacts.
    seedCreditSale({ soldeRestant: 80_000, creditUsed: 120_000 });
    await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: 'Erreur' }));
    expect(customer()?.creditUsed).toBe(40_000);
  });

  it('refuse une seconde annulation — le stock ne revient pas deux fois', async () => {
    seedCreditSale();
    await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: 'Erreur' }));
    const second = await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: 'Encore' }));
    expect(second.status).not.toBe(200);
    expect(stock()).toBe(15); // et non 25
  });

  it('exige un motif', async () => {
    seedCreditSale();
    const res = await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: '   ' }));
    expect(res.status).toBe(400);
    expect(sale()?.status).toBe('COMPLETED');
  });
});

describe('annulation d\'une vente comptant (sans crédit)', () => {
  beforeEach(() => {
    db.store.clear();
    db.seed(`tenants/${TENANT_ID}/sales/${SALE_ID}`, {
      tenantId: TENANT_ID, storeId: STORE_ID, status: 'COMPLETED',
      total: 30_000, paymentMethod: 'CASH',
    });
    db.seed(`tenants/${TENANT_ID}/sales/${SALE_ID}/sale_items/item-1`, {
      productId: PRODUCT_ID, productName: 'Ciment', quantity: 3,
    });
    db.seed(`tenants/${TENANT_ID}/inventory/inv-1`, {
      tenantId: TENANT_ID, productId: PRODUCT_ID, storeId: STORE_ID, quantity: 7,
    });
  });

  it('restaure le stock sans chercher de crédit inexistant', async () => {
    const res = await cancel(post({ tenantId: TENANT_ID, saleId: SALE_ID, motif: 'Client parti' }));
    expect(res.status).toBe(200);
    expect(stock()).toBe(10);
    expect(sale()?.status).toBe('CANCELLED');
  });
});
