import { SUBSCRIPTION_PLANS, PlanId } from '@/lib/constants';

export const PLAN_ORDER: PlanId[] = ['STARTER', 'BUSINESS', 'ENTERPRISE'];

// Enterprise n'a pas de prix fixe affiché : les besoins (boutiques,
// utilisateurs, intégrations, formation) varient trop d'une entreprise à
// l'autre pour un tarif catalogue unique. SUBSCRIPTION_PLANS.ENTERPRISE.price
// reste néanmoins un vrai nombre en interne (utilisé comme référence par
// défaut dans la console admin lors de la saisie manuelle d'un paiement,
// voir app/api/admin/subscription/route.ts) — seul l'AFFICHAGE public change.
export const CUSTOM_PRICING_PLANS: PlanId[] = ['ENTERPRISE'];

const SUPPORT_LABEL: Record<PlanId, string> = {
  STARTER: 'Support email',
  BUSINESS: 'Support prioritaire',
  ENTERPRISE: 'Support dédié 24/7',
};

// Avantages purement marketing, sans équivalent en "feature flag" dans
// SUBSCRIPTION_PLANS (rien à activer/désactiver dans le code pour ceux-ci).
const EXTRA_PERKS: Record<PlanId, string[]> = {
  STARTER: ['Formation incluse'],
  BUSINESS: ['Formation incluse'],
  ENTERPRISE: ['Formation incluse'],
};

// Ancré uniquement dans des fonctionnalités réelles et déjà listées par
// buildPlanFeatures() ci-dessous : Business/Enterprise décrivent les deux
// fonctionnalités réellement verrouillées par forfait (voir
// lib/api/plan-guard.ts et components/subscription/plan-locked.tsx) —
// ce texte n'est plus une promesse sans verrou derrière.
const PLAN_DESCRIPTION: Record<PlanId, string> = {
  STARTER:
    "Pour une boutique unique : caisse, stock et suivi des crédits clients dans un seul outil, sans payer pour des fonctions dont vous n'avez pas encore besoin.",
  BUSINESS:
    'Pour les commerces à 2 boutiques ou plus : transférez du stock entre magasins et comparez leurs performances grâce aux Analytics avancés.',
  ENTERPRISE:
    'Pour les réseaux en expansion : aucune limite de boutiques, produits ou utilisateurs, avec un support dédié joignable en priorité.',
};

const PLAN_CTA: Record<PlanId, string> = {
  STARTER: 'Commencer',
  BUSINESS: 'Commencer',
  ENTERPRISE: 'Demander un devis',
};

/**
 * Génère la liste de puces marketing (ex: "3 magasins", "Analytics avancés")
 * à partir des limites/flags réels de SUBSCRIPTION_PLANS — source unique.
 * Utilisé par app/page.tsx (landing) et app/(onboarding)/setup/page.tsx pour
 * ne plus avoir 3-4 copies indépendantes de la même liste qui divergent.
 */
export function buildPlanFeatures(planId: PlanId): string[] {
  const f = SUBSCRIPTION_PLANS[planId].features;
  const list: string[] = [
    f.maxStores === -1 ? 'Magasins illimités' : `${f.maxStores} magasin${f.maxStores > 1 ? 's' : ''}`,
    f.maxUsers === -1 ? 'Utilisateurs illimités' : `${f.maxUsers} utilisateurs`,
    f.maxProducts === -1 ? 'Produits illimités' : `${f.maxProducts.toLocaleString('fr-FR')} produits`,
  ];
  if (f.posEnabled) list.push('POS inclus');
  if (f.analyticsEnabled) list.push('Analytics avancés');
  if (f.multiStoreEnabled) list.push('Multi-magasins');
  if (f.apiAccessEnabled) list.push('Accès API');
  list.push(...EXTRA_PERKS[planId]);
  list.push(SUPPORT_LABEL[planId]);
  return list;
}

export function getPlanDisplay(planId: PlanId) {
  return {
    id: planId,
    name: SUBSCRIPTION_PLANS[planId].name,
    price: SUBSCRIPTION_PLANS[planId].price,
    isCustomPricing: CUSTOM_PRICING_PLANS.includes(planId),
    description: PLAN_DESCRIPTION[planId],
    cta: PLAN_CTA[planId],
    popular: planId === 'BUSINESS',
    features: buildPlanFeatures(planId),
  };
}

export const PLAN_DISPLAY_LIST = PLAN_ORDER.map(getPlanDisplay);
