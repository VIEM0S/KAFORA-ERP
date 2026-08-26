import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getSubscriptionState,
  canUsePos,
  canWrite,
  type SubscriptionState,
  type SubscriptionLike,
} from '@/lib/subscription/status';

/**
 * Lit l'abonnement d'un tenant et calcule son état.
 */
export async function getTenantSubscriptionState(tenantId: string): Promise<SubscriptionState> {
  try {
    const supabase = createServiceRoleClient();
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status, trial_ends_at, current_period_end')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!sub) {
      // Ancien tenant créé avant la mise en place des abonnements, ou
      // ligne supprimée : on laisse passer (cf. politique "fail open"
      // documentée dans lib/subscription/status.ts).
      return 'ACTIVE';
    }
    const subLike: SubscriptionLike = {
      status: sub.status,
      trialEndsAt: sub.trial_ends_at,
      currentPeriodEnd: sub.current_period_end,
    };
    return getSubscriptionState(subLike);
  } catch {
    // Base indisponible : ne jamais bloquer une caisse pour cette raison.
    return 'ACTIVE';
  }
}

export interface SubscriptionBlock {
  error: string;
  status: number;
  state: SubscriptionState;
}

/**
 * À appeler dans une route API après avoir vérifié l'authentification.
 * Renvoie `null` si l'action est autorisée, sinon de quoi construire la
 * réponse d'erreur.
 *
 * `kind: 'pos'` = encaissement (toléré pendant la période de grâce).
 * `kind: 'write'` = toute autre écriture métier.
 *
 * Code HTTP 402 (Payment Required) : distinct de 401 (pas connecté) et de
 * 403 (droits insuffisants) pour que le client puisse afficher le bon
 * message — "votre abonnement a expiré" et non "accès refusé".
 */
export async function checkSubscriptionAllows(
  tenantId: string,
  kind: 'pos' | 'write'
): Promise<SubscriptionBlock | null> {
  const state = await getTenantSubscriptionState(tenantId);
  const allowed = kind === 'pos' ? canUsePos(state) : canWrite(state);
  if (allowed) return null;

  return {
    state,
    status: 402,
    error:
      kind === 'pos'
        ? "Votre abonnement Kafora a expiré. Les ventes sont suspendues — régularisez votre abonnement pour reprendre l'encaissement."
        : "Votre abonnement Kafora a expiré. Vous pouvez toujours consulter vos données, mais les modifications sont suspendues jusqu'au règlement.",
  };
}
