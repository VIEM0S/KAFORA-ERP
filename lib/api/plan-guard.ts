import { checkPlanFeature } from '@/lib/supabase/plan-limits';
import type { PlanFeatureFlag } from '@/lib/constants';

export interface PlanFeatureBlock {
  error: string;
  status: number;
}

/**
 * À appeler dans une route API après le contrôle de rôle. Contrairement à
 * checkSubscriptionAllows (lib/api/subscription-guard.ts, 402 = abonnement
 * expiré), ceci renvoie 403 : l'abonnement est valide et payé, mais le
 * forfait du tenant n'inclut simplement pas cette fonctionnalité.
 */
export async function checkPlanFeatureAllows(
  tenantId: string,
  feature: PlanFeatureFlag
): Promise<PlanFeatureBlock | null> {
  const result = await checkPlanFeature(tenantId, feature);
  if (result.allowed) return null;

  return { status: 403, error: result.reason };
}
