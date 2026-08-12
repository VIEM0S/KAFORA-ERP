/**
 * Pont entre la page Alertes stock et la création de bon de commande.
 *
 * Les deux pages ne partagent aucun état React (routes distinctes) : on
 * passe donc la suggestion de réappro par sessionStorage, le temps d'une
 * navigation. Clé et forme centralisées ici pour que les deux pages restent
 * d'accord sans dupliquer une chaîne magique.
 */

export const PO_REORDER_SUGGESTION_KEY = 'kafora:po-reorder-suggestion';

export interface ReorderSuggestionLine {
  productId: string;
  /** Quantité manquante pour repasser au-dessus du seuil d'alerte. */
  quantityOrdered: number;
}
