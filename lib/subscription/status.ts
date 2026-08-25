/**
 * Source unique de vérité pour l'état d'un abonnement.
 *
 * Utilisé par le serveur (routes API), par le client (bandeau d'alerte) et
 * répliqué dans firestore.rules — les trois doivent raconter exactement la
 * même histoire, sinon un utilisateur voit "il vous reste 3 jours" pendant
 * que le serveur refuse déjà ses écritures.
 *
 * Règle produit retenue :
 *   - jusqu'à l'échéance ................ tout fonctionne (ACTIVE)
 *   - échéance dépassée, < 3 jours ...... lecture seule SAUF le POS (GRACE)
 *   - au-delà de 3 jours ................ lecture seule totale (EXPIRED)
 *
 * On ne coupe jamais complètement l'accès : le commerçant doit toujours
 * pouvoir consulter son stock, ses ventes passées et ses créances clients,
 * même s'il n'a pas payé. Bloquer la lecture de ses propres données serait
 * disproportionné (et un très mauvais argument commercial).
 */

/** Nombre de jours pendant lesquels la caisse continue de fonctionner. */
export const GRACE_PERIOD_DAYS = 3;

export type SubscriptionState = 'ACTIVE' | 'GRACE' | 'EXPIRED';

/** Forme minimale attendue — volontairement permissive : les documents
 *  existants en base peuvent avoir des champs manquants ou des dates
 *  stockées en ISO string (register) plutôt qu'en Timestamp. */
export interface SubscriptionLike {
  status?: string | null;
  trialEndsAt?: string | Date | null;
  currentPeriodEnd?: string | Date | null;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Date à laquelle l'accès complet prend fin.
 * Pour un essai c'est `trialEndsAt`, sinon la fin de période payée.
 */
export function getExpiryDate(sub: SubscriptionLike | null | undefined): Date | null {
  if (!sub) return null;
  if (sub.status === 'TRIAL') {
    return toDate(sub.trialEndsAt) ?? toDate(sub.currentPeriodEnd);
  }
  return toDate(sub.currentPeriodEnd) ?? toDate(sub.trialEndsAt);
}

/**
 * Calcule l'état courant.
 *
 * IMPORTANT — on échoue en mode permissif : abonnement introuvable, date
 * illisible ou champ manquant ⇒ ACTIVE. Verrouiller la caisse d'un commerce
 * à cause d'une donnée corrompue coûterait bien plus cher (ventes perdues,
 * confiance perdue) que de laisser quelques jours gratuits en trop. Un cas
 * douteux doit remonter en alerte, pas bloquer une boutique.
 */
export function getSubscriptionState(
  sub: SubscriptionLike | null | undefined,
  now: Date = new Date()
): SubscriptionState {
  if (!sub) return 'ACTIVE';

  // Statuts explicitement révoqués par l'éditeur : on respecte la décision,
  // mais on reste en lecture seule (jamais de coupure totale).
  if (sub.status === 'CANCELLED' || sub.status === 'EXPIRED') return 'EXPIRED';

  const expiry = getExpiryDate(sub);
  if (!expiry) return 'ACTIVE';

  if (now <= expiry) return 'ACTIVE';

  const graceEnd = new Date(expiry.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return now <= graceEnd ? 'GRACE' : 'EXPIRED';
}

/** Le POS reste utilisable pendant la période de tolérance. */
export function canUsePos(state: SubscriptionState): boolean {
  return state === 'ACTIVE' || state === 'GRACE';
}

/** Toute autre écriture (produits, clients, utilisateurs, achats…). */
export function canWrite(state: SubscriptionState): boolean {
  return state === 'ACTIVE';
}

/**
 * Jours restants avant blocage complet — pour le bandeau d'alerte.
 *
 * Fix : ignorait le statut explicite CANCELLED/EXPIRED et calculait
 * uniquement à partir de currentPeriodEnd. Un abonnement résilié avec une
 * date de fin de période encore future (ex. résiliation en cours de mois
 * déjà payé) affichait "il vous reste 60 jours" alors que
 * getSubscriptionState() le considère déjà EXPIRED (écritures bloquées) —
 * les deux fonctions doivent raconter la même histoire, comme documenté
 * en tête de fichier.
 */
export function daysUntilFullBlock(
  sub: SubscriptionLike | null | undefined,
  now: Date = new Date()
): number | null {
  if (sub && (sub.status === 'CANCELLED' || sub.status === 'EXPIRED')) return 0;
  const expiry = getExpiryDate(sub);
  if (!expiry) return null;
  const graceEnd = new Date(expiry.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}
