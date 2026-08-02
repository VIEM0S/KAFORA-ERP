import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';

/**
 * Réception d'un bon de commande fournisseur.
 *
 * Deux enjeux :
 *   • le stock du magasin de destination doit augmenter exactement du reçu ;
 *   • le prix d'achat doit être recalculé en COÛT MOYEN PONDÉRÉ.
 *
 * Le code écrasait auparavant le prix par le dernier coût reçu : 100 sacs à
 * 5 000 plus 10 à 8 000 valorisaient les 110 à 8 000, surévaluant le stock de
 * 300 000 FCFA. Le coût moyen pondéré est l'une des méthodes retenues en
 * comptabilité OHADA ; le « dernier coût » n'en est pas une.
 */

const TENANT_ID = 'tenant-1';
const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';
const PO_ID = 'po-1';
const SUPPLIER_ID = 'sup-1';

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

const { POST: receive } = await import('@/app/api/purchase-orders/receive/route');

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/purchase-orders/receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Bon de commande de `ordered` unités à `unitCost`, sur un magasin qui
 * possède déjà `stockQty` unités valorisées à `currentCost`.
 */
function seed(opts: {
  stockQty: number;
  currentCost: number | null;
  unitCost: number;
  ordered?: number;
}) {
  db.store.clear();
  db.seed(`tenants/${TENANT_ID}/suppliers/${SUPPLIER_ID}`, { name: 'Fournisseur A' });
  db.seed(`tenants/${TENANT_ID}/products/${PRODUCT_ID}`, {
    name: 'Ciment', sku: 'CIM-1', sellingPrice: 10_000,
    purchasePrice: opts.currentCost,
  });
  db.seed(`tenants/${TENANT_ID}/purchase_orders/${PO_ID}`, {
    tenantId: TENANT_ID, storeId: STORE_ID, supplierId: SUPPLIER_ID,
    status: 'SENT', reference: 'BC-000001',
    items: [{
      productId: PRODUCT_ID, productName: 'Ciment',
      quantityOrdered: opts.ordered ?? 10, quantityReceived: 0,
      unitCost: opts.unitCost,
    }],
  });
  if (opts.stockQty > 0) {
    db.seed(`tenants/${TENANT_ID}/inventory/inv-1`, {
      tenantId: TENANT_ID, productId: PRODUCT_ID, storeId: STORE_ID,
      quantity: opts.stockQty,
    });
  }
}

const product = () => db.read(`tenants/${TENANT_ID}/products/${PRODUCT_ID}`);
const po = () => db.read(`tenants/${TENANT_ID}/purchase_orders/${PO_ID}`);

function stock(): number {
  for (const [path, data] of db.store.entries()) {
    if (path.includes('/inventory/') && data.productId === PRODUCT_ID) {
      return (data.quantity as number) ?? 0;
    }
  }
  return 0;
}

function body(qty: number) {
  return {
    tenantId: TENANT_ID, purchaseOrderId: PO_ID,
    lines: [{ productId: PRODUCT_ID, quantityReceivedNow: qty }],
  };
}

describe('réception : stock', () => {
  beforeEach(() => { db.store.clear(); });

  it('augmente le stock du magasin de destination', async () => {
    seed({ stockQty: 100, currentCost: 5_000, unitCost: 8_000 });
    const res = await receive(post(body(10)));
    expect(res.status).toBe(200);
    expect(stock()).toBe(110);
  });

  it('crée la ligne de stock si le produit n\'était pas encore présent', async () => {
    seed({ stockQty: 0, currentCost: null, unitCost: 8_000 });
    const res = await receive(post(body(10)));
    expect(res.status).toBe(200);
    expect(stock()).toBe(10);
  });

  it('passe le bon en « reçu partiellement » puis « reçu »', async () => {
    seed({ stockQty: 0, currentCost: null, unitCost: 8_000, ordered: 10 });
    await receive(post(body(4)));
    expect(po()?.status).toBe('PARTIALLY_RECEIVED');

    await receive(post(body(6)));
    expect(po()?.status).toBe('RECEIVED');
    expect(stock()).toBe(10);
  });

  it('refuse de réceptionner un bon déjà soldé', async () => {
    seed({ stockQty: 0, currentCost: null, unitCost: 8_000, ordered: 10 });
    await receive(post(body(10)));
    const second = await receive(post(body(5)));
    expect(second.status).not.toBe(200);
    expect(stock()).toBe(10);
  });
});

describe('réception : coût moyen pondéré', () => {
  beforeEach(() => { db.store.clear(); });

  it('pondère le coût existant et le coût reçu', async () => {
    // (100 × 5 000 + 10 × 8 000) / 110 = 5 272,7 → 5 273
    seed({ stockQty: 100, currentCost: 5_000, unitCost: 8_000 });
    await receive(post(body(10)));
    expect(product()?.purchasePrice).toBe(5_273);
  });

  it("n'écrase PAS le coût par le dernier reçu", async () => {
    // Le comportement d'origine donnait 8 000 : les 100 anciens sacs
    // auraient été revalorisés au prix du nouvel arrivage.
    seed({ stockQty: 100, currentCost: 5_000, unitCost: 8_000 });
    await receive(post(body(10)));
    expect(product()?.purchasePrice).not.toBe(8_000);
  });

  it('renseigne le coût quand le produit n\'en avait aucun', async () => {
    // La réception est le moment naturel où cette information arrive :
    // c'est ce qui rend le prix d'achat facultatif à la création viable.
    seed({ stockQty: 0, currentCost: null, unitCost: 7_500 });
    await receive(post(body(10)));
    expect(product()?.purchasePrice).toBe(7_500);
  });

  it('retient le coût reçu quand le stock était épuisé', async () => {
    // Sans stock restant, il n'y a rien à pondérer : le nouvel arrivage
    // fait référence à lui seul.
    seed({ stockQty: 0, currentCost: 5_000, unitCost: 9_000 });
    await receive(post(body(10)));
    expect(product()?.purchasePrice).toBe(9_000);
  });

  it('reste stable si le coût ne change pas', async () => {
    seed({ stockQty: 50, currentCost: 6_000, unitCost: 6_000 });
    await receive(post(body(10)));
    expect(product()?.purchasePrice).toBe(6_000);
  });
});
