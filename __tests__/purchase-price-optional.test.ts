import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';

/**
 * Prix d'achat facultatif.
 *
 * Le champ était obligatoire, ce qui poussait à saisir 0 quand on ne le
 * connaissait pas. Or 0 signifie « acquis gratuitement » : la marge passait à
 * 100 % et le rapport de rentabilité devenait faux sans le moindre signal.
 *
 * Règle retenue : une valeur absente reste absente. Les lignes sans coût sont
 * exclues du calcul, et la vente est marquée comme ayant une marge PARTIELLE
 * — un maximum, pas une valeur exacte.
 */

const TENANT_ID = 'tenant-1';
const STORE_ID = 'store-1';
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
  cookies: async () => ({ get: () => ({ value: 'session' }) }),
}));
vi.mock('@/lib/api/subscription-guard', () => ({
  checkSubscriptionAllows: async () => null,
}));

const { POST } = await import('@/app/api/pos/checkout/route');

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/pos/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Deux produits : l'un avec prix d'achat connu, l'autre sans. */
function seed() {
  db.store.clear();
  db.seed(`tenants/${TENANT_ID}/products/prod-connu`, {
    name: 'Ciment', sku: 'CIM-1', sellingPrice: 10_000, purchasePrice: 7_000,
    taxRate: 0, trackInventory: false,
  });
  db.seed(`tenants/${TENANT_ID}/products/prod-inconnu`, {
    name: 'Sable', sku: 'SAB-1', sellingPrice: 5_000, purchasePrice: null,
    taxRate: 0, trackInventory: false,
  });
}

function sale(items: { productId: string; quantity: number }[]) {
  return {
    tenantId: TENANT_ID, storeId: STORE_ID, items,
    paymentMethod: 'CASH', amountReceived: 1_000_000, userName: 'Testeur',
  };
}

/** Résumé de coût de la vente enregistrée. */
function costSummary(): Record<string, unknown> | undefined {
  for (const [path, data] of db.store.entries()) {
    if (path.includes('/cost_summary/')) return data;
  }
  return undefined;
}

describe("coût d'une vente", () => {
  beforeEach(() => { db.store.clear(); });

  it('calcule le coût exact quand tous les produits ont un prix d\'achat', async () => {
    seed();
    const res = await POST(post(sale([{ productId: 'prod-connu', quantity: 3 }])));
    expect(res.status).toBe(200);

    const cost = costSummary()!;
    expect(cost.costTotal).toBe(21_000);   // 3 × 7 000
    expect(cost.margin).toBe(9_000);       // 30 000 − 21 000
    expect(cost.costIncomplete).toBe(false);
  });

  it("n'attribue PAS un coût nul à un produit sans prix d'achat", async () => {
    // Le point central : un coût de 0 donnerait 100 % de marge.
    seed();
    await POST(post(sale([{ productId: 'prod-inconnu', quantity: 2 }])));

    const cost = costSummary()!;
    expect(cost.costTotal).toBe(0);          // rien de connu à additionner
    expect(cost.costIncomplete).toBe(true);  // mais c'est SIGNALÉ
    expect(cost.linesWithoutCost).toBe(1);
  });

  it('additionne les coûts connus et signale les lignes manquantes', async () => {
    seed();
    await POST(post(sale([
      { productId: 'prod-connu', quantity: 2 },   // 14 000 de coût connu
      { productId: 'prod-inconnu', quantity: 1 }, // coût inconnu
    ])));

    const cost = costSummary()!;
    expect(cost.costTotal).toBe(14_000);
    expect(cost.costIncomplete).toBe(true);
    expect(cost.linesWithoutCost).toBe(1);
    // La marge affichée est un MAXIMUM : le coût réel ne peut qu'être plus
    // élevé, jamais plus bas.
    expect(cost.margin).toBe(25_000 - 14_000);
  });

  it('la vente aboutit normalement malgré un prix d\'achat manquant', async () => {
    // Le champ étant facultatif, son absence ne doit jamais empêcher
    // d'encaisser — un caissier ne peut pas attendre que le patron
    // renseigne un coût pour servir un client.
    seed();
    const res = await POST(post(sale([{ productId: 'prod-inconnu', quantity: 1 }])));
    expect(res.status).toBe(200);
  });
});
