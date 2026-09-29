/**
 * admin_extend_subscription() — RPC critique sans AUCUN test avant ce
 * fichier (trouvé lors de l'audit du 2026-09-29), alors que c'est
 * exactement la fonction où une vraie faille de privilège a été trouvée et
 * corrigée deux jours plus tôt (migration 077 : n'importe quel utilisateur
 * connecté pouvait l'appeler directement et prolonger gratuitement
 * l'abonnement de N'IMPORTE QUEL tenant). Elle porte aussi tout le système
 * de codes promo (migration 075) : 5 branches de rejet, un effet de bord
 * parrainage, et l'écriture comptable subscription_payments/
 * promo_code_redemptions.
 *
 * Parle au VRAI projet Supabase distant (pas à un Postgres local via
 * `supabase start`, contrairement à __tests__/rls/**) : ce poste de
 * développement n'a pas Docker installé, et cette RPC dépend de triggers/
 * données de configuration (SUBSCRIPTION_PLANS côté TS, limits jsonb)
 * qu'il serait fragile de reproduire fidèlement dans un schéma local
 * fraîchement reseedé. Chaque test crée son propre tenant/abonnement/code
 * promo jetables et les supprime — jamais de données d'un vrai client
 * touchées. Suite séparée de `npm test` (voir vitest.config.rpc.ts) :
 * lancée explicitement via `npm run test:rpc`, jamais en CI/dev courant.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !serviceKey || !anonKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY manquantes — ' +
    'lancer via `npm run test:rpc` (charge .env puis .env.test.local).'
  );
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Même limites que lib/constants/index.ts SUBSCRIPTION_PLANS.SOLO/STARTER —
// recopiées ici plutôt qu'importées : ce test doit rester valide même si le
// fichier TS change de forme, seule la RPC est sous test.
const LIMITS_BY_PLAN = {
  SOLO: { maxUsers: 1, maxStores: 1, maxProducts: 300, maxCustomers: 300, posEnabled: true, analyticsEnabled: false, multiStoreEnabled: false, apiAccessEnabled: false },
  STARTER: { maxUsers: 3, maxStores: 1, maxProducts: 1000, maxCustomers: 1000, posEnabled: true, analyticsEnabled: false, multiStoreEnabled: false, apiAccessEnabled: false },
};
const REFERRER_BONUS_DAYS = 15;

async function createTestTenant(suffix: string) {
  const { data: tenant, error: tErr } = await admin
    .from('tenants')
    .insert({ name: `RPC Test ${suffix}`, slug: `rpc-test-${suffix}-${Date.now()}`, email: `rpc-test-${suffix}@example.com` })
    .select('id')
    .single();
  if (tErr) throw tErr;
  const { error: sErr } = await admin
    .from('subscriptions')
    .insert({ tenant_id: tenant.id, plan: 'STARTER', status: 'TRIAL', current_period_end: new Date(Date.now() + 86_400_000).toISOString() });
  if (sErr) throw sErr;
  return tenant.id as string;
}

async function deleteTestTenant(tenantId: string) {
  await admin.from('tenants').delete().eq('id', tenantId);
}

async function createPromoCode(overrides: {
  code: string; discountType?: 'PERCENT' | 'FIXED'; discountValue?: number;
  applicablePlans?: string[] | null; maxRedemptions?: number | null;
  validFrom?: string; validUntil?: string | null; isActive?: boolean;
}) {
  const { data, error } = await admin
    .from('promo_codes')
    .insert({
      code: overrides.code,
      discount_type: overrides.discountType ?? 'PERCENT',
      discount_value: overrides.discountValue ?? 50,
      applicable_plans: overrides.applicablePlans ?? null,
      max_redemptions: overrides.maxRedemptions ?? null,
      valid_from: overrides.validFrom ?? new Date(Date.now() - 86_400_000).toISOString(),
      valid_until: overrides.validUntil ?? null,
      is_active: overrides.isActive ?? true,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function callRpc(params: Record<string, unknown>) {
  return admin.rpc('admin_extend_subscription', {
    p_months: 1,
    p_method: 'TEST',
    p_note: 'test:rpc',
    p_performed_by: null,
    p_referrer_bonus_days: REFERRER_BONUS_DAYS,
    p_limits_by_plan: LIMITS_BY_PLAN,
    p_promo_code_id: null,
    p_catalog_price: null,
    ...params,
  });
}

let tenantId: string;
let cleanupPromoIds: string[] = [];

beforeEach(async () => {
  tenantId = await createTestTenant(Math.random().toString(36).slice(2, 8));
  cleanupPromoIds = [];
});

afterEach(async () => {
  await deleteTestTenant(tenantId);
  for (const id of cleanupPromoIds) {
    await admin.from('promo_code_redemptions').delete().eq('promo_code_id', id);
    await admin.from('promo_codes').delete().eq('id', id);
  }
});

describe('admin_extend_subscription — chemin normal', () => {
  it('prolonge l\'abonnement et écrit subscription_payments, sans code promo', async () => {
    const { data, error } = await callRpc({ p_tenant_id: tenantId, p_plan: 'SOLO', p_amount: 8000 });
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true, plan: 'SOLO' });

    const { data: sub } = await admin.from('subscriptions').select('plan, status').eq('tenant_id', tenantId).single();
    expect(sub?.plan).toBe('SOLO');
    expect(sub?.status).toBe('ACTIVE');

    const { data: payments } = await admin.from('subscription_payments').select('amount, plan').eq('tenant_id', tenantId);
    expect(payments).toHaveLength(1);
    expect(payments?.[0]).toMatchObject({ amount: 8000, plan: 'SOLO' });
  });

  it('NOT_FOUND si le tenant n\'a pas de ligne subscriptions', async () => {
    const { data: orphanTenant } = await admin.from('tenants').insert({
      name: 'Sans abonnement', slug: `rpc-test-orphan-${Date.now()}`, email: 'orphan@example.com',
    }).select('id').single();
    const { error } = await callRpc({ p_tenant_id: orphanTenant!.id, p_plan: 'SOLO', p_amount: 8000 });
    expect(error?.message).toMatch(/NOT_FOUND/);
    await admin.from('tenants').delete().eq('id', orphanTenant!.id);
  });
});

describe('admin_extend_subscription — codes promo (5 branches de rejet)', () => {
  it('applique un code valide : trace la remise et incrémente times_redeemed', async () => {
    const promoId = await createPromoCode({ code: `RPC-OK-${Date.now()}`, applicablePlans: ['SOLO'], maxRedemptions: 1 });
    cleanupPromoIds.push(promoId);

    const { data, error } = await callRpc({
      p_tenant_id: tenantId, p_plan: 'SOLO', p_amount: 4000,
      p_promo_code_id: promoId, p_catalog_price: 8000,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true });

    const { data: promo } = await admin.from('promo_codes').select('times_redeemed').eq('id', promoId).single();
    expect(promo?.times_redeemed).toBe(1);

    const { data: redemptions } = await admin.from('promo_code_redemptions').select('discount_amount, tenant_id').eq('promo_code_id', promoId);
    expect(redemptions).toHaveLength(1);
    expect(redemptions?.[0]).toMatchObject({ discount_amount: 4000, tenant_id: tenantId });
  });

  it('rejette un code déjà au plafond de rédemptions', async () => {
    const promoId = await createPromoCode({ code: `RPC-MAXED-${Date.now()}`, maxRedemptions: 1 });
    cleanupPromoIds.push(promoId);
    await callRpc({ p_tenant_id: tenantId, p_plan: 'SOLO', p_amount: 8000, p_promo_code_id: promoId });

    const secondTenant = await createTestTenant(`${Math.random().toString(36).slice(2, 8)}-b`);
    const { error } = await callRpc({ p_tenant_id: secondTenant, p_plan: 'SOLO', p_amount: 8000, p_promo_code_id: promoId });
    expect(error?.message).toMatch(/INVALID_PROMO/);
    await deleteTestTenant(secondTenant);
  });

  it('rejette un code expiré (valid_until dans le passé)', async () => {
    const promoId = await createPromoCode({ code: `RPC-EXPIRED-${Date.now()}`, validUntil: new Date(Date.now() - 3600_000).toISOString() });
    cleanupPromoIds.push(promoId);
    const { error } = await callRpc({ p_tenant_id: tenantId, p_plan: 'SOLO', p_amount: 8000, p_promo_code_id: promoId });
    expect(error?.message).toMatch(/INVALID_PROMO/);
  });

  it('rejette un code pas encore actif (valid_from dans le futur)', async () => {
    const promoId = await createPromoCode({ code: `RPC-FUTURE-${Date.now()}`, validFrom: new Date(Date.now() + 3600_000).toISOString() });
    cleanupPromoIds.push(promoId);
    const { error } = await callRpc({ p_tenant_id: tenantId, p_plan: 'SOLO', p_amount: 8000, p_promo_code_id: promoId });
    expect(error?.message).toMatch(/INVALID_PROMO/);
  });

  it('rejette un code inapplicable au forfait choisi', async () => {
    const promoId = await createPromoCode({ code: `RPC-WRONGPLAN-${Date.now()}`, applicablePlans: ['BUSINESS'] });
    cleanupPromoIds.push(promoId);
    const { error } = await callRpc({ p_tenant_id: tenantId, p_plan: 'SOLO', p_amount: 8000, p_promo_code_id: promoId });
    expect(error?.message).toMatch(/INVALID_PROMO/);
  });

  it('rejette un p_promo_code_id inexistant', async () => {
    const { error } = await callRpc({
      p_tenant_id: tenantId, p_plan: 'SOLO', p_amount: 8000,
      p_promo_code_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error?.message).toMatch(/INVALID_PROMO/);
  });
});

describe('admin_extend_subscription — verrou de permission (régression migration 077)', () => {
  it('un appel authentifié/anonyme direct (sans passer par la route admin) est refusé', async () => {
    const { error } = await anon.rpc('admin_extend_subscription', {
      p_tenant_id: tenantId, p_months: 1, p_plan: 'SOLO', p_amount: 0,
      p_method: 'TEST', p_note: 'should be blocked', p_performed_by: null,
      p_referrer_bonus_days: REFERRER_BONUS_DAYS, p_limits_by_plan: LIMITS_BY_PLAN,
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/permission denied/);
  });
});
