import { describe, it, expect } from 'vitest';
import {
  seuilAlerte,
  estEnAlerte,
  estEnRupture,
  SEUIL_ALERTE_DEFAUT,
} from '@/lib/inventory/alert-threshold';

/**
 * Seuil d'alerte de stock.
 *
 * Deux défauts corrigés, tous deux reproduits ici pour qu'ils ne
 * reviennent pas :
 *
 * 1. Le seuil venait toujours du produit, jamais du magasin. Une boutique
 *    écoulant 5 sacs par jour et un dépôt en écoulant 50 recevaient la même
 *    alerte au même niveau.
 *
 * 2. `alertThreshold || 10` transformait un seuil de 0 en 10 : impossible de
 *    désactiver l'alerte d'un article.
 */

describe('choix du seuil', () => {
  it('privilégie le seuil du magasin', () => {
    expect(seuilAlerte({ seuilMagasin: 3, seuilProduit: 20 })).toBe(3);
  });

  it('retombe sur le seuil du produit quand le magasin n\'en a pas', () => {
    expect(seuilAlerte({ seuilMagasin: null, seuilProduit: 20 })).toBe(20);
    expect(seuilAlerte({ seuilProduit: 20 })).toBe(20);
  });

  it('applique le défaut quand rien n\'est renseigné', () => {
    expect(seuilAlerte({})).toBe(SEUIL_ALERTE_DEFAUT);
    expect(seuilAlerte({ seuilMagasin: null, seuilProduit: null })).toBe(SEUIL_ALERTE_DEFAUT);
  });

  it('respecte un seuil de 0 au lieu de le remplacer par le défaut', () => {
    // Le défaut d'origine : `0 || 10` valait 10.
    expect(seuilAlerte({ seuilMagasin: 0, seuilProduit: 20 })).toBe(0);
    expect(seuilAlerte({ seuilProduit: 0 })).toBe(0);
  });
});

describe('déclenchement de l\'alerte', () => {
  it('alerte au seuil et en dessous', () => {
    expect(estEnAlerte(5, { seuilProduit: 10 })).toBe(true);
    expect(estEnAlerte(10, { seuilProduit: 10 })).toBe(true);
  });

  it('n\'alerte pas au-dessus du seuil', () => {
    expect(estEnAlerte(11, { seuilProduit: 10 })).toBe(false);
  });

  it('n\'alerte JAMAIS quand le seuil est à 0', () => {
    // 0 veut dire « ne pas me prévenir pour cet article » : même une rupture
    // ne doit pas déclencher d'alerte, sinon le réglage ne sert à rien.
    expect(estEnAlerte(0, { seuilProduit: 0 })).toBe(false);
    expect(estEnAlerte(0, { seuilMagasin: 0, seuilProduit: 50 })).toBe(false);
  });

  it('applique un seuil de magasin plus bas qu\'au produit', () => {
    // Petite boutique : seuil 3, alors que le produit est réglé sur 20.
    expect(estEnAlerte(5, { seuilMagasin: 3, seuilProduit: 20 })).toBe(false);
    expect(estEnAlerte(3, { seuilMagasin: 3, seuilProduit: 20 })).toBe(true);
  });

  it('applique un seuil de magasin plus haut qu\'au produit', () => {
    // Dépôt à forte rotation : seuil 100, produit réglé sur 10.
    expect(estEnAlerte(50, { seuilMagasin: 100, seuilProduit: 10 })).toBe(true);
  });
});

describe('rupture de stock', () => {
  it('est signalée à zéro et en négatif', () => {
    // Le stock peut passer en négatif après une synchronisation hors-ligne.
    expect(estEnRupture(0)).toBe(true);
    expect(estEnRupture(-3)).toBe(true);
  });

  it('n\'est pas signalée avec du stock disponible', () => {
    expect(estEnRupture(1)).toBe(false);
  });
});
