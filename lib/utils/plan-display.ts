import { SUBSCRIPTION_PLANS, PlanId } from '@/lib/constants';

export const PLAN_ORDER: PlanId[] = ['STARTER', 'BUSINESS', 'ENTERPRISE'];

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

const PLAN_DESCRIPTION: Record<PlanId, string> = {
  STARTER: 'Pour les petites entreprises',
  BUSINESS: 'Pour les entreprises en croissance',
  ENTERPRISE: 'Pour les grandes structures',
};

const PLAN_CTA: Record<PlanId, string> = {
  STARTER: 'Commencer',
  BUSINESS: 'Commencer',
  ENTERPRISE: 'Nous contacter',
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
    description: PLAN_DESCRIPTION[planId],
    cta: PLAN_CTA[planId],
    popular: planId === 'BUSINESS',
    features: buildPlanFeatures(planId),
  };
}

export const PLAN_DISPLAY_LIST = PLAN_ORDER.map(getPlanDisplay);
