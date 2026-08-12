export interface UserProfile {
  id: string; uid: string; email: string;
  firstName: string; lastName: string; phone?: string;
  role: 'OWNER' | 'ADMIN' | 'REGIONAL_MANAGER' | 'MANAGER' | 'CASHIER';
  isActive: boolean; lastLoginAt?: string; createdAt: unknown;
  workingHours?: { start: string; end: string } | null;
  /** Magasins autorisés ; absent ou null = accès à tous (cf. lib/types). */
  storeIds?: string[] | null;
  deletedAt?: unknown; deletedBy?: string;
}

export interface DeletionRequest {
  id: string; targetUserId: string; targetUserName: string; targetUserRole: string;
  requestedBy: string; requestedByName: string; reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  createdAt: unknown;
}

// Type minimal pour l'utilisateur connecté (issu de useAuthStore, typé
// globalement `User` avec un UserRole plus large incluant SUPER_ADMIN) —
// ces composants n'ont besoin que de `id` et `role`, donc on structure le
// prop sur ce sous-ensemble plutôt que sur UserProfile pour rester
// compatible sans caster.
export interface CurrentUser {
  id: string;
  role: string;
  /** Nécessaire pour cloisonner ce qu'un REGIONAL_MANAGER peut modifier —
   *  voir canEditUser dans users-table.tsx. */
  storeIds?: string[] | null;
}
