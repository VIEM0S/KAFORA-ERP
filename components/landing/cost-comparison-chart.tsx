import { SUBSCRIPTION_PLANS } from '@/lib/constants';
import { PLAN_ORDER, CUSTOM_PRICING_PLANS } from '@/lib/utils/plan-display';
import { formatCurrency } from '@/lib/utils/helpers';

/**
 * Coût ramené à une seule journée d'activité — calculé directement depuis
 * SUBSCRIPTION_PLANS (même source que la page Tarifs), aucun chiffre
 * recopié à la main. Pas de comparaison à un concurrent ou à une estimation
 * de "coût sans logiciel" : on n'a aucune donnée fiable là-dessus, mieux
 * vaut ne rien avancer que d'inventer un chiffre présenté comme un fait.
 *
 * Remplace un graphique de coût CUMULÉ sur 5 ans (courbes qui montent
 * indéfiniment, chiffre final en millions) — repéré comme contre-productif
 * pour la conversion : ça ancre le prospect sur un engagement financier
 * qui fait peur, sans jamais montrer la valeur en face. Le prix par jour
 * reste vrai (même source, même calcul) mais se lit comme une petite
 * dépense récurrente plutôt qu'un passif qui grossit.
 *
 * Enterprise (CUSTOM_PRICING_PLANS) est exclu : "Sur devis" n'a pas de
 * montant fixe à ramener au jour.
 */
const CARD_PLAN_ORDER = PLAN_ORDER.filter((id) => !CUSTOM_PRICING_PLANS.includes(id));

const PLAN_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  SOLO: { bg: 'bg-purple-50', text: 'text-purple-700', ring: 'ring-purple-100' },
  STARTER: { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-100' },
  BUSINESS: { bg: 'bg-green-50', text: 'text-green-700', ring: 'ring-green-100' },
};

// 30 jours, pas 30,44 (moyenne calendaire) : un chiffre rond et facile à
// vérifier de tête vaut mieux qu'une fausse précision ici.
const DAYS_PER_MONTH = 30;

export function CostComparisonChart() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {CARD_PLAN_ORDER.map((planId) => {
        const plan = SUBSCRIPTION_PLANS[planId];
        const colors = PLAN_COLORS[planId];
        const perDay = Math.round(plan.price / DAYS_PER_MONTH);
        return (
          <div key={planId} className={`rounded-2xl p-5 text-center ring-1 ${colors.bg} ${colors.ring}`}>
            <p className="text-sm font-semibold text-gray-600 mb-2">{plan.name}</p>
            <p className={`text-3xl font-extrabold ${colors.text}`}>{formatCurrency(perDay)}</p>
            <p className="text-xs text-gray-500 mt-1">par jour</p>
            <p className="text-xs text-gray-400 mt-2">soit {formatCurrency(plan.price)}/mois</p>
          </div>
        );
      })}
    </div>
  );
}
