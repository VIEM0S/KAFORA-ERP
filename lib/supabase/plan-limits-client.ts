import { supabase } from '@/lib/supabase/client';
import { SUBSCRIPTION_PLANS, PlanId, PlanFeatureFlag } from '@/lib/constants';

type LimitedResource = 'maxUsers' | 'maxStores' | 'maxProducts' | 'maxCustomers';
type CountableTable = 'users' | 'stores' | 'products' | 'customers';

const RESOURCE_TO_TABLE: Record<LimitedResource, CountableTable> = {
  maxUsers: 'users',
  maxStores: 'stores',
  maxProducts: 'products',
  maxCustomers: 'customers',
};

const FEATURE_LABEL: Record<PlanFeatureFlag, string> = {
  analyticsEnabled: 'Analytics avancés',
  multiStoreEnabled: 'Multi-magasins',
};

/**
 * Équivalent client de lib/supabase/plan-limits.ts, pour les tables encore
 * créées directement depuis le navigateur (stores, products) plutôt que via une
 * route API. Donne un message d'erreur clair avant l'écriture.
 *
 * ⚠️ Ceci est une vérification UX, pas une frontière de sécurité : un utilisateur
 * technique peut toujours appeler Supabase directement en contournant l'UI. RLS
 * n'impose pas ces quotas aujourd'hui. Pour une garantie réelle, il faudra migrer
 * ces créations vers des routes API (comme users/create) ou ajouter une contrainte
 * vérifiable côté base (trigger).
 */
export async function checkPlanLimitClient(
  tenantId: string,
  resource: LimitedResource,
  count: number = 1
): Promise<{ allowed: true } | { allowed: false; reason: string; available: number }> {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const planId = sub?.plan as PlanId | undefined;
  const plan = planId && planId in SUBSCRIPTION_PLANS ? SUBSCRIPTION_PLANS[planId] : SUBSCRIPTION_PLANS.BUSINESS;
  const max = plan.features[resource];

  if (max === -1) return { allowed: true };

  const table = RESOURCE_TO_TABLE[resource];
  const { count: current } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  const currentCount = current ?? 0;
  const available = Math.max(0, max - currentCount);

  if (currentCount + count > max) {
    return {
      allowed: false,
      available,
      reason: available > 0
        ? `Le forfait ${plan.name} n'autorise que ${available} ${table} de plus (${max} au total). Réduis ta sélection ou passe à un forfait supérieur.`
        : `Limite du forfait ${plan.name} déjà atteinte (${max} ${table} max). Passe à un forfait supérieur pour continuer.`,
    };
  }
  return { allowed: true };
}

/**
 * Équivalent client de checkPlanFeature (lib/supabase/plan-limits.ts), même
 * caveat que checkPlanLimitClient ci-dessus : vérification UX, pas une
 * frontière de sécurité.
 */
export async function checkPlanFeatureClient(
  tenantId: string,
  feature: PlanFeatureFlag
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const planId = sub?.plan as PlanId | undefined;
  const plan = planId && planId in SUBSCRIPTION_PLANS ? SUBSCRIPTION_PLANS[planId] : SUBSCRIPTION_PLANS.BUSINESS;

  if (plan.features[feature]) return { allowed: true };

  return {
    allowed: false,
    reason: `${FEATURE_LABEL[feature]} n'est pas inclus dans le forfait ${plan.name}. Passe à un forfait supérieur pour en profiter.`,
  };
}
