import type { PaymentProvider, PaymentProviderId } from './types';

/**
 * Registre des fournisseurs de paiement disponibles. Vide aujourd'hui —
 * voir le commentaire en tête de lib/payments/types.ts. Un vrai fournisseur
 * (Orabank ou autre) s'ajoutera ici via `registerProvider()` une fois son
 * implémentation écrite dans lib/payments/providers/, sans changer le code
 * appelant (qui ne connaît que l'interface `PaymentProvider`).
 */
const providers = new Map<PaymentProviderId, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  providers.set(provider.id, provider);
}

/** @throws si aucun fournisseur n'est enregistré sous cet id — vrai pour tous, aujourd'hui. */
export function getProvider(id: PaymentProviderId): PaymentProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`Fournisseur de paiement inconnu ou non configuré : "${id}"`);
  }
  return provider;
}

export function listRegisteredProviderIds(): PaymentProviderId[] {
  return [...providers.keys()];
}
