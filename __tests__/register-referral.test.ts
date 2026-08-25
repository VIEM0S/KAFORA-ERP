import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore, fakeFieldValue } from './helpers/fake-firestore';
import { REFERRAL_REFEREE_BONUS_DAYS } from '@/lib/constants';

/**
 * Parrainage côté inscription : un lien ?ref=CODE valide résout le tenant
 * parrain, prolonge l'essai du nouveau tenant de REFERRAL_REFEREE_BONUS_DAYS
 * jours, et crée une trace PENDING sous le tenant du parrain. Un code
 * absent/invalide ne doit JAMAIS bloquer l'inscription (fail-open).
 */

const { dbHolder, authMock } = vi.hoisted(() => ({
  dbHolder: { current: null as FakeFirestore | null },
  authMock: {
    createUser: vi.fn(async () => ({ uid: 'new-user-1' })),
    setCustomUserClaims: vi.fn(async () => {}),
  },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: authMock,
  get adminDb() { return dbHolder.current!; },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: fakeFieldValue,
  Timestamp: { fromDate: (d: Date) => d },
}));

const { POST } = await import('@/app/api/auth/register/route');

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    company: { name: 'Boutique Filleul', email: 'contact@filleul.ml' },
    store: { name: 'Magasin Principal' },
    user: { firstName: 'Aissata', lastName: 'Traore', email: 'aissata@filleul.ml', password: 'motdepasse123' },
    plan: 'STARTER',
    acceptedTerms: true,
    termsVersion: '2026-08-01',
    ...overrides,
  };
}

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Même logique : seul l'abonnement créé par la route porte `trialEndsAt`.
function findTenantSub(): { path: string; data: Record<string, unknown> } {
  for (const [path, data] of dbHolder.current!.store.entries()) {
    if (/^tenants\/[^/]+\/subscriptions\/[^/]+$/.test(path) && 'trialEndsAt' in data) return { path, data };
  }
  throw new Error('Aucun abonnement nouvellement créé trouvé en base');
}

// Distingue le tenant NOUVELLEMENT créé par la route d'un tenant "parrain"
// pré-semé par le test : seul le premier porte `termsAcceptance` (écrit par
// app/api/auth/register/route.ts, jamais par un seed de test).
function findTenant(): { path: string; data: Record<string, unknown> } {
  for (const [path, data] of dbHolder.current!.store.entries()) {
    if (/^tenants\/[^/]+$/.test(path) && 'termsAcceptance' in data) return { path, data };
  }
  throw new Error('Aucun tenant nouvellement créé trouvé en base');
}

describe('POST /api/auth/register — parrainage', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    vi.clearAllMocks();
    authMock.createUser.mockResolvedValue({ uid: 'new-user-1' });
  });

  it('un code de parrainage valide prolonge l\'essai et trace le filleul chez le parrain', async () => {
    dbHolder.current!.seed('tenants/referrer1', { name: 'Boutique Marraine', referralCode: 'MARRAINE-ABC123' });
    dbHolder.current!.seed('tenants/referrer1/subscriptions/referrer1', { tenantId: 'referrer1', status: 'ACTIVE' });

    const res = await POST(request(validBody({ referralCode: 'marraine-abc123' }))); // casse volontairement différente
    expect(res.status).toBe(200);

    const { data: tenant } = findTenant();
    expect(tenant.referredByTenantId).toBe('referrer1');
    expect(typeof tenant.referralCode).toBe('string'); // son propre code, généré

    const { data: sub } = findTenantSub();
    const trialDays = (new Date(sub.trialEndsAt as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(trialDays).toBeGreaterThan(14 + REFERRAL_REFEREE_BONUS_DAYS - 0.1);
    expect(trialDays).toBeLessThan(14 + REFERRAL_REFEREE_BONUS_DAYS + 0.1);

    const referralDocs = Array.from(dbHolder.current!.store.entries())
      .filter(([p]) => p.startsWith('tenants/referrer1/referrals/'));
    expect(referralDocs).toHaveLength(1);
    expect(referralDocs[0][1].status).toBe('PENDING');
  });

  it('un code de parrainage inconnu n\'empêche pas l\'inscription (fail-open)', async () => {
    const res = await POST(request(validBody({ referralCode: 'NIMPORTEQUOI' })));
    expect(res.status).toBe(200);

    const { data: tenant } = findTenant();
    expect(tenant.referredByTenantId).toBeNull();

    const { data: sub } = findTenantSub();
    const trialDays = (new Date(sub.trialEndsAt as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(trialDays).toBeGreaterThan(14 - 0.1);
    expect(trialDays).toBeLessThan(14 + 0.1);
  });

  it('sans code de parrainage, essai standard de 14 jours', async () => {
    const res = await POST(request(validBody()));
    expect(res.status).toBe(200);

    const { data: tenant } = findTenant();
    expect(tenant.referredByTenantId).toBeNull();
    expect(typeof tenant.referralCode).toBe('string');
  });
});
