import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';

/**
 * Le franc CFA n'a pas de subdivision : aucun montant enregistré ne doit
 * comporter de décimales.
 *
 * Avant correction, le total était arrondi au centime (`Math.round(x*100)/100`),
 * convention euro/dollar. Une vente à 12 345,67 était stockée telle quelle,
 * affichée « 12 346 FCFA » (l'affichage arrondit), et encaissée 12 346. L'écart
 * n'apparaissait nulle part mais se propageait dans les soldes de crédit
 * client, la caisse et les agrégats mensuels.
 */

const TENANT_ID = 'tenant-1';
const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';
const USER_ID = 'user-1';

const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifySessionCookie: vi.fn(async () => ({
      uid: USER_ID, tenantId: TENANT_ID, role: 'CASHIER', storeIds: null,
    })),
  },
  get adminDb() { return db; },
}));

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'fake-session' }) }),
}));

vi.mock('@/lib/api/subscription-guard', () => ({
  checkSubscriptionAllows: async () => null,
}));

const { POST } = await import('@/app/api/pos/checkout/route');

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/pos/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Prix et taxe choisis pour produire un résultat non entier sans arrondi. */
function seed(sellingPrice: number, taxRate: number) {
  db.store.clear();
  db.seed(`tenants/${TENANT_ID}/products/${PRODUCT_ID}`, {
    name: 'Article test', sku: 'TEST-1', sellingPrice, purchasePrice: 100,
    taxRate, trackInventory: false,
  });
}

function salePayload(quantity: number, discountPercent = 0) {
  return {
    tenantId: TENANT_ID, storeId: STORE_ID,
    items: [{ productId: PRODUCT_ID, quantity }],
    paymentMethod: 'CASH',
    amountReceived: 10_000_000,
    discountPercent,
    userName: 'Testeur',
  };
}

/** Retrouve la vente écrite dans le magasin factice. */
function savedSale(): Record<string, unknown> | undefined {
  for (const [path, data] of db.store.entries()) {
    if (path.includes('/sales/') && path.split('/').length === 4) return data;
  }
  return undefined;
}

describe('arrondis monétaires (franc CFA, sans décimales)', () => {
  beforeEach(() => { db.store.clear(); });

  it("n'enregistre jamais un total à décimales, même avec une taxe qui en produit", async () => {
    // 1 333 × 3 avec 18 % de taxe → 4 718,82 sans arrondi
    seed(1333, 18);
    const res = await POST(request(salePayload(3)));
    expect(res.status).toBe(200);

    const sale = savedSale();
    expect(sale).toBeDefined();
    expect(Number.isInteger(sale!.total as number)).toBe(true);
    expect(Number.isInteger(sale!.subtotal as number)).toBe(true);
  });

  it("n'enregistre jamais de décimales avec une remise qui en produit", async () => {
    // 999 × 7 avec 33 % de remise → 4 685,31 sans arrondi
    seed(999, 0);
    const res = await POST(request(salePayload(7, 33)));
    expect(res.status).toBe(200);

    const sale = savedSale();
    expect(Number.isInteger(sale!.total as number)).toBe(true);
  });

  it('conserve un total cohérent : sous-total + taxe − remise', async () => {
    // Une facture dont les lignes ne s'additionnent pas au total réclamé est
    // indéfendable devant un client — et devant un contrôle.
    seed(1333, 18);
    const res = await POST(request(salePayload(3)));
    expect(res.status).toBe(200);

    const sale = savedSale()!;
    const subtotal = sale.subtotal as number;
    const tax = (sale.taxTotal ?? sale.tax ?? 0) as number;
    const discount = (sale.discountAmount ?? 0) as number;
    expect(sale.total).toBe(subtotal + tax - discount);
  });

  it('reste exact sur un cas simple sans taxe ni remise', async () => {
    seed(1500, 0);
    const res = await POST(request(salePayload(4)));
    expect(res.status).toBe(200);
    expect(savedSale()!.total).toBe(6000);
  });
});
