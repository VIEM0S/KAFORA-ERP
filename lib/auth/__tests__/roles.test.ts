import { describe, it, expect } from 'vitest';
import { isSuperAdmin, isOwnerOrAdmin, isManagerPlus } from '@/lib/auth/roles';

/**
 * Ces helpers ont été créés après un bug réel : les contrôles de rôle
 * étaient écrits en dur (`['OWNER','ADMIN','MANAGER'].includes(...)`) à huit
 * endroits, et SUPER_ADMIN n'apparaissait dans aucune liste. Se promouvoir
 * faisait perdre le tableau de bord, la caisse et la gestion des utilisateurs.
 *
 * Ces tests existent pour que ce cas ne repasse pas inaperçu.
 */

describe('rôle éditeur', () => {
  it('est reconnu', () => {
    expect(isSuperAdmin('SUPER_ADMIN')).toBe(true);
    expect(isSuperAdmin('OWNER')).toBe(false);
  });

  it('couvre tous les autres niveaux', () => {
    // Le point précis qui manquait.
    expect(isOwnerOrAdmin('SUPER_ADMIN')).toBe(true);
    expect(isManagerPlus('SUPER_ADMIN')).toBe(true);
  });
});

describe('propriétaire ou administrateur', () => {
  it('accepte les rôles de direction', () => {
    expect(isOwnerOrAdmin('OWNER')).toBe(true);
    expect(isOwnerOrAdmin('ADMIN')).toBe(true);
  });

  it('refuse les rôles opérationnels', () => {
    expect(isOwnerOrAdmin('MANAGER')).toBe(false);
    expect(isOwnerOrAdmin('CASHIER')).toBe(false);
  });
});

describe('responsable et au-dessus', () => {
  it('inclut le responsable', () => {
    expect(isManagerPlus('MANAGER')).toBe(true);
    expect(isManagerPlus('OWNER')).toBe(true);
  });

  it('exclut le caissier', () => {
    // Distinction essentielle en boutique : le caissier ne doit pas voir
    // les prix d'achat ni les marges.
    expect(isManagerPlus('CASHIER')).toBe(false);
  });
});

describe('valeurs absentes', () => {
  it('ne donne aucun droit', () => {
    // Un rôle manquant ne doit jamais ouvrir un accès par défaut.
    for (const v of [null, undefined, '', 'INCONNU']) {
      expect(isSuperAdmin(v)).toBe(false);
      expect(isOwnerOrAdmin(v)).toBe(false);
      expect(isManagerPlus(v)).toBe(false);
    }
  });
});
