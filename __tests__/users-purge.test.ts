import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore } from './helpers/fake-firestore';

const { dbHolder, authMock } = vi.hoisted(() => ({
  dbHolder: { current: null as FakeFirestore | null },
  authMock: {
    verifySessionCookie: vi.fn(),
    deleteUser: vi.fn(async () => {}),
  },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: authMock,
  get adminDb() { return dbHolder.current!; },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'fake-session' }) }),
}));

const { POST } = await import('@/app/api/users/purge/route');

const TENANT_ID = 'tenant1';

function seedUser(uid: string, data: Record<string, unknown>) {
  dbHolder.current!.seed(`tenants/${TENANT_ID}/users/${uid}`, {
    uid, email: `${uid}@test.com`, firstName: 'Aissata', lastName: 'Traore', isActive: false,
    ...data,
  });
}

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/users/purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/users/purge', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    vi.clearAllMocks();
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'owner1', role: 'OWNER' });
  });

  it('purge un compte déjà désactivé quand le nom saisi correspond', async () => {
    seedUser('u1', { role: 'CASHIER' });

    const res = await POST(request({ uid: 'u1', confirmName: 'Aissata Traore' }));
    expect(res.status).toBe(200);
    expect(authMock.deleteUser).toHaveBeenCalledWith('u1');
    expect(dbHolder.current!.read(`tenants/${TENANT_ID}/users/u1`)).toBeUndefined();
  });

  it('refuse si le nom saisi ne correspond pas', async () => {
    seedUser('u1', { role: 'CASHIER' });

    const res = await POST(request({ uid: 'u1', confirmName: 'Mauvais Nom' }));
    expect(res.status).toBe(400);
    expect(authMock.deleteUser).not.toHaveBeenCalled();
    expect(dbHolder.current!.read(`tenants/${TENANT_ID}/users/u1`)).toBeDefined();
  });

  it('refuse un compte encore actif — doit être désactivé au préalable', async () => {
    seedUser('u1', { role: 'CASHIER', isActive: true });

    const res = await POST(request({ uid: 'u1', confirmName: 'Aissata Traore' }));
    expect(res.status).toBe(409);
    expect(authMock.deleteUser).not.toHaveBeenCalled();
  });

  it('refuse de purger le Propriétaire', async () => {
    seedUser('u1', { role: 'OWNER' });

    const res = await POST(request({ uid: 'u1', confirmName: 'Aissata Traore' }));
    expect(res.status).toBe(403);
    expect(authMock.deleteUser).not.toHaveBeenCalled();
  });

  it('refuse de purger son propre compte', async () => {
    seedUser('owner1', { role: 'CASHIER' });

    const res = await POST(request({ uid: 'owner1', confirmName: 'Aissata Traore' }));
    expect(res.status).toBe(400);
    expect(authMock.deleteUser).not.toHaveBeenCalled();
  });

  it("refuse un appelant qui n'est pas Propriétaire", async () => {
    seedUser('u1', { role: 'CASHIER' });
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'admin1', role: 'ADMIN' });

    const res = await POST(request({ uid: 'u1', confirmName: 'Aissata Traore' }));
    expect(res.status).toBe(403);
    expect(authMock.deleteUser).not.toHaveBeenCalled();
  });

  it('404 sur un compte déjà purgé', async () => {
    const res = await POST(request({ uid: 'introuvable', confirmName: 'X Y' }));
    expect(res.status).toBe(404);
  });
});
