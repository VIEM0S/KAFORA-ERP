import { describe, it, expect } from 'vitest';
import {
  canTransitionTo,
  canApprove,
  canShip,
  resolveTransferSettings,
  DEFAULT_TRANSFER_SETTINGS,
} from '@/lib/transfers/rules';
import type { TransferStatus } from '@/lib/types';

/**
 * Les transitions d'état sont ce qui empêche le stock d'être compté deux
 * fois. Un transfert reçu deux fois crédite deux fois la destination ;
 * expédié deux fois, il débite deux fois la source.
 */

const ALL: TransferStatus[] = ['PENDING', 'APPROVED', 'SHIPPED', 'RECEIVED', 'REJECTED', 'CANCELLED'];

describe('transitions autorisées', () => {
  it('suit le parcours normal', () => {
    expect(canTransitionTo('PENDING', 'APPROVED')).toBe(true);
    expect(canTransitionTo('APPROVED', 'SHIPPED')).toBe(true);
    expect(canTransitionTo('SHIPPED', 'RECEIVED')).toBe(true);
  });

  it('interdit de recevoir deux fois', () => {
    // Le cas qui crédite le stock en double : deux clics, ou deux personnes
    // qui confirment la réception en même temps.
    expect(canTransitionTo('RECEIVED', 'RECEIVED')).toBe(false);
  });

  it('interdit d\'expédier deux fois', () => {
    expect(canTransitionTo('SHIPPED', 'SHIPPED')).toBe(false);
  });

  it('interdit d\'expédier sans validation préalable', () => {
    expect(canTransitionTo('PENDING', 'SHIPPED')).toBe(false);
  });

  it('interdit de rouvrir un transfert refusé ou annulé', () => {
    for (const target of ALL) {
      expect(canTransitionTo('REJECTED', target)).toBe(false);
      expect(canTransitionTo('CANCELLED', target)).toBe(false);
    }
  });

  it('interdit de recevoir un transfert jamais expédié', () => {
    expect(canTransitionTo('APPROVED', 'RECEIVED')).toBe(false);
    expect(canTransitionTo('PENDING', 'RECEIVED')).toBe(false);
  });

  it('permet d\'annuler tant que ce n\'est pas terminé', () => {
    expect(canTransitionTo('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransitionTo('APPROVED', 'CANCELLED')).toBe(true);
    // Après expédition aussi : le stock est alors rendu à la source
    // (voir app/api/transfers/decide).
    expect(canTransitionTo('SHIPPED', 'CANCELLED')).toBe(true);
  });

  it('n\'accepte plus rien depuis un état terminal', () => {
    for (const target of ALL) {
      expect(canTransitionTo('RECEIVED', target)).toBe(false);
    }
  });
});

describe('réglages par tenant', () => {
  it('sans approbation par défaut, pour ne pas alourdir les petits commerces', () => {
    expect(DEFAULT_TRANSFER_SETTINGS.requireApproval).toBe(false);
  });

  it('complète les champs manquants avec les valeurs par défaut', () => {
    const s = resolveTransferSettings({ requireApproval: true });
    expect(s.requireApproval).toBe(true);
    expect(s.approveRoles).toEqual(DEFAULT_TRANSFER_SETTINGS.approveRoles);
    expect(s.shipRoles).toEqual(DEFAULT_TRANSFER_SETTINGS.shipRoles);
  });

  it('ignore des listes de rôles vides plutôt que de bloquer tout le monde', () => {
    // Un réglage mal saisi ne doit pas rendre les transferts impossibles.
    const s = resolveTransferSettings({ approveRoles: [], shipRoles: [] });
    expect(s.approveRoles.length).toBeGreaterThan(0);
    expect(s.shipRoles.length).toBeGreaterThan(0);
  });
});

describe('permissions', () => {
  const restrictif = resolveTransferSettings({ approveRoles: ['ADMIN'], shipRoles: ['MANAGER'] });

  it('respecte les rôles configurés', () => {
    expect(canApprove('ADMIN', restrictif)).toBe(true);
    expect(canApprove('MANAGER', restrictif)).toBe(false);
    expect(canShip('MANAGER', restrictif)).toBe(true);
    expect(canShip('CASHIER', restrictif)).toBe(false);
  });

  it('le propriétaire garde toujours la main', () => {
    // Garde-fou : un réglage malheureux ne doit pas pouvoir enfermer le
    // patron hors de son propre outil.
    expect(canApprove('OWNER', restrictif)).toBe(true);
    expect(canShip('OWNER', restrictif)).toBe(true);
  });
});
