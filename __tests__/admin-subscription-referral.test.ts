import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';
import { REFERRAL_REFERRER_BONUS_DAYS } from '@/lib/constants';

/**
 * Récompense de parrainage déclenchée par /api/admin/subscription : un
 * paiement réel (amount > 0) pour un tenant parrainé étend l'abonnement de
 * SON parrain de REFERRAL_REFERRER_BONUS_DAYS jours, une seule fois.
 */

const { dbHolder, authMock } = vi.hoisted(() => ({
  dbHolder: { current: null as FakeFirestore | null },
  authMock: { verifySessionCookie: vi.fn() },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: authMock,
  get adminDb() { return dbHolder.current!; },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: fakeFieldValue,
  Timestamp: { fromDate: (d: Date) => d },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'fake-session' }) }),
}));

const { POST } = await import('@/app/api/admin/subscription/route');

const REFERRED_ID = 'tenant-referred';
const REFERRER_ID = 'tenant-referrer';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedBaseline() {
  const db = dbHolder.current!;
  db.seed(`tenants/${REFERRED_ID}`, { name: 'Boutique Filleul', referredByTenantId: REFERRER_ID });
  db.seed(`tenants/${REFERRED_ID}/subscriptions/${REFERRED_ID}`, {
    tenantId: REFERRED_ID, plan: 'STARTER', status: 'TRIAL',
  });
  db.seed(`tenants/${REFERRER_ID}/subscriptions/${REFERRER_ID}`, {
    tenantId: REFERRER_ID, plan: 'STARTER', status: 'ACTIVE',
  });
  db.seed(`tenants/${REFERRER_ID}/referrals/ref1`, {
    referrerTenantId: REFERRER_ID, referredTenantId: REFERRED_ID,
    status: 'PENDING', createdAt: new Date().toISOString(), rewardedAt: null,
  });
}

describe('POST /api/admin/subscription — récompense de parrainage', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    vi.clearAllMocks();
    authMock.verifySessionCookie.mockResolvedValue({ uid: 'super1', role: 'SUPER_ADMIN' });
  });

  it('un paiement réel récompense le parrain et marque le parrainage REWARDED', async () => {
    seedBaseline();

    const res = await POST(request({ tenantId: REFERRED_ID, months: 1, amount: 15000, method: 'CASH' }));
    expect(res.status).toBe(200);

    const referrerSub = dbHolder.current!.read(`tenants/${REFERRER_ID}/subscriptions/${REFERRER_ID}`);
    expect(referrerSub!.currentPeriodEnd).toBeDefined();
    const daysGranted = (new Date(referrerSub!.currentPeriodEnd as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysGranted).toBeGreaterThan(REFERRAL_REFERRER_BONUS_DAYS - 0.1);
    expect(daysGranted).toBeLessThan(REFERRAL_REFERRER_BONUS_DAYS + 0.1);

    const referral = dbHolder.current!.read(`tenants/${REFERRER_ID}/referrals/ref1`);
    expect(referral!.status).toBe('REWARDED');
  });

  it("une prolongation gracieuse (amount=0) ne déclenche PAS la récompense", async () => {
    seedBaseline();

    await POST(request({ tenantId: REFERRED_ID, months: 1, amount: 0, note: 'geste commercial' }));

    const referrerSub = dbHolder.current!.read(`tenants/${REFERRER_ID}/subscriptions/${REFERRER_ID}`);
    expect(referrerSub!.currentPeriodEnd).toBeUndefined();
    const referral = dbHolder.current!.read(`tenants/${REFERRER_ID}/referrals/ref1`);
    expect(referral!.status).toBe('PENDING');
  });

  it('un second paiement réel ne récompense pas une seconde fois (déjà REWARDED)', async () => {
    seedBaseline();
    await POST(request({ tenantId: REFERRED_ID, months: 1, amount: 15000 }));
    const afterFirst = dbHolder.current!.read(`tenants/${REFERRER_ID}/subscriptions/${REFERRER_ID}`);
    const endAfterFirst = afterFirst!.currentPeriodEnd;

    await POST(request({ tenantId: REFERRED_ID, months: 1, amount: 15000 }));
    const afterSecond = dbHolder.current!.read(`tenants/${REFERRER_ID}/subscriptions/${REFERRER_ID}`);

    // Le parrain n'est plus avancé par ce second paiement : la date de fin
    // n'a pas bougé pour cette raison (elle ne dépend plus du parrainage).
    expect(afterSecond!.currentPeriodEnd).toBe(endAfterFirst);
  });

  it('un tenant sans parrain traite le paiement normalement, sans erreur', async () => {
    const db = dbHolder.current!;
    db.seed(`tenants/no-referrer`, { name: 'Sans parrain' });
    db.seed(`tenants/no-referrer/subscriptions/no-referrer`, { tenantId: 'no-referrer', plan: 'STARTER', status: 'TRIAL' });

    const res = await POST(request({ tenantId: 'no-referrer', months: 1, amount: 15000 }));
    expect(res.status).toBe(200);
  });
});
