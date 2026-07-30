import { adminDb } from '@/lib/firebase/admin';
import {
  getSubscriptionState,
  canUsePos,
  canWrite,
  type SubscriptionState,
  type SubscriptionLike,
} from '@/lib/subscription/status';

/**
 * Lit l'abonnement d'un tenant et calcule son état.
 *
 * Le document a un ID déterministe (= tenantId, cf. app/api/auth/register),
 * donc une lecture directe suffit — pas de requête à filtrer.
 */
export async function getTenantSubscriptionState(tenantId: string): Promise<SubscriptionState> {
  try {
    const snap = await adminDb.doc(`tenants/${tenantId}/subscriptions/${tenantId}`).get();
    if (!snap.exists) {
      // Ancien tenant créé avant la mise en place des abonnements, ou
      // document supprimé : on laisse passer (cf. politique "fail open"
      // documentée dans lib/subscription/status.ts).
      return 'ACTIVE';
    }
    return getSubscriptionState(snap.data() as SubscriptionLike);
  } catch {
    // Firestore indisponible : ne jamais bloquer une caisse pour cette raison.
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
