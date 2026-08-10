import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';

const { dbHolder, authMock } = vi.hoisted(() => ({
  dbHolder: { current: null as FakeFirestore | null },
  authMock: { verifySessionCookie: vi.fn() },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: authMock,
  get adminDb() { return dbHolder.current!; },
}));

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (_name: string) => ({ value: 'fake-session-cookie' }) }),
}));

vi.mock('@/lib/api/subscription-guard', () => ({
  checkSubscriptionAllows: async () => null,
}));

const { POST } = await import('@/app/api/pos/checkout/route');

const TENANT_ID = 'tenant1';
const STORE_ID = 'store1';
const USER_ID = 'user1';
const PRODUCT_ID = 'prod1';
const PRODUCT_ID_2 = 'prod2';

function seedProduct(db: FakeFirestore, overrides?: Record<string, unknown>) {
  db.seed(`tenants/${TENANT_ID}/products/${PRODUCT_ID}`, {
    name: 'Clous 4cm', sku: 'CLOU-4', sellingPrice: 1000, purchasePrice: 700,
    taxRate: 0, trackInventory: true,
    ...overrides,
  });
}

function seedInventory(db: FakeFirestore, quantity: number) {
  db.seed(`tenants/${TENANT_ID}/inventory/inv1`, {
    productId: PRODUCT_ID, storeId: STORE_ID, quantity,
  });
}

function makeRequest(body: Record<string, unknown>, offlineSyncId?: string) {
  return new NextRequest('http://localhost/api/pos/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(offlineSyncId ? { 'X-Offline-Sync-Id': offlineSyncId } : {}),
    },
    body: JSON.stringify(body),
  });
}

function savedSale(db: FakeFirestore): Record<string, unknown> | undefined {
  for (const [path, data] of db.store.entries()) {
    if (path.includes('/sales/') && path.split('/').length === 4) return data;
  }
  return undefined;
}

describe('POST /api/pos/checkout — rupture de stock', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: USER_ID, storeIds: null });
  });

  it('refuse la vente si le stock est insuffisant (vente en ligne normale) et ne décrémente rien', async () => {
    const db = dbHolder.current!;
    seedProduct(db);
    seedInventory(db, 2); // seulement 2 en stock

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 5 }],
      paymentMethod: 'CASH', amountReceived: 5000,
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/Stock insuffisant/);

    // Rollback : le stock ne doit pas avoir bougé, aucune vente créée.
    expect(db.read(`tenants/${TENANT_ID}/inventory/inv1`)?.quantity).toBe(2);
    expect(savedSale(db)).toBeUndefined();
  });

  it('en synchronisation offline, laisse passer le stock négatif (vente déjà eu lieu physiquement) et crée une alerte', async () => {
    const db = dbHolder.current!;
    seedProduct(db);
    seedInventory(db, 2);

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 5 }],
      paymentMethod: 'CASH', amountReceived: 5000,
    }, 'offline-attempt-1'));

    expect(res.status).toBe(200);
    // Le stock passe en négatif plutôt que d'être refusé après coup.
    expect(db.read(`tenants/${TENANT_ID}/inventory/inv1`)?.quantity).toBe(-3);

    const sale = savedSale(db)!;
    expect(sale.stockConflict).toBe(true);

    const alerts = Array.from(db.store.entries()).filter(([p]) => p.includes('/alerts/'));
    expect(alerts.length).toBe(1);
    expect((alerts[0][1] as { type: string }).type).toBe('OFFLINE_SYNC_CONFLICT');
  });

  it('accepte la vente quand le stock disponible correspond exactement à la quantité demandée', async () => {
    const db = dbHolder.current!;
    seedProduct(db);
    seedInventory(db, 5);

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 5 }],
      paymentMethod: 'CASH', amountReceived: 5000,
    }));

    expect(res.status).toBe(200);
    expect(db.read(`tenants/${TENANT_ID}/inventory/inv1`)?.quantity).toBe(0);
  });

  it('ignore le contrôle de stock pour un produit qui ne suit pas l\'inventaire (trackInventory: false)', async () => {
    const db = dbHolder.current!;
    seedProduct(db, { trackInventory: false });
    // Pas de doc inventory du tout : ne doit jamais être consulté ni bloquer.

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 1000 }],
      paymentMethod: 'CASH', amountReceived: 1_000_000,
    }));

    expect(res.status).toBe(200);
  });
});

describe('POST /api/pos/checkout — paiement en espèces', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: USER_ID, storeIds: null });
  });

  it('refuse un paiement CASH dont le montant reçu est inférieur au total (paiement partiel non couvert)', async () => {
    const db = dbHolder.current!;
    seedProduct(db, { trackInventory: false });

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 1 }], // total = 1000
      paymentMethod: 'CASH', amountReceived: 500,
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Montant reçu insuffisant/);
    expect(savedSale(db)).toBeUndefined();
  });

  it('calcule correctement la monnaie à rendre sur un paiement CASH supérieur au total', async () => {
    const db = dbHolder.current!;
    seedProduct(db, { trackInventory: false });

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 1 }], // total = 1000
      paymentMethod: 'CASH', amountReceived: 1500,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.change).toBe(500);
  });
});

describe('POST /api/pos/checkout — remises et validations de base', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: USER_ID, storeIds: null });
  });

  it('applique une remise ligne par ligne (item.discount) distincte de la remise panier', async () => {
    const db = dbHolder.current!;
    seedProduct(db, { trackInventory: false, sellingPrice: 1000 });

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 2, discount: 10 }], // 2x1000 - 10% = 1800
      paymentMethod: 'CASH', amountReceived: 2000,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1800);
  });

  it('cumule remise ligne et remise panier', async () => {
    const db = dbHolder.current!;
    seedProduct(db, { trackInventory: false, sellingPrice: 1000 });

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 2, discount: 10 }], // sous-total ligne = 1800
      discountPercent: 10, // -10% supplémentaires sur le sous-total => 1620
      paymentMethod: 'CASH', amountReceived: 2000,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1620);
  });

  it('rejette un panier vide', async () => {
    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [],
      paymentMethod: 'CASH', amountReceived: 1000,
    }));
    expect(res.status).toBe(400);
  });

  it('rejette un produit introuvable', async () => {
    const db = dbHolder.current!;
    seedProduct(db, { trackInventory: false });

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: 'inexistant', quantity: 1 }],
      paymentMethod: 'CASH', amountReceived: 1000,
    }));
    expect(res.status).toBe(404);
  });

  it('rejette un mode de paiement invalide', async () => {
    const db = dbHolder.current!;
    seedProduct(db, { trackInventory: false });

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
      paymentMethod: 'BITCOIN', amountReceived: 1000,
    }));
    expect(res.status).toBe(400);
  });

  it('refuse l\'accès si le magasin demandé ne fait pas partie des magasins assignés au caissier', async () => {
    authMock.verifySessionCookie.mockResolvedValue({
      tenantId: TENANT_ID, uid: USER_ID, storeIds: ['un-autre-store'],
    });
    const db = dbHolder.current!;
    seedProduct(db, { trackInventory: false });

    const res = await POST(makeRequest({
      tenantId: TENANT_ID, storeId: STORE_ID,
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
      paymentMethod: 'CASH', amountReceived: 1000,
    }));
    expect(res.status).toBe(403);
  });
});
