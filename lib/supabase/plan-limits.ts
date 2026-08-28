import { createServiceRoleClient } from '@/lib/supabase/server';
import { SUBSCRIPTION_PLANS, PlanId } from '@/lib/constants';

type LimitedResource = 'maxUsers' | 'maxStores' | 'maxProducts' | 'maxCustomers';
type CountableTable = 'users' | 'stores' | 'products' | 'customers';

const RESOURCE_TO_TABLE: Record<LimitedResource, CountableTable> = {
  maxUsers: 'users',
  maxStores: 'stores',
  maxProducts: 'products',
  maxCustomers: 'customers',
};

/**
 * Vérifie qu'un tenant n'a pas dépassé la limite de son forfait pour une ressource donnée
 * avant d'en créer une nouvelle occurrence. -1 = illimité (Enterprise).
 *
 * IMPORTANT : ce check ne protège que les créations qui passent par une route API
 * (service-role). Les tables encore créées directement depuis le client (stores,
 * products) doivent AUSSI être protégées par un check équivalent côté client — voir
 * lib/supabase/plan-limits-client.ts — mais un check client seul reste contournable
 * par un utilisateur technique qui appelle Supabase directement (même limite
 * qu'avec Firestore : RLS n'impose pas ces quotas aujourd'hui).
 */
export async function checkPlanLimit(
  tenantId: string,
  resource: LimitedResource
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const supabase = createServiceRoleClient();

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const planId = sub?.plan as PlanId | undefined;
  const plan = planId && planId in SUBSCRIPTION_PLANS ? SUBSCRIPTION_PLANS[planId] : SUBSCRIPTION_PLANS.BUSINESS;
  const max = plan.features[resource];

  if (max === -1) {
    return { allowed: true };
  }

  const table = RESOURCE_TO_TABLE[resource];
  const { count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  const current = count ?? 0;

  if (current >= max) {
    return {
      allowed: false,
      reason: `Limite du forfait ${plan.name} atteinte (${max} ${table} max). Passez à un forfait supérieur pour continuer.`,
    };
  }

  return { allowed: true };
}
