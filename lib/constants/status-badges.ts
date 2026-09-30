// Libellés/couleurs de statut CREDIT et QUOTE — source unique.
//
// Avant : chaque écran qui affiche un badge de statut (credits, quotes,
// invoices, customers/[id]) redéfinissait sa propre copie de ces mêmes
// tableaux. En pratique, les 3 copies de QUOTE_STATUS étaient identiques
// (aucune vraie divergence de libellé), mais CREDIT_STATUS dans
// customers/[id]/page.tsx avait oublié WRITTEN_OFF — un crédit passé en
// perte y retombait silencieusement sur le libellé "En cours" (le fallback
// PENDING), alors que credits/page.tsx l'affichait correctement comme
// "Annulé". Trouvé lors de l'audit de dette technique du 2026-09-29/30.
//
// Volontairement sans icône : certains écrans en affichent une à côté du
// badge (credits/page.tsx, quotes/page.tsx), d'autres non (invoices,
// customers/[id]) — chacun garde son propre petit tableau d'icônes local
// plutôt que de forcer ce fichier de constantes (jamais un point d'import
// de composants ailleurs dans lib/constants) à dépendre de lucide-react.

export const CREDIT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING:        { label: 'En cours',  color: 'bg-amber-100 text-amber-700' },
  PARTIALLY_PAID: { label: 'Partiel',   color: 'bg-blue-100 text-blue-700' },
  PAID:           { label: 'Soldé',     color: 'bg-green-100 text-green-700' },
  OVERDUE:        { label: 'En retard', color: 'bg-red-100 text-red-700' },
  WRITTEN_OFF:    { label: 'Annulé',    color: 'bg-gray-100 text-gray-600' },
};

export const QUOTE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING:   { label: 'En attente', color: 'bg-amber-100 text-amber-700' },
  ACCEPTED:  { label: 'Accepté',    color: 'bg-blue-100 text-blue-700' },
  CONVERTED: { label: 'Converti',   color: 'bg-green-100 text-green-700' },
  REFUSED:   { label: 'Refusé',     color: 'bg-red-100 text-red-700' },
  EXPIRED:   { label: 'Expiré',     color: 'bg-gray-100 text-gray-500' },
};
