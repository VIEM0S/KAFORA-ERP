import type { TransferSettings, TransferStatus, UserRole } from '@/lib/types';

/**
 * Réglages par défaut des transferts.
 *
 * Volontairement SIMPLES : pas d'approbation. La majorité des commerces
 * n'ont qu'un ou deux magasins et un patron qui gère tout — leur imposer un
 * circuit de validation pour déplacer trois cartons les ferait renoncer à la
 * fonction. Les structures qui ont un siège et une direction activent
 * l'approbation dans leurs réglages.
 */
export const DEFAULT_TRANSFER_SETTINGS: TransferSettings = {
  requireApproval: false,
  approveRoles: ['OWNER', 'ADMIN'],
  shipRoles: ['OWNER', 'ADMIN', 'MANAGER'],
};

/** Fusionne les réglages du client avec les défauts (champs manquants inclus). */
export function resolveTransferSettings(
  raw: Partial<TransferSettings> | null | undefined
): TransferSettings {
  return {
    requireApproval: raw?.requireApproval ?? DEFAULT_TRANSFER_SETTINGS.requireApproval,
    approveRoles: raw?.approveRoles?.length
      ? raw.approveRoles
      : DEFAULT_TRANSFER_SETTINGS.approveRoles,
    shipRoles: raw?.shipRoles?.length ? raw.shipRoles : DEFAULT_TRANSFER_SETTINGS.shipRoles,
  };
}

export function canApprove(role: UserRole, settings: TransferSettings): boolean {
  // Le propriétaire garde toujours la main : il ne doit jamais pouvoir se
  // verrouiller hors de son propre outil par un réglage malheureux.
  return role === 'OWNER' || settings.approveRoles.includes(role);
}

export function canShip(role: UserRole, settings: TransferSettings): boolean {
  return role === 'OWNER' || settings.shipRoles.includes(role);
}

/**
 * Transitions autorisées. Toute transition absente d'ici est refusée —
 * c'est ce qui empêche de recevoir deux fois un même transfert (donc de
 * créditer le stock en double) ou d'expédier une demande refusée.
 */
const TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['RECEIVED', 'CANCELLED'], // annuler après envoi = retour à la source
  RECEIVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransitionTo(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  PENDING: 'En attente de validation',
  APPROVED: 'Validé, à expédier',
  SHIPPED: 'En transit',
  RECEIVED: 'Reçu',
  REJECTED: 'Refusé',
  CANCELLED: 'Annulé',
};
