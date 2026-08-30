/**
 * Abstraction pour les fournisseurs de paiement — préparation technique
 * uniquement, RIEN N'EST BRANCHÉ AUJOURD'HUI.
 *
 * Contexte : une agente Orabank Mali a évoqué une API de paiement bancaire
 * possible (notamment pour automatiser le règlement des abonnements
 * Kafora), mais rien n'est officiellement disponible ni testé à ce jour.
 * Cette interface évite de coupler tout le système à un seul fournisseur
 * quand une intégration deviendra réellement opérationnelle — Orabank,
 * Orange Money, Wave ou un autre. Tant qu'aucun `PaymentProvider` n'est
 * enregistré dans lib/payments/registry.ts, ce module n'a aucun effet sur
 * l'application : le règlement des abonnements Kafora reste manuel (voir
 * app/api/admin/subscription/route.ts).
 *
 * Ne PAS présenter cette abstraction sur la landing page comme une
 * fonctionnalité disponible — c'est une préparation d'architecture, pas un
 * paiement en ligne fonctionnel.
 */

export type PaymentProviderId = 'orabank' | 'orange_money' | 'wave' | (string & {});

export interface CreatePaymentInput {
  /** Tenant Kafora pour lequel le paiement est effectué. */
  tenantId: string;
  /** Montant en FCFA (entier, pas de centimes). */
  amount: number;
  currency: 'XOF';
  /** Libellé lisible affiché côté fournisseur (ex: "Abonnement Kafora - Business - 1 mois"). */
  description: string;
  /** Données libres pour retrouver le contexte métier au retour du webhook (ex: subscriptionId). */
  metadata?: Record<string, string>;
}

export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export interface CreatePaymentResult {
  /** Identifiant du paiement côté fournisseur — à stocker pour checkPayment/refundPayment. */
  providerPaymentId: string;
  status: Extract<PaymentStatus, 'PENDING'>;
  /** URL de paiement à présenter au client, si le fournisseur en a besoin (ex: page Orabank). */
  redirectUrl?: string;
}

export interface CheckPaymentResult {
  status: PaymentStatus;
  amount: number;
  paidAt?: string;
}

export interface RefundPaymentResult {
  status: Extract<PaymentStatus, 'REFUNDED' | 'FAILED'>;
  refundedAmount: number;
}

/** Événement normalisé extrait d'un webhook fournisseur (chaque fournisseur a son propre format brut). */
export interface PaymentWebhookEvent {
  type: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'PAYMENT_REFUNDED';
  providerPaymentId: string;
  /** Charge utile brute du fournisseur, conservée pour audit/débogage. */
  raw: unknown;
}

/**
 * Contrat qu'un fournisseur de paiement doit implémenter. Voir
 * lib/payments/registry.ts pour l'enregistrement, et
 * lib/payments/providers/ pour les implémentations (aucune à ce jour).
 */
export interface PaymentProvider {
  id: PaymentProviderId;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  checkPayment(providerPaymentId: string): Promise<CheckPaymentResult>;
  refundPayment(providerPaymentId: string, amount?: number): Promise<RefundPaymentResult>;
  /**
   * Valide la signature du webhook (spécifique à chaque fournisseur) et
   * retourne un événement normalisé, ou `null` si le payload ne correspond
   * à rien de connu (à ignorer silencieusement, pas une erreur).
   */
  handleWebhook(payload: unknown, headers: Record<string, string>): Promise<PaymentWebhookEvent | null>;
}
