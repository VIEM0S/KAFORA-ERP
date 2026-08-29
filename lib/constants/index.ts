export const COMPANY_COLORS = {
  primary: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#1e40af',
    600: '#1e3a8a',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
    950: '#172554',
  },
  secondary: {
    50: '#ffffff',
    100: '#f8fafc',
    200: '#f1f5f9',
    300: '#e2e8f0',
    400: '#cbd5e1',
    500: '#94a3b8',
    600: '#64748b',
    700: '#475569',
    800: '#334155',
    900: '#1e293b',
    950: '#0f172a',
  },
  accent: {
    50: '#fff7ed',
    100: '#ffedd5',
    200: '#fed7aa',
    300: '#fdba74',
    400: '#fb923c',
    500: '#f97316',
    600: '#ea580c',
    700: '#c2410c',
    800: '#9a3412',
    900: '#7c2d12',
    950: '#431407',
  },
  success: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
    950: '#052e16',
  },
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
    950: '#451a03',
  },
  danger: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
    950: '#450a0a',
  },
} as const;

export const ROLE_PERMISSIONS = {
  SUPER_ADMIN: {
    canManageTenants: true,
    canManageBilling: true,
    canViewAllTenants: true,
    canViewPurchasePrice: true,
    canManageUsers: true,
    canManageSettings: true,
    canViewReports: true,
    canManageProducts: true,
    canManageInventory: true,
    canProcessSales: true,
    canManageCredits: true,
    canManageSuppliers: true,
    canManageCashRegister: true,
  },
  OWNER: {
    canManageTenants: false,
    canManageBilling: false,
    canViewAllTenants: false,
    canViewPurchasePrice: true,
    canManageUsers: true,
    canManageSettings: true,
    canViewReports: true,
    canManageProducts: true,
    canManageInventory: true,
    canProcessSales: true,
    canManageCredits: true,
    canManageSuppliers: true,
    canManageCashRegister: true,
  },
  // Responsable régional : MANAGER + gestion des utilisateurs (CASHIER/MANAGER
  // uniquement), mais cantonné à ses propres magasins (storeIds) — jamais la
  // facturation ni les réglages du tenant, contrairement à ADMIN/OWNER.
  // Le cloisonnement par magasin est appliqué côté serveur (voir
  // lib/api/regional-scope.ts), pas ici : ROLE_PERMISSIONS ne connaît que le
  // rôle, jamais l'affectation magasin de l'utilisateur.
  REGIONAL_MANAGER: {
    canManageTenants: false,
    canManageBilling: false,
    canViewAllTenants: false,
    canViewPurchasePrice: false,
    canManageUsers: true,
    canManageSettings: false,
    canViewReports: true,
    canManageProducts: true,
    canManageInventory: true,
    canProcessSales: true,
    canManageCredits: true,
    canManageSuppliers: true,
    canManageCashRegister: true,
  },
  MANAGER: {
    canManageTenants: false,
    canManageBilling: false,
    canViewAllTenants: false,
    canViewPurchasePrice: false,
    canManageUsers: false,
    canManageSettings: false,
    canViewReports: true,
    canManageProducts: true,
    canManageInventory: true,
    canProcessSales: true,
    canManageCredits: true,
    canManageSuppliers: true,
    canManageCashRegister: true,
  },
  CASHIER: {
    canManageTenants: false,
    canManageBilling: false,
    canViewAllTenants: false,
    canViewPurchasePrice: false,
    canManageUsers: false,
    canManageSettings: false,
    canViewReports: false,
    canManageProducts: false,
    canManageInventory: false,
    canProcessSales: true,
    canManageCredits: false,
    canManageSuppliers: false,
    canManageCashRegister: true,
  },
} as const;

export const SUBSCRIPTION_PLANS = {
  STARTER: {
    name: 'Starter',
    price: 25000,
    currency: 'XOF',
    features: {
      maxUsers: 3,
      maxStores: 1,
      maxProducts: 500,
      maxCustomers: 500,
      posEnabled: true,
      analyticsEnabled: false,
      multiStoreEnabled: false,
      apiAccessEnabled: false,
    },
  },
  BUSINESS: {
    name: 'Business',
    price: 75000,
    currency: 'XOF',
    features: {
      maxUsers: 10,
      maxStores: 3,
      maxProducts: 5000,
      maxCustomers: 5000,
      posEnabled: true,
      analyticsEnabled: true,
      multiStoreEnabled: true,
      apiAccessEnabled: false,
    },
  },
  ENTERPRISE: {
    name: 'Enterprise',
    price: 200000,
    currency: 'XOF',
    features: {
      maxUsers: -1,
      maxStores: -1,
      maxProducts: -1,
      maxCustomers: -1,
      posEnabled: true,
      analyticsEnabled: true,
      multiStoreEnabled: true,
      // Pas encore implémenté (aucune route API publique / clé API dans le
      // code) : ne pas passer à true tant que la fonctionnalité n'existe pas
      // réellement, sinon la page Tarifs vend un avantage qui n'existe pas.
      apiAccessEnabled: false,
    },
  },
} as const;

export type PlanId = keyof typeof SUBSCRIPTION_PLANS;

// Flags booléens de SUBSCRIPTION_PLANS.features qui sont réellement
// vérifiés côté serveur (voir lib/supabase/plan-limits.ts checkPlanFeature)
// — par opposition à apiAccessEnabled ci-dessus, qui reste false partout
// tant qu'aucun code ne l'applique.
export type PlanFeatureFlag = 'analyticsEnabled' | 'multiStoreEnabled';

/**
 * Parrainage : jours offerts au premier paiement réel du filleul (pas à
 * l'inscription, pour éviter qu'un faux compte génère une récompense sans
 * jamais payer) — voir app/api/admin/subscription/route.ts.
 */
export const REFERRAL_REFERRER_BONUS_DAYS = 15;
/**
 * Jours offerts au filleul, appliqués immédiatement à l'inscription : un
 * essai prolongé ne coûte pas de revenu perdu, donc pas besoin d'attendre
 * un paiement pour ce côté-ci — voir app/api/auth/register/route.ts.
 */
export const REFERRAL_REFEREE_BONUS_DAYS = 7;

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Espèces', icon: 'Banknote' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money', icon: 'Smartphone' },
  { value: 'BANK_TRANSFER', label: 'Virement', icon: 'Building2' },
  { value: 'CREDIT', label: 'Crédit', icon: 'CreditCard' },
  { value: 'CARD', label: 'Carte', icon: 'CreditCard' },
  { value: 'SPLIT', label: 'Paiement mixte', icon: 'Split' },
] as const;

export const MOBILE_PROVIDERS = [
  { value: 'orange', label: 'Orange Money' },
  { value: 'moov', label: 'Moov Money' },
  { value: 'wave', label: 'Wave' },
] as const;

export const CURRENCIES = [
  { code: 'XOF', symbol: 'FCFA', name: 'Franc CFA' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'USD', symbol: '$', name: 'Dollar US' },
] as const;

export const SALES_STATUSES = [
  { value: 'DRAFT', label: 'Brouillon', color: 'secondary' },
  { value: 'PENDING', label: 'En attente', color: 'warning' },
  { value: 'COMPLETED', label: 'Terminée', color: 'success' },
  { value: 'CANCELLED', label: 'Annulée', color: 'danger' },
  { value: 'REFUNDED', label: 'Remboursée', color: 'danger' },
] as const;

export const CREDIT_STATUSES = [
  { value: 'PENDING', label: 'En attente', color: 'warning' },
  { value: 'PARTIALLY_PAID', label: 'Partiellement payé', color: 'accent' },
  { value: 'PAID', label: 'Payé', color: 'success' },
  { value: 'OVERDUE', label: 'En retard', color: 'danger' },
  { value: 'CANCELLED', label: 'Annulé', color: 'secondary' },
  { value: 'WRITTEN_OFF', label: 'Abandonné', color: 'secondary' },
] as const;

export const QUOTE_STATUSES = [
  { value: 'DRAFT', label: 'Brouillon', color: 'secondary' },
  { value: 'PENDING', label: 'En attente', color: 'warning' },
  { value: 'SENT', label: 'Envoyé', color: 'primary' },
  { value: 'ACCEPTED', label: 'Accepté', color: 'success' },
  { value: 'REJECTED', label: 'Refusé', color: 'danger' },
  { value: 'EXPIRED', label: 'Expiré', color: 'secondary' },
  { value: 'CONVERTED', label: 'Converti', color: 'success' },
] as const;

export const MOVEMENT_TYPES = [
  { value: 'PURCHASE', label: 'Achat/Réception', sign: 1 },
  { value: 'SALE', label: 'Vente', sign: -1 },
  { value: 'ADJUSTMENT', label: 'Ajustement', sign: 0 },
  { value: 'TRANSFER_IN', label: 'Transfert entrant', sign: 1 },
  { value: 'TRANSFER_OUT', label: 'Transfert sortant', sign: -1 },
  { value: 'RETURN', label: 'Retour', sign: 1 },
  { value: 'DAMAGE', label: 'Casse/Perte', sign: -1 },
  { value: 'THEFT', label: 'Vol', sign: -1 },
] as const;

export const ALERT_SEVERITIES = {
  LOW: { label: 'Faible', color: 'secondary' },
  MEDIUM: { label: 'Moyenne', color: 'warning' },
  HIGH: { label: 'Élevée', color: 'accent' },
  CRITICAL: { label: 'Critique', color: 'danger' },
} as const;
