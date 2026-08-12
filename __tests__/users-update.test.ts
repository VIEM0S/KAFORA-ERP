import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore } from './helpers/fake-firestore';

const { dbHolder, authMock } = vi.hoisted(() => ({
  dbHolder: { current: null as FakeFirestore | null },
  authMock: {
    verifySessionCookie: vi.fn(),
    updateUser: vi.fn(async () => {}),
    setCustomUserClaims: vi.fn(async () => {}),
  },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: authMock,
  get adminDb() { return dbHolder.current!; },
}));

vi.mock('@/lib/firebase/audit-log', () => ({
  writeAuditLog: async () => {},
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'fake-session' }) }),
}));

const { POST } = await import('@/app/api/users/update/route');

const TENANT_ID = 'tenant1';
const STORE_A = 'store-a';
const STORE_B = 'store-b';

function seedStores(db: FakeFirestore) {
  db.seed(`tenants/${TENANT_ID}/stores/${STORE_A}`, { name: 'Magasin A' });
  db.seed(`tenants/${TENANT_ID}/stores/${STORE_B}`, { name: 'Magasin B' });
}

function seedUser(db: FakeFirestore, uid: string, role: string, storeIds: string[] | null) {
  db.seed(`tenants/${TENANT_ID}/users/${uid}`, {
    uid, role, storeIds, email: `${uid}@test.com`, firstName: 'X', lastName: 'Y',
  });
}

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/users/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: TENANT_ID, ...body }),
  });
}

describe('POST /api/users/update — REGIONAL_MANAGER', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    seedStores(dbHolder.current);
    vi.clearAllMocks();
  });

  it('peut modifier un CASHIER de son propre magasin', async () => {
    seedUser(dbHolder.current!, 'cashier1', 'CASHIER', [STORE_A]);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'rm1', role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });

    const res = await POST(request({ uid: 'cashier1', firstName: 'Nouveau' }));
    expect(res.status).toBe(200);
  });

  it("refuse de modifier un utilisateur d'un autre magasin", async () => {
    seedUser(dbHolder.current!, 'cashier1', 'CASHIER', [STORE_B]);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'rm1', role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });

    const res = await POST(request({ uid: 'cashier1', firstName: 'Nouveau' }));
    expect(res.status).toBe(403);
    expect(authMock.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('refuse de modifier un compte ADMIN', async () => {
    seedUser(dbHolder.current!, 'admin1', 'ADMIN', null);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'rm1', role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });

    const res = await POST(request({ uid: 'admin1', firstName: 'Nouveau' }));
    expect(res.status).toBe(403);
  });

  it('refuse de modifier un autre REGIONAL_MANAGER', async () => {
    seedUser(dbHolder.current!, 'rm2', 'REGIONAL_MANAGER', [STORE_A]);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'rm1', role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });

    const res = await POST(request({ uid: 'rm2', firstName: 'Nouveau' }));
    expect(res.status).toBe(403);
  });

  it('refuse de promouvoir un CASHIER en ADMIN', async () => {
    seedUser(dbHolder.current!, 'cashier1', 'CASHIER', [STORE_A]);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'rm1', role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });

    const res = await POST(request({ uid: 'cashier1', role: 'ADMIN' }));
    expect(res.status).toBe(403);
    expect(authMock.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('refuse de promouvoir un CASHIER en REGIONAL_MANAGER', async () => {
    seedUser(dbHolder.current!, 'cashier1', 'CASHIER', [STORE_A]);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'rm1', role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });

    const res = await POST(request({ uid: 'cashier1', role: 'REGIONAL_MANAGER' }));
    expect(res.status).toBe(403);
  });

  it('peut promouvoir un CASHIER en MANAGER, toujours sur son magasin', async () => {
    seedUser(dbHolder.current!, 'cashier1', 'CASHIER', [STORE_A]);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'rm1', role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });

    const res = await POST(request({ uid: 'cashier1', role: 'MANAGER' }));
    expect(res.status).toBe(200);
  });

  it("refuse de réaffecter un utilisateur vers un magasin hors de sa région, même en gardant le même rôle", async () => {
    seedUser(dbHolder.current!, 'cashier1', 'CASHIER', [STORE_A]);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'rm1', role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });

    const res = await POST(request({ uid: 'cashier1', storeIds: [STORE_B] }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users/update — OWNER/ADMIN (comportement existant, non régressé)', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    seedStores(dbHolder.current);
    vi.clearAllMocks();
  });

  it('un ADMIN ne peut pas modifier un compte ADMIN existant', async () => {
    seedUser(dbHolder.current!, 'admin2', 'ADMIN', null);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'admin1', role: 'ADMIN', storeIds: null });

    const res = await POST(request({ uid: 'admin2', firstName: 'Nouveau' }));
    expect(res.status).toBe(403);
  });

  it('un OWNER peut promouvoir un MANAGER en REGIONAL_MANAGER', async () => {
    seedUser(dbHolder.current!, 'mgr1', 'MANAGER', [STORE_A]);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'owner1', role: 'OWNER', storeIds: null });

    const res = await POST(request({ uid: 'mgr1', role: 'REGIONAL_MANAGER' }));
    expect(res.status).toBe(200);
    expect(authMock.setCustomUserClaims).toHaveBeenCalledWith('mgr1', {
      tenantId: TENANT_ID, role: 'REGIONAL_MANAGER', storeIds: [STORE_A],
    });
  });

  it('refuse une mise à jour vers un tenant différent', async () => {
    seedUser(dbHolder.current!, 'mgr1', 'MANAGER', [STORE_A]);
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, uid: 'owner1', role: 'OWNER', storeIds: null });

    const res = await POST(new NextRequest('http://localhost/api/users/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'autre-tenant', uid: 'mgr1', firstName: 'X' }),
    }));
    expect(res.status).toBe(403);
  });
});
