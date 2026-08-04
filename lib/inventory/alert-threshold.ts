/**
 * Seuil d'alerte de stock : règle unique, partagée par tous les écrans.
 *
 * Elle était réécrite à cinq endroits (inventaire, alertes, notifications,
 * en-tête, menu), avec deux défauts identiques partout :
 *
 * 1. Le seuil venait TOUJOURS du produit, alors que chaque magasin dispose
 *    déjà d'un `minQuantity` dans son inventaire. Une boutique qui écoule
 *    5 sacs par jour et un dépôt qui en écoule 50 recevaient donc la même
 *    alerte au même niveau — trop tôt pour l'un, trop tard pour l'autre.
 *
 * 2. `alertThreshold || 10` remplaçait un seuil de 0 par 10. Un commerçant
 *    qui mettait 0 pour NE PAS être alerté sur un article recevait quand
 *    même des alertes, sans comprendre pourquoi.
 */

/** Seuil par défaut quand rien n'est renseigné nulle part. */
export const SEUIL_ALERTE_DEFAUT = 10;

export interface SeuilSources {
  /** Seuil propre au magasin (champ `minQuantity` de la ligne d'inventaire). */
  seuilMagasin?: number | null;
  /** Seuil du produit, commun à tous les magasins. */
  seuilProduit?: number | null;
}

/**
 * Seuil applicable, du plus spécifique au plus général.
 *
 * On utilise `??` et non `||` : 0 est une valeur VOULUE (« ne pas alerter »),
 * pas une absence de valeur.
 */
export function seuilAlerte({ seuilMagasin, seuilProduit }: SeuilSources): number {
  if (typeof seuilMagasin === 'number') return seuilMagasin;
  if (typeof seuilProduit === 'number') return seuilProduit;
  return SEUIL_ALERTE_DEFAUT;
}

/**
 * Le stock est-il en alerte ?
 *
 * Un seuil à 0 signifie « jamais d'alerte » : sans cette exception, tout
 * article en rupture déclencherait une alerte même quand le commerçant a
 * explicitement demandé à ne pas en recevoir.
 */
export function estEnAlerte(quantite: number, sources: SeuilSources): boolean {
  const seuil = seuilAlerte(sources);
  if (seuil <= 0) return false;
  return quantite <= seuil;
}

/** Rupture totale : signalée quel que soit le seuil configuré. */
export function estEnRupture(quantite: number): boolean {
  return quantite <= 0;
}
