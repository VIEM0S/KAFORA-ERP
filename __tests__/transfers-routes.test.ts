import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';

/**
 * Tests des ROUTES de transfert — celles qui déplacent réellement du stock.
 *
 * Les règles de transition sont déjà testées à part (lib/transfers). Ici on
 * vérifie ce qui coûte de l'argent quand ça se passe mal :
 *   - expédier deux fois débiterait deux fois la source ;
 *   - recevoir deux fois créditerait deux fois la destination ;
 *   - annuler après expédition sans rendre le stock le ferait disparaître ;
 *   - expédier plus que le disponible mettrait la source en négatif.
 */

const TENANT_ID = 'tenant-1';
const FROM_STORE = 'store-A';
const TO_STORE = 'store-B';
const PRODUCT_ID = 'prod-1';
const USER_ID = 'user-1';
const TRANSFER_ID = 'transfer-1';

const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifySessionCookie: vi.fn(async () => ({
      uid: USER_ID, tenantId: TENANT_ID, role: 'OWNER', storeIds: null,
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

const { POST: ship } = await import('@/app/api/transfers/ship/route');
const { POST: receive } = await import('@/app/api/transfers/receive/route');
const { POST: decide } = await import('@/app/api/transfers/decide/route');

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/transfers/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Prépare un transfert de 5 unités, avec le stock indiqué à la source. */
function seed(status: string, sourceQty: number, destQty?: number) {
  db.store.clear();
  db.seed(`tenants/${TENANT_ID}`, { name: 'Test', transferSettings: null });
  db.seed(`tenants/${TENANT_ID}/transfers/${TRANSFER_ID}`, {
    tenantId: TENANT_ID,
    status,
    fromStoreId: FROM_STORE,
    toStoreId: TO_STORE,
    lines: [{ productId: PRODUCT_ID, productName: 'Ciment', productSku: 'CIM-1', quantity: 5 }],
  });
  db.seed(`tenants/${TENANT_ID}/inventory/inv-source`, {
    tenantId: TENANT_ID, productId: PRODUCT_ID, storeId: FROM_STORE, quantity: sourceQty,
  });
  if (destQty !== undefined) {
    db.seed(`tenants/${TENANT_ID}/inventory/inv-dest`, {
      tenantId: TENANT_ID, productId: PRODUCT_ID, storeId: TO_STORE, quantity: destQty,
    });
  }
}

const sourceQty = () => db.read(`tenants/${TENANT_ID}/inventory/inv-source`)?.quantity;
const destQty = () => db.read(`tenants/${TENANT_ID}/inventory/inv-dest`)?.quantity;
const status = () => db.read(`tenants/${TENANT_ID}/transfers/${TRANSFER_ID}`)?.status;

describe('expédition d\'un transfert', () => {
  beforeEach(() => { db.store.clear(); });

  it('sort le stock de la source et passe le transfert en transit', async () => {
    seed('APPROVED', 20);
    const res = await ship(request({ transferId: TRANSFER_ID }));
    expect(res.status).toBe(200);
    expect(sourceQty()).toBe(15);
    expect(status()).toBe('SHIPPED');
  });

  it('refuse et ne touche à rien si le stock est insuffisant', async () => {
    // Refus EN BLOC : un transfert à moitié parti serait ingérable côté
    // réception comme côté comptes.
    seed('APPROVED', 3);
    const res = await ship(request({ transferId: TRANSFER_ID }));
    expect(res.status).toBe(409);
    expect(sourceQty()).toBe(3);
    expect(status()).toBe('APPROVED');
  });

  it('refuse une seconde expédition — le stock ne sort qu\'une fois', async () => {
    seed('APPROVED', 20);
    await ship(request({ transferId: TRANSFER_ID }));
    const second = await ship(request({ transferId: TRANSFER_ID }));
    expect(second.status).toBe(409);
    expect(sourceQty()).toBe(15); // et non 10
  });

  it('refuse d\'expédier un transfert non validé', async () => {
    seed('PENDING', 20);
    const res = await ship(request({ transferId: TRANSFER_ID }));
    expect(res.status).toBe(409);
    expect(sourceQty()).toBe(20);
  });
});

describe('réception d\'un transfert', () => {
  beforeEach(() => { db.store.clear(); });

  it('crédite le magasin destination', async () => {
    seed('SHIPPED', 15, 2);
    const res = await receive(request({ transferId: TRANSFER_ID }));
    expect(res.status).toBe(200);
    expect(destQty()).toBe(7);
    expect(status()).toBe('RECEIVED');
  });

  it('refuse une seconde réception — le stock n\'entre qu\'une fois', async () => {
    // Le cas le plus coûteux : deux clics, ou deux personnes qui confirment
    // en même temps, créditeraient le stock en double.
    seed('SHIPPED', 15, 2);
    await receive(request({ transferId: TRANSFER_ID }));
    const second = await receive(request({ transferId: TRANSFER_ID }));
    expect(second.status).toBe(409);
    expect(destQty()).toBe(7); // et non 12
  });

  it('refuse de recevoir un transfert jamais expédié', async () => {
    seed('APPROVED', 15, 2);
    const res = await receive(request({ transferId: TRANSFER_ID }));
    expect(res.status).toBe(409);
    expect(destQty()).toBe(2);
  });
});

describe('annulation d\'un transfert', () => {
  beforeEach(() => { db.store.clear(); });

  it('rend le stock à la source quand le transfert était déjà expédié', async () => {
    // Sans cette restitution, la marchandise disparaîtrait des comptes :
    // sortie de la source, jamais entrée à destination.
    seed('SHIPPED', 15);
    const res = await decide(request({ transferId: TRANSFER_ID, action: 'CANCEL' }));
    expect(res.status).toBe(200);
    expect(sourceQty()).toBe(20);
    expect(status()).toBe('CANCELLED');
  });

  it('ne touche pas au stock si le transfert n\'était pas encore parti', async () => {
    seed('APPROVED', 20);
    const res = await decide(request({ transferId: TRANSFER_ID, action: 'CANCEL' }));
    expect(res.status).toBe(200);
    expect(sourceQty()).toBe(20);
  });

  it('refuse d\'annuler un transfert déjà reçu', async () => {
    seed('RECEIVED', 15, 7);
    const res = await decide(request({ transferId: TRANSFER_ID, action: 'CANCEL' }));
    expect(res.status).toBe(409);
    expect(status()).toBe('RECEIVED');
  });
});
