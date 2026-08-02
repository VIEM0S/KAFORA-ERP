import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeFirestore } from './helpers/fake-firestore';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * Garde-fou d'abonnement côté serveur.
 *
 * C'est lui qui décide si un commerce peut encore encaisser. Deux erreurs
 * possibles, aux conséquences opposées :
 *   - trop permissif : le service reste gratuit indéfiniment ;
 *   - trop strict : une caisse se bloque à tort, en pleine journée.
 *
 * La politique retenue est volontairement PERMISSIVE en cas de doute
 * (document manquant, base injoignable) : bloquer un commerce à cause d'une
 * donnée absente coûte bien plus cher que quelques jours offerts.
 */

const TENANT_ID = 'tenant-1';
const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  get adminDb() { return db; },
}));

const { checkSubscriptionAllows, getTenantSubscriptionState } = await import(
  '@/lib/api/subscription-guard'
);

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

function seedSubscription(data: Record<string, unknown>) {
  db.store.clear();
  db.seed(`tenants/${TENANT_ID}/subscriptions/${TENANT_ID}`, data);
}

describe('état lu depuis la base', () => {
  beforeEach(() => { db.store.clear(); });

  it('reconnaît un abonnement à jour', async () => {
    seedSubscription({ status: 'ACTIVE', currentPeriodEnd: days(10) });
    expect(await getTenantSubscriptionState(TENANT_ID)).toBe('ACTIVE');
  });

  it('reconnaît la période de tolérance', async () => {
    seedSubscription({ status: 'ACTIVE', currentPeriodEnd: days(-2) });
    expect(await getTenantSubscriptionState(TENANT_ID)).toBe('GRACE');
  });

  it('reconnaît une expiration complète', async () => {
    seedSubscription({ status: 'ACTIVE', currentPeriodEnd: days(-30) });
    expect(await getTenantSubscriptionState(TENANT_ID)).toBe('EXPIRED');
  });

  it("laisse passer si aucun abonnement n'existe en base", async () => {
    // Tenant créé avant la mise en place des abonnements : il ne doit pas
    // se retrouver bloqué du jour au lendemain.
    db.store.clear();
    expect(await getTenantSubscriptionState(TENANT_ID)).toBe('ACTIVE');
  });
});

describe('autorisation des actions', () => {
  beforeEach(() => { db.store.clear(); });

  it('autorise tout quand l\'abonnement est à jour', async () => {
    seedSubscription({ status: 'ACTIVE', currentPeriodEnd: days(10) });
    expect(await checkSubscriptionAllows(TENANT_ID, 'pos')).toBeNull();
    expect(await checkSubscriptionAllows(TENANT_ID, 'write')).toBeNull();
  });

  it('pendant la tolérance : la caisse passe, les autres écritures non', async () => {
    seedSubscription({ status: 'ACTIVE', currentPeriodEnd: days(-2) });

    // Un commerce ne doit pas s'arrêter de vendre du jour au lendemain.
    expect(await checkSubscriptionAllows(TENANT_ID, 'pos')).toBeNull();

    const write = await checkSubscriptionAllows(TENANT_ID, 'write');
    expect(write).not.toBeNull();
    expect(write!.status).toBe(402); // Payment Required, distinct de 401/403
  });

  it('bloque la caisse une fois la tolérance dépassée', async () => {
    seedSubscription({ status: 'ACTIVE', currentPeriodEnd: days(-30) });
    const pos = await checkSubscriptionAllows(TENANT_ID, 'pos');
    expect(pos).not.toBeNull();
    expect(pos!.status).toBe(402);
    // Le message doit être compréhensible par un commerçant, pas technique.
    expect(pos!.error).toMatch(/abonnement/i);
  });

  it('respecte une résiliation explicite malgré une date future', async () => {
    seedSubscription({ status: 'CANCELLED', currentPeriodEnd: days(60) });
    expect(await checkSubscriptionAllows(TENANT_ID, 'pos')).not.toBeNull();
  });

  it('laisse passer quand la date est illisible', async () => {
    // Donnée corrompue : on n'arrête pas une caisse pour ça.
    seedSubscription({ status: 'ACTIVE', currentPeriodEnd: 'pas-une-date' });
    expect(await checkSubscriptionAllows(TENANT_ID, 'pos')).toBeNull();
  });
});
