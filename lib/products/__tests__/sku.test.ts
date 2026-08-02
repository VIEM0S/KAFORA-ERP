import { describe, it, expect } from 'vitest';
import { skuKey, hasSku } from '@/lib/products/sku';

/**
 * La clé dérivée du SKU sert d'identifiant de document : c'est elle qui
 * fait office de contrainte d'unicité. Deux SKU que le commerçant considère
 * comme identiques DOIVENT produire la même clé, sinon il pourra créer deux
 * produits pour la même référence — et un scan tombera sur le mauvais.
 *
 * Le script scripts/backfill-sku-reservations.js contient une copie de cette
 * fonction : si l'une change, l'autre doit suivre, sans quoi les clés
 * divergent et le rattrapage devient inopérant.
 */

describe('clé de SKU', () => {
  it('ignore la casse', () => {
    expect(skuKey('abc-1')).toBe(skuKey('ABC-1'));
    expect(skuKey('AbC-1')).toBe(skuKey('aBc-1'));
  });

  it('ignore les espaces autour', () => {
    expect(skuKey('  REF-9 ')).toBe(skuKey('REF-9'));
  });

  it('remplace les caractères interdits dans un identifiant Firestore', () => {
    // Sans ça, un SKU parfaitement valide pour le commerçant ferait échouer
    // l'écriture avec une erreur incompréhensible.
    for (const bad of ['A/B', 'A.B', 'A#B', 'A$B', 'A[B', 'A]B']) {
      expect(skuKey(bad)).not.toContain(bad[1]);
      expect(skuKey(bad)).toBe('A_B');
    }
  });

  it('ne produit pas d\'identifiant encadré de doubles underscores', () => {
    // Firestore réserve cette forme pour ses propres documents.
    expect(skuKey('__x__')).not.toMatch(/^__.*__$/);
  });

  it('distingue des références réellement différentes', () => {
    expect(skuKey('REF-1')).not.toBe(skuKey('REF-2'));
    expect(skuKey('AB')).not.toBe(skuKey('A-B'));
  });
});

describe('SKU renseigné', () => {
  it('reconnaît une référence vide comme absente', () => {
    // Le champ est facultatif : un produit sans SKU ne réserve rien, sinon
    // le premier produit sans référence bloquerait tous les suivants.
    expect(hasSku('')).toBe(false);
    expect(hasSku('   ')).toBe(false);
    expect(hasSku(null)).toBe(false);
    expect(hasSku(undefined)).toBe(false);
  });

  it('reconnaît une référence renseignée', () => {
    expect(hasSku('REF-1')).toBe(true);
  });
});
