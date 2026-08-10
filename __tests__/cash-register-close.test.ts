import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';

/**
 * Clôture de caisse.
 *
 * Le solde attendu doit refléter le TIROIR RÉEL, et surtout être calculé
 * EXACTEMENT comme celui affiché au caissier pendant sa session. Une
 * divergence entre les deux est pire que l'absence de contrôle : le caissier
 * voit un montant à l'écran et s'en voit reprocher un autre à la fermeture.
 */

const TENANT_ID = 'tenant-1';
const STORE_ID = 'store-1';
const REGISTER_ID = 'register_store-1';
const OPENED_AT = Date.now() - 4 * 60 * 60 * 1000; // ouverte il y a 4 h

const db = new FakeFirestore();

const { authMock } = vi.hoisted(() => ({
  authMock: {
    verifySessionCookie: vi.fn(async () => ({
      uid: 'user-1', tenantId: TENANT_ID, role: 'MANAGER', storeIds: null as string[] | null,
    })),
  },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: authMock,
  get adminDb() { return db; },
  // La route marque aussi la caisse comme fermée en base temps réel.
  adminRtdb: {
    ref: () => ({
      set: async () => {},
      // La route lit l'ouverture ICI, jamais dans le corps de la requête :
      // un caissier ne peut donc pas déclarer un fond de caisse falsifié
      // pour masquer un manque.
      get: async () => ({
        val: () => ({
          status: 'OPEN', openedAt: OPENED_AT, openingBalance: 50_000,
          openedBy: 'user-1', openedByName: 'Caissier',
        }),
        exists: () => true,
      }),
      once: async () => ({ val: () => ({ status: 'OPEN' }) }),
      update: async () => {},
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: fakeFieldValue,
  Timestamp: { fromDate: (d: Date) => d },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'session' }) }),
}));

vi.mock('@/lib/firebase/rtdb', () => ({
  RTDB_PATHS: { cashRegister: () => 'fake/path' },
}));

vi.mock('firebase-admin/database', () => ({
  getDatabase: () => ({ ref: () => ({ set: async () => {}, once: async () => ({ val: () => null }) }) }),
}));

const { POST: close } = await import('@/app/api/cash-register/close/route');

function post(countedAmount: number) {
  return new NextRequest('http://localhost/api/cash-register/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: TENANT_ID, storeId: STORE_ID, registerId: REGISTER_ID,
      openedBy: 'user-1', openedByName: 'Caissier',
      openedAt: OPENED_AT, openingBalance: 50_000,
      countedAmount, closedByName: 'Caissier',
    }),
  });
}

function seedSale(id: string, data: Record<string, unknown>) {
  db.seed(`tenants/${TENANT_ID}/sales/${id}`, {
    tenantId: TENANT_ID, storeId: STORE_ID,
    createdAt: new Date(OPENED_AT + 60_000),
    status: 'COMPLETED',
    ...data,
  });
}

/** Session clôturée enregistrée. */
function closedSession(): Record<string, unknown> | undefined {
  for (const [path, data] of db.store.entries()) {
    if (path.includes('/cash_sessions/')) return data;
  }
  return undefined;
}

describe('solde attendu à la clôture', () => {
  beforeEach(() => { db.store.clear(); });

  it('compte le fond de caisse et les ventes en espèces', async () => {
    seedSale('s1', { total: 30_000, paymentMethod: 'CASH' });
    seedSale('s2', { total: 20_000, paymentMethod: 'CASH' });

    const res = await close(post(100_000));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expectedBalance).toBe(100_000); // 50 000 + 50 000
    expect(body.difference).toBe(0);
  });

  it("compte l'acompte d'une vente à crédit", async () => {
    // Cet argent est dans le tiroir même si la vente n'est pas « espèces ».
    seedSale('s1', { total: 100_000, paymentMethod: 'CREDIT', acompte: 30_000 });

    const res = await close(post(80_000));
    const body = await res.json();
    expect(body.expectedBalance).toBe(80_000); // 50 000 + 30 000
    expect(body.difference).toBe(0);
  });

  it('ignore les ventes annulées', async () => {
    // Une vente annulée a été remboursée : la compter ferait apparaître un
    // manquant pour une erreur qui n'est pas celle du caissier.
    seedSale('s1', { total: 30_000, paymentMethod: 'CASH' });
    seedSale('s2', { total: 25_000, paymentMethod: 'CASH', status: 'CANCELLED' });

    const res = await close(post(80_000));
    const body = await res.json();
    expect(body.expectedBalance).toBe(80_000); // 50 000 + 30 000 seulement
  });

  it('signale un manquant', async () => {
    seedSale('s1', { total: 40_000, paymentMethod: 'CASH' });
    const res = await close(post(85_000)); // attendu 90 000
    const body = await res.json();
    expect(body.difference).toBe(-5_000);
  });

  it('signale un excédent', async () => {
    seedSale('s1', { total: 40_000, paymentMethod: 'CASH' });
    const res = await close(post(93_000));
    const body = await res.json();
    expect(body.difference).toBe(3_000);
  });

  it('conserve le détail du calcul dans la session', async () => {
    // Un écart contesté plus tard doit pouvoir être reconstitué sans relire
    // toutes les ventes de la journée.
    seedSale('s1', { total: 40_000, paymentMethod: 'CASH' });
    seedSale('s2', { total: 60_000, paymentMethod: 'CREDIT', acompte: 10_000 });

    await close(post(100_000));
    const s = closedSession()!;
    expect(s.cashSalesTotal).toBe(40_000);
    expect(s.acompteTotal).toBe(10_000);
    expect(s.openingBalance).toBe(50_000);
    expect(s.closingBalance).toBe(100_000);
  });
});

describe('garde-fous', () => {
  beforeEach(() => { db.store.clear(); });

  it('refuse une seconde clôture de la même session', async () => {
    // Un double clic produisait deux sessions clôturées, chacune avec son
    // écart : deux manquants pour une seule journée, indépartageables.
    seedSale('s1', { total: 40_000, paymentMethod: 'CASH' });

    const first = await close(post(90_000));
    expect(first.status).toBe(200);

    const second = await close(post(90_000));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.alreadyClosed).toBe(true);
  });

  it('refuse une requête sans montant compté', async () => {
    const res = await close(new NextRequest('http://localhost/api/cash-register/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID, registerId: REGISTER_ID }),
    }));
    expect(res.status).toBe(400);
  });

  it("refuse de clôturer un magasin qui ne fait pas partie des magasins assignés à l'appelant", async () => {
    // Cloisonnement par magasin, comme /api/pos/checkout : un caissier affecté
    // uniquement au magasin A ne doit pas pouvoir clôturer la caisse du B.
    authMock.verifySessionCookie.mockResolvedValueOnce({
      uid: 'user-1', tenantId: TENANT_ID, role: 'CASHIER', storeIds: ['un-autre-store'],
    });

    const res = await close(post(90_000));
    expect(res.status).toBe(403);
  });

  it('autorise la clôture quand le magasin demandé fait partie des magasins assignés', async () => {
    authMock.verifySessionCookie.mockResolvedValueOnce({
      uid: 'user-1', tenantId: TENANT_ID, role: 'CASHIER', storeIds: [STORE_ID],
    });

    const res = await close(post(50_000)); // aucune vente => attendu = fond de caisse seul
    expect(res.status).toBe(200);
  });
});
