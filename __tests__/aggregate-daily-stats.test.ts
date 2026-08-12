import { describe, it, expect, vi } from 'vitest';
import { FakeFirestore } from './helpers/fake-firestore';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  Timestamp: { fromDate: (d: Date) => d },
}));

const { aggregateTenantDay, dayBounds } = await import('../netlify/functions/aggregate-daily-stats.mts');

const TENANT_ID = 'tenant-1';

function seedSale(
  db: FakeFirestore,
  saleId: string,
  createdAt: Date,
  data: { total: number; storeId?: string; paymentMethod?: string; customerId?: string; status?: string }
) {
  db.seed(`tenants/${TENANT_ID}/sales/${saleId}`, {
    createdAt,
    status: data.status ?? 'COMPLETED',
    total: data.total,
    storeId: data.storeId ?? 'store-1',
    paymentMethod: data.paymentMethod ?? 'CASH',
    customerId: data.customerId ?? null,
  });
}

function seedItem(
  db: FakeFirestore,
  saleId: string,
  itemId: string,
  createdAt: Date,
  data: { productId: string; productName: string; categoryId: string | null; total: number; quantity: number }
) {
  db.seed(`tenants/${TENANT_ID}/sales/${saleId}/sale_items/${itemId}`, {
    tenantId: TENANT_ID,
    createdAt,
    ...data,
  });
}

function seedCost(
  db: FakeFirestore,
  saleId: string,
  createdAt: Date,
  data: { costTotal: number; costByCategory: Record<string, number>; costIncomplete?: boolean }
) {
  db.seed(`tenants/${TENANT_ID}/sales/${saleId}/cost_summary/data`, {
    tenantId: TENANT_ID,
    createdAt,
    costIncomplete: false,
    ...data,
  });
}

describe('aggregateTenantDay — marge par catégorie', () => {
  it('calcule revenu, coût et marge par catégorie sur plusieurs ventes et catégories', async () => {
    const db = new FakeFirestore();
    const day = dayBounds(0);
    const at = new Date(day.start.getTime() + 60_000); // dans la fenêtre du jour

    // Vente 1 : deux lignes, deux catégories différentes.
    seedSale(db, 's1', at, { total: 3000 });
    seedItem(db, 's1', 'i1', at, { productId: 'p1', productName: 'Riz', categoryId: 'alimentaire', total: 2000, quantity: 2 });
    seedItem(db, 's1', 'i2', at, { productId: 'p2', productName: 'Savon', categoryId: 'hygiene', total: 1000, quantity: 1 });
    seedCost(db, 's1', at, { costTotal: 2100, costByCategory: { alimentaire: 1400, hygiene: 700 } });

    // Vente 2 : une ligne dans la catégorie déjà vue (alimentaire) — doit cumuler.
    seedSale(db, 's2', at, { total: 1500 });
    seedItem(db, 's2', 'i1', at, { productId: 'p1', productName: 'Riz', categoryId: 'alimentaire', total: 1500, quantity: 1 });
    seedCost(db, 's2', at, { costTotal: 1050, costByCategory: { alimentaire: 1050 } });

    const stats = await aggregateTenantDay(db as unknown as FirebaseFirestore.Firestore, TENANT_ID, day);

    expect(stats.revenueByCategory).toEqual({ alimentaire: 3500, hygiene: 1000 });
    expect(stats.costByCategory).toEqual({ alimentaire: 2450, hygiene: 700 });
    expect(stats.marginByCategory).toEqual({ alimentaire: 1050, hygiene: 300 });

    // Les totaux globaux (déjà existants) doivent rester cohérents.
    expect(stats.revenue).toBe(4500);
    expect(stats.cost).toBe(3150);
    expect(stats.margin).toBe(1350);
  });

  it("regroupe sous 'uncategorized' les lignes sans catégorie (produit non classé)", async () => {
    const db = new FakeFirestore();
    const day = dayBounds(0);
    const at = new Date(day.start.getTime() + 60_000);

    seedSale(db, 's1', at, { total: 1000 });
    seedItem(db, 's1', 'i1', at, { productId: 'p1', productName: 'Divers', categoryId: null, total: 1000, quantity: 1 });
    seedCost(db, 's1', at, { costTotal: 600, costByCategory: { uncategorized: 600 } });

    const stats = await aggregateTenantDay(db as unknown as FirebaseFirestore.Firestore, TENANT_ID, day);

    expect(stats.revenueByCategory).toEqual({ uncategorized: 1000 });
    expect(stats.marginByCategory).toEqual({ uncategorized: 400 });
  });

  it("attribue une categorie meme si son cout n'a pas ete calcule (produit sans prix d'achat)", async () => {
    const db = new FakeFirestore();
    const day = dayBounds(0);
    const at = new Date(day.start.getTime() + 60_000);

    seedSale(db, 's1', at, { total: 2000 });
    seedItem(db, 's1', 'i1', at, { productId: 'p1', productName: 'Article', categoryId: 'divers', total: 2000, quantity: 1 });
    // costByCategory vide : aucun prix d'achat connu pour cette ligne (voir
    // linesWithoutCost / costIncomplete côté checkout).
    seedCost(db, 's1', at, { costTotal: 0, costByCategory: {}, costIncomplete: true });

    const stats = await aggregateTenantDay(db as unknown as FirebaseFirestore.Firestore, TENANT_ID, day);

    // La catégorie apparaît quand même (via revenueByCategory) avec un coût
    // à 0 plutôt que d'être absente — sinon le lecteur croirait qu'il n'y a
    // eu aucune vente dans cette catégorie, ce qui serait faux.
    expect(stats.revenueByCategory).toEqual({ divers: 2000 });
    expect(stats.marginByCategory).toEqual({ divers: 2000 });
    expect(stats.costIncomplete).toBe(true);
  });

  it('exclut totalement une vente annulee : revenu, top produits, marge par categorie ET cout', async () => {
    // sale_items et cost_summary ne portent PAS le statut de la vente et ne
    // sont jamais modifies par /api/sales/cancel : sans filtrage explicite
    // par vente completee, une annulation gonflait quand meme topProducts,
    // revenueByCategory, et faisait baisser artificiellement margin (cout
    // compte sans le revenu correspondant, deja exclu par ailleurs).
    const db = new FakeFirestore();
    const day = dayBounds(0);
    const at = new Date(day.start.getTime() + 60_000);

    // Vente annulée — ne doit contribuer nulle part.
    seedSale(db, 's1', at, { total: 5000, status: 'CANCELLED' });
    seedItem(db, 's1', 'i1', at, { productId: 'p1', productName: 'Article annulé', categoryId: 'alimentaire', total: 5000, quantity: 3 });
    seedCost(db, 's1', at, { costTotal: 3000, costByCategory: { alimentaire: 3000 } });

    // Vente complétée — seule celle-ci doit compter.
    seedSale(db, 's2', at, { total: 1000 });
    seedItem(db, 's2', 'i1', at, { productId: 'p2', productName: 'Article vendu', categoryId: 'alimentaire', total: 1000, quantity: 1 });
    seedCost(db, 's2', at, { costTotal: 600, costByCategory: { alimentaire: 600 } });

    const stats = await aggregateTenantDay(db as unknown as FirebaseFirestore.Firestore, TENANT_ID, day);

    expect(stats.revenue).toBe(1000);
    expect(stats.saleCount).toBe(1);
    expect(stats.cost).toBe(600);
    expect(stats.margin).toBe(400);
    expect(stats.costIncomplete).toBe(false);
    expect(stats.revenueByCategory).toEqual({ alimentaire: 1000 });
    expect(stats.costByCategory).toEqual({ alimentaire: 600 });
    expect(stats.marginByCategory).toEqual({ alimentaire: 400 });
    expect(stats.topProducts.map(p => p.productId)).toEqual(['p2']);
  });
});
