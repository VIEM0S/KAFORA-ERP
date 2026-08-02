import { describe, it, expect } from 'vitest';
import {
  getSubscriptionState,
  canUsePos,
  canWrite,
  daysUntilFullBlock,
  GRACE_PERIOD_DAYS,
} from '@/lib/subscription/status';

/**
 * Ces règles décident si un commerce peut encore encaisser. Une erreur ici
 * coupe la caisse d'un client — ou lui offre le service indéfiniment.
 */

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const iso = (n: number) => days(n).toISOString();

describe("état d'un abonnement", () => {
  it('est actif avant la date d\'échéance', () => {
    expect(getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: iso(5) })).toBe('ACTIVE');
  });

  it("passe en tolérance juste après l'échéance", () => {
    expect(getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: iso(-1) })).toBe('GRACE');
  });

  it('reste en tolérance jusqu\'au dernier jour du délai', () => {
    expect(
      getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: iso(-(GRACE_PERIOD_DAYS - 1)) })
    ).toBe('GRACE');
  });

  it('expire une fois le délai de tolérance dépassé', () => {
    expect(
      getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: iso(-(GRACE_PERIOD_DAYS + 1)) })
    ).toBe('EXPIRED');
  });

  it("utilise trialEndsAt pendant la période d'essai", () => {
    expect(getSubscriptionState({ status: 'TRIAL', trialEndsAt: iso(3) })).toBe('ACTIVE');
    expect(getSubscriptionState({ status: 'TRIAL', trialEndsAt: iso(-30) })).toBe('EXPIRED');
  });

  it('respecte une résiliation explicite, même si la date est future', () => {
    expect(getSubscriptionState({ status: 'CANCELLED', currentPeriodEnd: iso(30) })).toBe('EXPIRED');
  });

  // ── Politique permissive : documentée dans lib/subscription/status.ts ──
  // Bloquer la caisse d'un commerce à cause d'une donnée manquante coûte
  // plus cher que quelques jours offerts. Ces cas DOIVENT rester passants.
  it('laisse passer quand aucun abonnement n\'existe', () => {
    expect(getSubscriptionState(null)).toBe('ACTIVE');
    expect(getSubscriptionState(undefined)).toBe('ACTIVE');
  });

  it('laisse passer quand la date est absente ou illisible', () => {
    expect(getSubscriptionState({ status: 'ACTIVE' })).toBe('ACTIVE');
    expect(getSubscriptionState({ status: 'ACTIVE', currentPeriodEnd: 'pas-une-date' })).toBe('ACTIVE');
  });
});

describe('droits selon l\'état', () => {
  it('autorise tout quand l\'abonnement est à jour', () => {
    expect(canUsePos('ACTIVE')).toBe(true);
    expect(canWrite('ACTIVE')).toBe(true);
  });

  it('pendant la tolérance : la caisse fonctionne, le reste est en lecture seule', () => {
    // C'est le compromis retenu : un commerce ne doit pas s'arrêter de
    // vendre du jour au lendemain, mais il ne doit plus créer de données.
    expect(canUsePos('GRACE')).toBe(true);
    expect(canWrite('GRACE')).toBe(false);
  });

  it('bloque tout une fois expiré', () => {
    expect(canUsePos('EXPIRED')).toBe(false);
    expect(canWrite('EXPIRED')).toBe(false);
  });
});

describe('jours restants avant blocage', () => {
  it('compte le délai de tolérance en plus de l\'échéance', () => {
    const left = daysUntilFullBlock({ status: 'ACTIVE', currentPeriodEnd: iso(0) });
    expect(left).toBeGreaterThanOrEqual(GRACE_PERIOD_DAYS - 1);
    expect(left).toBeLessThanOrEqual(GRACE_PERIOD_DAYS);
  });

  it('ne descend jamais sous zéro', () => {
    expect(daysUntilFullBlock({ status: 'ACTIVE', currentPeriodEnd: iso(-90) })).toBe(0);
  });

  it('renvoie null sans date exploitable', () => {
    expect(daysUntilFullBlock({ status: 'ACTIVE' })).toBeNull();
  });
});
