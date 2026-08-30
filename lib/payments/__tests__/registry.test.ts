import { describe, it, expect } from 'vitest';
import { registerProvider, getProvider, listRegisteredProviderIds } from '../registry';
import type { PaymentProvider } from '../types';

describe('lib/payments/registry', () => {
  it('a aucun fournisseur enregistré par défaut (rien n\'est branché aujourd\'hui)', () => {
    // Reflète l'état réel du produit : aucune intégration de paiement en
    // ligne n'existe encore (voir commentaire de lib/payments/types.ts).
    expect(listRegisteredProviderIds()).not.toContain('orabank');
  });

  it("getProvider lève une erreur claire pour un fournisseur non enregistré", () => {
    expect(() => getProvider('orabank')).toThrow(/orabank/);
  });

  it('registerProvider puis getProvider retourne la même implémentation', () => {
    const fake: PaymentProvider = {
      id: 'test-provider',
      async createPayment() {
        return { providerPaymentId: 'p1', status: 'PENDING' };
      },
      async checkPayment() {
        return { status: 'SUCCEEDED', amount: 1000 };
      },
      async refundPayment() {
        return { status: 'REFUNDED', refundedAmount: 1000 };
      },
      async handleWebhook() {
        return null;
      },
    };
    registerProvider(fake);
    expect(getProvider('test-provider')).toBe(fake);
    expect(listRegisteredProviderIds()).toContain('test-provider');
  });
});
