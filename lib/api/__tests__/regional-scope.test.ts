import { describe, it, expect } from 'vitest';
import { isSubsetOf } from '../regional-scope';

describe('isSubsetOf — cloisonnement REGIONAL_MANAGER', () => {
  it('accepte quand tous les magasins cibles sont dans les magasins autorisés', () => {
    expect(isSubsetOf(['a'], ['a', 'b', 'c'])).toBe(true);
    expect(isSubsetOf(['a', 'b'], ['a', 'b'])).toBe(true);
  });

  it("refuse dès qu'un seul magasin cible sort de la liste autorisée", () => {
    expect(isSubsetOf(['a', 'x'], ['a', 'b', 'c'])).toBe(false);
  });

  it('refuse un tableau cible vide ou absent — jamais "aucun magasin = tout autorisé"', () => {
    expect(isSubsetOf([], ['a', 'b'])).toBe(false);
    expect(isSubsetOf(null, ['a', 'b'])).toBe(false);
    expect(isSubsetOf(undefined, ['a', 'b'])).toBe(false);
  });

  it("refuse si l'appelant lui-même n'a aucun magasin (storeIds null/vide) — jamais un accès global implicite", () => {
    expect(isSubsetOf(['a'], null)).toBe(false);
    expect(isSubsetOf(['a'], [])).toBe(false);
    expect(isSubsetOf(['a'], undefined)).toBe(false);
  });
});
