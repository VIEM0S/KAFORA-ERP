import { describe, it, expect } from 'vitest';
import {
  getExpiryDate, getSubscriptionState, canUsePos, canWrite, daysUntilFullBlock,
  GRACE_PERIOD_DAYS, type SubscriptionLike,
} from '../status';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-15T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY_MS).toISOString();

describe('getExpiryDate', () => {
  it('renvoie null pour un abonnement absent', () => {
    expect(getExpiryDate(null)).toBeNull();
    expect(getExpiryDate(undefined)).toBeNull();
  });

  it('TRIAL : priorise trialEndsAt sur currentPeriodEnd', () => {
    const sub: SubscriptionLike = { status: 'TRIAL', trialEndsAt: inDays(5), currentPeriodEnd: inDays(30) };
    expect(getExpiryDate(sub)?.toISOString()).toBe(inDays(5));
  });

  it('TRIAL sans trialEndsAt : se rabat sur currentPeriodEnd', () => {
    const sub: SubscriptionLike = { status: 'TRIAL', currentPeriodEnd: inDays(30) };
    expect(getExpiryDate(sub)?.toISOString()).toBe(inDays(30));
  });

  it('hors TRIAL : priorise currentPeriodEnd sur trialEndsAt', () => {
    const sub: SubscriptionLike = { status: 'ACTIVE', currentPeriodEnd: inDays(10), trialEndsAt: inDays(999) };
    expect(getExpiryDate(sub)?.toISOString()).toBe(inDays(10));
  });

  it('hors TRIAL sans currentPeriodEnd : se rabat sur trialEndsAt', () => {
    const sub: SubscriptionLike = { status: 'ACTIVE', trialEndsAt: inDays(10) };
    expect(getExpiryDate(sub)?.toISOString()).toBe(inDays(10));
  });

  it('accepte un objet Date directement, pas seulement une chaîne ISO', () => {
    const d = new Date(inDays(7));
    expect(getExpiryDate({ status: 'ACTIVE', currentPeriodEnd: d })?.getTime()).toBe(d.getTime());
  });

  it('renvoie null si aucune date exploitable (chaîne illisible)', () => {
    expect(getExpiryDate({ status: 'ACTIVE', currentPeriodEnd: 'pas-une-date' })).toBeNull();
  });
});

describe('getSubscriptionState', () => {
  it("aucun abonnement en base → ACTIVE (permissif, ancien tenant)", () => {
    expect(getSubscriptionState(null, NOW)).toBe('ACTIVE');
  });

  it('statut CANCELLED → EXPIRED même avec une date de fin future', () => {
    expect(getSubscriptionState({ status: 'CANCELLED', currentPeriodEnd: inDays(60) }, NOW)).toBe('EXPIRED');
  });

  it('statut EXPIRED (littéral) → EXPIRED même avec une date de fin future', () => {
    expect(getSubscriptionState({ status: 'EXPIRED', currentPeriodEnd: inDays(60) }, NOW)).toBe('EXPIRED');
  });

  it('aucune date exploitable → ACTIVE (donnée corrompue, on ne bloque pas)', () => {
    expect(getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: 'invalide' }, NOW)).toBe('ACTIVE');
  });

  it('avant échéance → ACTIVE', () => {
    expect(getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: inDays(1) }, NOW)).toBe('ACTIVE');
  });

  it("pile à l'échéance (égalité) → ACTIVE, pas encore GRACE", () => {
    expect(getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: NOW.toISOString() }, NOW)).toBe('ACTIVE');
  });

  it("juste après l'échéance → GRACE", () => {
    expect(getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: inDays(-0.001) }, NOW)).toBe('GRACE');
  });

  it(`pile à la fin de la tolérance (échéance + ${GRACE_PERIOD_DAYS}j, égalité) → encore GRACE`, () => {
    const expiry = inDays(-GRACE_PERIOD_DAYS);
    expect(getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: expiry }, NOW)).toBe('GRACE');
  });

  it('juste après la fin de la tolérance → EXPIRED', () => {
    const expiry = inDays(-GRACE_PERIOD_DAYS - 0.001);
    expect(getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: expiry }, NOW)).toBe('EXPIRED');
  });

  it('essai (TRIAL) expiré suit la même mécanique GRACE/EXPIRED', () => {
    expect(getSubscriptionState({ status: 'TRIAL', trialEndsAt: inDays(-1) }, NOW)).toBe('GRACE');
    expect(getSubscriptionState({ status: 'TRIAL', trialEndsAt: inDays(-30) }, NOW)).toBe('EXPIRED');
  });
});

describe('canUsePos / canWrite', () => {
  it('ACTIVE : tout autorisé', () => {
    expect(canUsePos('ACTIVE')).toBe(true);
    expect(canWrite('ACTIVE')).toBe(true);
  });

  it('GRACE : caisse autorisée, reste bloqué', () => {
    expect(canUsePos('GRACE')).toBe(true);
    expect(canWrite('GRACE')).toBe(false);
  });

  it('EXPIRED : tout bloqué', () => {
    expect(canUsePos('EXPIRED')).toBe(false);
    expect(canWrite('EXPIRED')).toBe(false);
  });
});

describe('daysUntilFullBlock', () => {
  it('aucun abonnement → null (rien à afficher)', () => {
    expect(daysUntilFullBlock(null, NOW)).toBeNull();
  });

  it(
    'régression : un abonnement CANCELLED avec date de fin future renvoie 0, ' +
    'pas le nombre de jours jusqu\'à cette date future',
    () => {
      // Avant le correctif, ce cas renvoyait ~67 (60 + 7 jours de tolérance)
      // alors que getSubscriptionState() considère déjà ce compte EXPIRED —
      // le bandeau aurait affiché "il vous reste 67 jours" à un commerçant
      // dont la caisse est en réalité déjà bloquée.
      expect(daysUntilFullBlock({ status: 'CANCELLED', currentPeriodEnd: inDays(60) }, NOW)).toBe(0);
    }
  );

  it('statut EXPIRED (littéral) avec date future → 0, même raison', () => {
    expect(daysUntilFullBlock({ status: 'EXPIRED', currentPeriodEnd: inDays(60) }, NOW)).toBe(0);
  });

  it('abonnement actif loin de l\'échéance : compte échéance + tolérance', () => {
    // Échéance dans 10 jours + 7 jours de tolérance = 17 jours avant blocage complet.
    expect(daysUntilFullBlock({ status: 'ACTIVE', currentPeriodEnd: inDays(10) }, NOW)).toBe(17);
  });

  it('en pleine tolérance : ne descend jamais sous 0', () => {
    expect(daysUntilFullBlock({ status: 'ACTIVE', currentPeriodEnd: inDays(-30) }, NOW)).toBe(0);
  });
});
