import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';

/**
 * SIMULATION du scénario réel rencontré en production.
 *
 * Deux boutiques : « kaforaerp » (source) et « kafo » (destination).
 * Deux produits : RIZ fine (RZ-001) et RIZ gras (RZ-002), 50 sacs chacun.
 * Un responsable affecté uniquement à « kafo ».
 *
 * Le transfert avait été créé, expédié et reçu — et le responsable de « kafo »
 * voyait malgré tout 0 en stock. Ces tests vérifient que le stock arrive
 * réellement, et que les règles d'accès ne bloquent pas les opérations
 * légitimes du responsable destinataire.
 *
 * CE QUE CETTE SIMULATION NE COUVRE PAS : la cause réelle de l'affichage à 0
 * était le REJET DES REQUÊTES par les règles Firestore (une requête sans
 * filtre `storeId` est refusée en bloc pour un utilisateur restreint). Les
 * règles ne s'exécutent pas ici — seul l'émulateur Firestore ou le navigateur
 * peut le confirmer. Ces tests garantissent la partie données, pas la partie
 * autorisation.
 */

const TENANT_ID = 'tenant-1';
const STORE_SOURCE = 'store-kaforaerp';
const STORE_DEST = 'store-kafo';
const RIZ_FINE = 'prod-riz-fine';
const RIZ_GRAS = 'prod-riz-gras';

const db = new FakeFirestore();

/** Rôle et périmètre du compte connecté, modifiables par test. */
let currentUser = {
  uid: 'user-owner',
  tenantId: TENANT_ID,
  role: 'OWNER' as string,
  storeIds: null as string[] | null,
};

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifySessionCookie: vi.fn(async () => currentUser),
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

const { POST: createTransfer } = await import('@/app/api/transfers/create/route');
const { POST: ship } = await import('@/app/api/transfers/ship/route');
const { POST: receive } = await import('@/app/api/transfers/receive/route');

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/transfers/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Remet en place les deux boutiques et le stock initial de la source. */
function setupBoutiques(sourceStock = 200) {
  db.store.clear();
  db.seed(`tenants/${TENANT_ID}`, { name: 'Kafora', transferSettings: null });
  db.seed(`tenants/${TENANT_ID}/stores/${STORE_SOURCE}`, { name: 'kaforaerp', isActive: true });
  db.seed(`tenants/${TENANT_ID}/stores/${STORE_DEST}`, { name: 'kafo', isActive: true });

  db.seed(`tenants/${TENANT_ID}/inventory/inv-src-fine`, {
    tenantId: TENANT_ID, productId: RIZ_FINE, storeId: STORE_SOURCE, quantity: sourceStock,
  });
  db.seed(`tenants/${TENANT_ID}/inventory/inv-src-gras`, {
    tenantId: TENANT_ID, productId: RIZ_GRAS, storeId: STORE_SOURCE, quantity: sourceStock,
  });
  // La destination n'a AUCUNE ligne d'inventaire : c'est le cas réel d'une
  // boutique qui reçoit un produit qu'elle ne vendait pas encore.
}

const LIGNES = [
  { productId: RIZ_FINE, productName: 'RIZ fine', productSku: 'RZ-001', quantity: 50 },
  { productId: RIZ_GRAS, productName: 'RIZ gras', productSku: 'RZ-002', quantity: 50 },
];

/** Quantité en stock d'un produit dans un magasin donné. */
function stock(productId: string, storeId: string): number {
  for (const [path, data] of db.store.entries()) {
    if (
      path.includes(`${TENANT_ID}/inventory/`) &&
      data.productId === productId &&
      data.storeId === storeId
    ) {
      return (data.quantity as number) ?? 0;
    }
  }
  return 0;
}

function findTransferId(): string {
  for (const path of db.store.keys()) {
    const m = path.match(new RegExp(`tenants/${TENANT_ID}/transfers/([^/]+)$`));
    if (m) return m[1];
  }
  throw new Error('aucun transfert créé');
}

describe('SIMULATION — 100 sacs de riz de kaforaerp vers kafo', () => {
  beforeEach(() => {
    setupBoutiques();
    currentUser = { uid: 'user-owner', tenantId: TENANT_ID, role: 'OWNER', storeIds: null };
  });

  it('le parcours complet amène bien les 50 + 50 sacs à destination', async () => {
    // 1. Le propriétaire crée la demande (pas d'approbation configurée :
    //    elle naît donc déjà validée).
    const created = await createTransfer(
      post({ fromStoreId: STORE_SOURCE, toStoreId: STORE_DEST, lines: LIGNES, note: 'odo' })
    );
    expect(created.status).toBe(200);
    const transferId = findTransferId();

    // 2. Expédition : le stock QUITTE la source.
    expect(stock(RIZ_FINE, STORE_SOURCE)).toBe(200);
    const shipped = await ship(post({ transferId }));
    expect(shipped.status).toBe(200);
    expect(stock(RIZ_FINE, STORE_SOURCE)).toBe(150);
    expect(stock(RIZ_GRAS, STORE_SOURCE)).toBe(150);

    // 3. En transit : la marchandise n'est encore nulle part ailleurs.
    //    C'est voulu — elle ne doit pas être vendable des deux côtés.
    expect(stock(RIZ_FINE, STORE_DEST)).toBe(0);

    // 4. Réception : le stock ENTRE à destination.
    const received = await receive(post({ transferId }));
    expect(received.status).toBe(200);
    expect(stock(RIZ_FINE, STORE_DEST)).toBe(50);
    expect(stock(RIZ_GRAS, STORE_DEST)).toBe(50);

    // 5. Rien ne s'est perdu ni dupliqué en chemin.
    expect(stock(RIZ_FINE, STORE_SOURCE) + stock(RIZ_FINE, STORE_DEST)).toBe(200);
    expect(stock(RIZ_GRAS, STORE_SOURCE) + stock(RIZ_GRAS, STORE_DEST)).toBe(200);
  });

  it('le responsable de kafo peut demander un transfert VERS sa boutique', async () => {
    // Le cas qui échouait : un responsable affecté à une seule boutique.
    // Il n'est pas rattaché à la source, mais il est bien concerné en tant
    // que destinataire — c'est précisément lui qui a besoin d'être livré.
    currentUser = {
      uid: 'user-madou', tenantId: TENANT_ID, role: 'MANAGER', storeIds: [STORE_DEST],
    };

    const res = await createTransfer(
      post({ fromStoreId: STORE_SOURCE, toStoreId: STORE_DEST, lines: LIGNES })
    );
    expect(res.status).toBe(200);
  });

  it("le responsable de kafo ne peut PAS expédier depuis une boutique qu'il ne gère pas", async () => {
    await createTransfer(
      post({ fromStoreId: STORE_SOURCE, toStoreId: STORE_DEST, lines: LIGNES })
    );
    const transferId = findTransferId();

    currentUser = {
      uid: 'user-madou', tenantId: TENANT_ID, role: 'MANAGER', storeIds: [STORE_DEST],
    };
    const res = await ship(post({ transferId }));
    expect(res.status).toBe(403);
    // Aucun stock n'a bougé.
    expect(stock(RIZ_FINE, STORE_SOURCE)).toBe(200);
  });

  it('le responsable de kafo peut confirmer la réception dans SA boutique', async () => {
    await createTransfer(
      post({ fromStoreId: STORE_SOURCE, toStoreId: STORE_DEST, lines: LIGNES })
    );
    const transferId = findTransferId();
    await ship(post({ transferId })); // expédié par le propriétaire

    currentUser = {
      uid: 'user-madou', tenantId: TENANT_ID, role: 'MANAGER', storeIds: [STORE_DEST],
    };
    const res = await receive(post({ transferId }));
    expect(res.status).toBe(200);
    expect(stock(RIZ_FINE, STORE_DEST)).toBe(50);
  });

  it("un responsable étranger aux deux boutiques ne peut rien créer", async () => {
    currentUser = {
      uid: 'user-tiers', tenantId: TENANT_ID, role: 'MANAGER', storeIds: ['store-autre'],
    };
    const res = await createTransfer(
      post({ fromStoreId: STORE_SOURCE, toStoreId: STORE_DEST, lines: LIGNES })
    );
    expect(res.status).toBe(403);
  });

  it('un caissier ne peut pas créer de transfert', async () => {
    currentUser = {
      uid: 'user-caisse', tenantId: TENANT_ID, role: 'CASHIER', storeIds: [STORE_DEST],
    };
    const res = await createTransfer(
      post({ fromStoreId: STORE_SOURCE, toStoreId: STORE_DEST, lines: LIGNES })
    );
    expect(res.status).toBe(403);
  });

  it('refuse un transfert de plus que le stock disponible, sans rien déplacer', async () => {
    setupBoutiques(30); // moins que les 50 demandés
    await createTransfer(
      post({ fromStoreId: STORE_SOURCE, toStoreId: STORE_DEST, lines: LIGNES })
    );
    const transferId = findTransferId();

    const res = await ship(post({ transferId }));
    expect(res.status).toBe(409);
    expect(stock(RIZ_FINE, STORE_SOURCE)).toBe(30);
    expect(stock(RIZ_FINE, STORE_DEST)).toBe(0);
  });

  it('refuse un transfert vers le même magasin', async () => {
    const res = await createTransfer(
      post({ fromStoreId: STORE_SOURCE, toStoreId: STORE_SOURCE, lines: LIGNES })
    );
    expect(res.status).toBe(400);
  });

  it('refuse une quantité nulle ou négative', async () => {
    const res = await createTransfer(
      post({
        fromStoreId: STORE_SOURCE, toStoreId: STORE_DEST,
        lines: [{ ...LIGNES[0], quantity: -10 }],
      })
    );
    expect(res.status).toBe(400);
  });
});
