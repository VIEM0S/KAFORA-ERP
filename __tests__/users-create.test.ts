import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore } from './helpers/fake-firestore';

const { dbHolder, authMock } = vi.hoisted(() => ({
  dbHolder: { current: null as FakeFirestore | null },
  authMock: {
    verifySessionCookie: vi.fn(),
    createUser: vi.fn(async () => ({ uid: 'new-user-uid' })),
    setCustomUserClaims: vi.fn(async () => {}),
  },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: authMock,
  get adminDb() { return dbHolder.current!; },
}));

vi.mock('@/lib/firebase/plan-limits', () => ({
  checkPlanLimit: async () => ({ allowed: true }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'fake-session' }) }),
}));

const { POST } = await import('@/app/api/users/create/route');

const TENANT_ID = 'tenant1';
const STORE_A = 'store-a';
const STORE_B = 'store-b';

function seedStores(db: FakeFirestore) {
  db.seed(`tenants/${TENANT_ID}/stores/${STORE_A}`, { name: 'Magasin A' });
  db.seed(`tenants/${TENANT_ID}/stores/${STORE_B}`, { name: 'Magasin B' });
}

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/users/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: TENANT_ID, ...body }),
  });
}

function baseUser() {
  return {
    email: 'nouveau@test.com', password: 'password123',
    firstName: 'Amadou', lastName: 'Traoré',
  };
}

describe('POST /api/users/create — accès de base', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    seedStores(dbHolder.current);
    vi.clearAllMocks();
    authMock.createUser.mockResolvedValue({ uid: 'new-user-uid' });
  });

  it('refuse un caissier ou un responsable (ni OWNER/ADMIN/REGIONAL_MANAGER)', async () => {
    for (const role of ['CASHIER', 'MANAGER']) {
      authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role, storeIds: null });
      const res = await POST(request({ ...baseUser(), role: 'CASHIER', storeIds: [STORE_A] }));
      expect(res.status).toBe(403);
    }
  });
});

describe('POST /api/users/create — REGIONAL_MANAGER', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    seedStores(dbHolder.current);
    vi.clearAllMocks();
    authMock.createUser.mockResolvedValue({ uid: 'new-user-uid' });
  });

  it('peut créer un CASHIER sur son propre magasin', async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });
    const res = await POST(request({ ...baseUser(), role: 'CASHIER', storeIds: [STORE_A] }));
    expect(res.status).toBe(200);
    expect(authMock.setCustomUserClaims).toHaveBeenCalledWith('new-user-uid', {
      tenantId: TENANT_ID, role: 'CASHIER', storeIds: [STORE_A],
    });
  });

  it("refuse de créer un utilisateur sur un magasin hors de sa région", async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });
    const res = await POST(request({ ...baseUser(), role: 'CASHIER', storeIds: [STORE_B] }));
    expect(res.status).toBe(403);
    expect(authMock.createUser).not.toHaveBeenCalled();
  });

  it('refuse de créer un ADMIN', async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });
    const res = await POST(request({ ...baseUser(), role: 'ADMIN', storeIds: [STORE_A] }));
    expect(res.status).toBe(403);
    expect(authMock.createUser).not.toHaveBeenCalled();
  });

  it('refuse de créer un autre REGIONAL_MANAGER', async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'REGIONAL_MANAGER', storeIds: [STORE_A] });
    const res = await POST(request({ ...baseUser(), role: 'REGIONAL_MANAGER', storeIds: [STORE_A] }));
    expect(res.status).toBe(403);
  });

  it("refuse si l'appelant lui-même n'a aucun magasin (storeIds null)", async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'REGIONAL_MANAGER', storeIds: null });
    const res = await POST(request({ ...baseUser(), role: 'CASHIER', storeIds: [STORE_A] }));
    expect(res.status).toBe(403);
    expect(authMock.createUser).not.toHaveBeenCalled();
  });

  it('peut créer un MANAGER sur un sous-ensemble de ses magasins', async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'REGIONAL_MANAGER', storeIds: [STORE_A, STORE_B] });
    const res = await POST(request({ ...baseUser(), role: 'MANAGER', storeIds: [STORE_A] }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/users/create — OWNER/ADMIN (comportement existant, non régressé)', () => {
  beforeEach(() => {
    dbHolder.current = new FakeFirestore();
    seedStores(dbHolder.current);
    vi.clearAllMocks();
    authMock.createUser.mockResolvedValue({ uid: 'new-user-uid' });
  });

  it('un OWNER peut créer un ADMIN', async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'OWNER', storeIds: null });
    const res = await POST(request({ ...baseUser(), role: 'ADMIN' }));
    expect(res.status).toBe(200);
  });

  it('un ADMIN ne peut pas créer un autre ADMIN', async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'ADMIN', storeIds: null });
    const res = await POST(request({ ...baseUser(), role: 'ADMIN' }));
    expect(res.status).toBe(403);
  });

  it('un ADMIN peut créer un REGIONAL_MANAGER affecté à des magasins', async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'ADMIN', storeIds: null });
    const res = await POST(request({ ...baseUser(), role: 'REGIONAL_MANAGER', storeIds: [STORE_A, STORE_B] }));
    expect(res.status).toBe(200);
    expect(authMock.setCustomUserClaims).toHaveBeenCalledWith('new-user-uid', {
      tenantId: TENANT_ID, role: 'REGIONAL_MANAGER', storeIds: [STORE_A, STORE_B],
    });
  });

  it('refuse un REGIONAL_MANAGER sans magasin sélectionné', async () => {
    authMock.verifySessionCookie.mockResolvedValue({ tenantId: TENANT_ID, role: 'OWNER', storeIds: null });
    const res = await POST(request({ ...baseUser(), role: 'REGIONAL_MANAGER', storeIds: [] }));
    expect(res.status).toBe(400);
  });
});
