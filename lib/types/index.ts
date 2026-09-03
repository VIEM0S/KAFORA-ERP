export interface User {
  id: string;
  tenantId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatar: string | null;
  role: UserRole;
  /**
   * Magasins auxquels cet utilisateur a accès.
   *
   * `null` = accès à TOUS les magasins du tenant (propriétaire, direction,
   * siège). Un tableau = accès limité à ces magasins uniquement.
   *
   * Avant l'introduction de ce champ, tout utilisateur voyait tous les
   * magasins : un caissier de la boutique A pouvait consulter le stock, les
   * ventes et la caisse de la boutique B. Les comptes existants n'ont pas ce
   * champ et restent donc en accès global — c'est volontaire pour ne rien
   * casser, mais chaque compte doit être revu et restreint.
   */
  storeIds?: string[] | null;
  isActive: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  workingHours?: { start: string; end: string } | null;
}

export type UserRole = 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'REGIONAL_MANAGER' | 'MANAGER' | 'CASHIER';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  rccm: string | null;
  nif: string | null;
  currency: string;
  timezone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  subscription?: Subscription;
  transferSettings?: TransferSettings;
  referralCode?: string | null;
  referredByTenantId?: string | null;
  // Gouvernance des crédits (migration 045) : au-delà de ce montant, une
  // annulation de crédit demande une seconde validation du siège au lieu
  // de s'appliquer immédiatement. Réglable par le Propriétaire/Admin.
  writeOffApprovalThreshold: number;
}

// Piste d'audit immuable (migration 045) — alimentée uniquement par les
// RPC write_off_credit/approve_credit_write_off/reject_credit_write_off/
// set_credit_limit. Jamais écrite depuis le client.
export interface AuditLogEntry {
  id: string;
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  storeId: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Réglages des transferts entre magasins, propres à chaque client.
 *
 * Une boutique de quartier où le patron gère tout n'a pas besoin d'un circuit
 * de validation pour déplacer trois cartons ; une structure avec siège et
 * direction, si. D'où le choix laissé au client plutôt qu'un processus imposé.
 */
export interface TransferSettings {
  /** true = une demande doit être approuvée avant l'expédition. */
  requireApproval: boolean;
  /** Rôles autorisés à approuver une demande (si requireApproval). */
  approveRoles: UserRole[];
  /** Rôles autorisés à expédier et à confirmer une réception. */
  shipRoles: UserRole[];
}

export type TransferStatus =
  | 'PENDING'    // demande créée, en attente d'approbation
  | 'APPROVED'   // validée (ou créée directement ainsi si pas d'approbation)
  | 'SHIPPED'    // expédiée : stock SORTI de la source, pas encore entré
  | 'RECEIVED'   // reçue : stock entré à destination — état final
  | 'REJECTED'   // demande refusée — état final
  | 'CANCELLED'; // annulée — état final

export interface TransferLine {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
}

/**
 * Transfert de stock d'un magasin vers un autre.
 *
 * Le stock est déplacé en DEUX temps, jamais en un seul : il sort à
 * l'expédition, il entre à la réception. Entre les deux il est « en transit »
 * — invisible dans les deux magasins, mais traçable. C'est ce qui évite qu'un
 * carton parti mais pas encore arrivé soit vendu deux fois, ou disparaisse
 * des comptes.
 */
export interface Transfer {
  id: string;
  tenantId: string;
  reference: string;
  // Nullables : le transfert reste consultable après suppression d'un magasin.
  fromStoreId: string | null;
  toStoreId: string | null;
  status: TransferStatus;
  lines: TransferLine[];
  note: string | null;
  requestedBy: string;
  approvedBy: string | null;
  shippedBy: string | null;
  receivedBy: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  shippedAt: Date | null;
  receivedAt: Date | null;
  rejectionReason: string | null;
}

export interface Subscription {
  id: string;
  tenantId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  limits?: SubscriptionLimits;
}

export type SubscriptionPlan = 'STARTER' | 'BUSINESS' | 'ENTERPRISE';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';

export interface SubscriptionLimits {
  maxUsers: number;
  maxStores: number;
  maxProducts: number;
  maxCustomers: number;
  posEnabled: boolean;
  analyticsEnabled: boolean;
  multiStoreEnabled: boolean;
  apiAccessEnabled: boolean;
}

export interface Store {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  isWarehouse: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  tenantId: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  category?: Category;
  unit: string;
  /**
   * Prix d'achat unitaire. `null` = non renseigné (le champ est facultatif).
   *
   * Ne jamais remplacer une valeur absente par 0 : 0 signifie « acquis
   * gratuitement » et produit une marge de 100 %, ce qui fausse les rapports
   * en silence. Les calculs de marge et de valeur de stock EXCLUENT les
   * produits sans prix d'achat et signalent que le résultat est partiel.
   */
  purchasePrice: number | null;
  sellingPrice: number;
  taxRate: number;
  alertThreshold: number;
  imageData: string | null;
  isActive: boolean;
  trackInventory: boolean;
  // Suivi de péremption (FEFO, voir ProductLot) et suivi par numéro de
  // série/IMEI (voir ProductSerial) — mutuellement exclusifs, imposé côté
  // base par chk_products_track_exclusive. Un produit "normal" a les deux
  // à false et se comporte exactement comme avant l'ajout de ces suivis.
  trackExpiry: boolean;
  trackSerial: boolean;
  createdAt: Date;
  updatedAt: Date;
  inventory?: Inventory[];
}

// Ventilation par lot d'un produit à suivi de péremption (track_expiry) —
// inventory.quantity reste la somme de ces lots pour (produit, magasin),
// consommée en FEFO (le plus proche de la péremption d'abord) par
// pos_checkout(). Voir supabase/migrations (migration 041).
export interface ProductLot {
  id: string;
  tenantId: string;
  productId: string;
  storeId: string;
  quantity: number;
  expiryDate: Date;
  receivedAt: Date;
  purchaseOrderId: string | null;
  notes: string | null;
}

// Une ligne par exemplaire physique d'un produit à suivi de série
// (track_serial) — inventory.quantity reste le nombre de lignes IN_STOCK
// pour (produit, magasin). Vendu = passé à SOLD par pos_checkout(), jamais
// supprimé (traçabilité SAV).
export interface ProductSerial {
  id: string;
  tenantId: string;
  productId: string;
  storeId: string;
  serialNumber: string;
  status: 'IN_STOCK' | 'SOLD';
  saleId: string | null;
  soldAt: Date | null;
  receivedAt: Date;
  purchaseOrderId: string | null;
}

export interface Inventory {
  id: string;
  tenantId: string;
  productId: string;
  storeId: string;
  quantity: number;
  minQuantity?: number;
  maxQuantity?: number | null;
  reorderPoint?: number | null;
  lastStockCheck?: Date | null;
}

export type InventoryMovementType =
  'SALE' | 'PURCHASE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'TRANSFER_CANCEL' | 'ADJUSTMENT' | 'RETURN' | 'INITIAL';

export interface InventoryMovement {
  id: string;
  tenantId: string;
  productId: string | null;
  productName: string;
  storeId: string | null;
  type: InventoryMovementType;
  quantity: number;
  previousQuantity: number | null;
  newQuantity: number | null;
  saleId: string | null;
  transferId: string | null;
  purchaseOrderId: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface Customer {
  id: string;
  tenantId: string;
  code: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  customerType: CustomerType;
  creditLimit: number;
  creditUsed: number;
  notes: string | null;
  isActive: boolean;
  // Magasin d'inscription (modèle "agence bancaire", voir migration 044) —
  // null = ouvert à tous les managers (clients existants avant cette
  // fonctionnalité, ou créés depuis le siège). Vendre à ce client ou
  // encaisser un remboursement reste ouvert à tous les magasins quel que
  // soit ce champ ; seules la modification/suppression de la fiche et
  // l'annulation d'un crédit y sont réservées.
  registeredStoreId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomerType = 'INDIVIDUAL' | 'BUSINESS' | 'WALK_IN';

export interface Sale {
  id: string;
  tenantId: string;
  reference: string;
  customerId: string | null;
  customer?: Customer;
  // Instantané pris à la création : reste lisible même si le client est
  // supprimé ensuite (voir migration 019).
  customerName: string | null;
  // Nullable : la vente reste consultable après suppression du magasin
  // (garantie côté UI, voir supabase/migrations/..._019_deletable_entity_fk_fixes.sql).
  storeIdFrom: string | null;
  storeFrom?: Store;
  cashierId: string;
  cashier?: User;
  status: SaleStatus;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  // Le % appliqué au panier entier — discountAmount seul ne permet pas de
  // le retrouver après coup (ex. "Remise (10%)" affichée sur la facture).
  discountPercent: number | null;
  discountReason: string | null;
  itemCount: number | null;
  total: number;
  paidAmount: number;
  changeGiven: number;
  paymentMethod: PaymentMethod;
  notes: string | null;
  items: SaleItem[];
  payments: Payment[];
  cancellationReason: string | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SaleStatus = 'DRAFT' | 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'CREDIT' | 'CARD' | 'SPLIT';

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  purchasePrice: number;
  discountPercent: number;
  taxRate: number;
  total: number;
  returnedQuantity: number;
  // Rempli par pos_checkout() uniquement pour un produit à suivi de série
  // (track_serial) — visible sur le ticket et l'historique pour la garantie/SAV.
  serialNumber: string | null;
}

export interface Payment {
  id: string;
  saleId: string;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  mobileProvider: string | null;
}

export interface Credit {
  id: string;
  tenantId: string;
  // Nullable : le crédit reste consultable après suppression du client.
  customerId: string | null;
  customer?: Customer;
  // Instantané pris à la création (même principe que Sale.customerName) :
  // reste lisible même si le client est supprimé ensuite.
  customerName: string | null;
  customerPhone: string | null;
  saleId: string | null;
  reference: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: Date;
  status: CreditStatus;
  penaltyRate: number;
  penaltyAmount: number;
  notes: string | null;
  payments: CreditPayment[];
  createdAt: Date;
  updatedAt: Date;
  // Horodatage de la dernière relance WhatsApp envoyée par le commerçant —
  // voir buildWhatsAppReminderLink() dans app/(dashboard)/credits/page.tsx.
  // Ne reflète pas un envoi automatique : personne ne l'écrit tant que le
  // commerçant n'a pas cliqué lui-même sur "Relancer".
  lastReminderSentAt: Date | null;
  // Demande d'annulation en attente de validation du siège (gouvernance,
  // voir migration 045) — distinct de `status` : le crédit garde son statut
  // normal (PENDING/PARTIALLY_PAID/OVERDUE) tant que la demande n'est pas
  // tranchée, seule write_off_status bascule.
  writeOffStatus: 'NONE' | 'PENDING' | 'REJECTED';
  writeOffRequestedBy: string | null;
  writeOffRequestedByName: string | null;
  writeOffRequestedAt: Date | null;
  writeOffReason: string | null;
  writeOffRejectedReason: string | null;
}

export type CreditStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'WRITTEN_OFF';

export interface CreditPayment {
  id: string;
  creditId: string;
  storeId: string | null;
  amount: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
  notes: string | null;
  userName: string | null;
  /** Solde restant immédiatement après ce versement — pour l'historique. */
  remainingAfter: number | null;
  createdAt: Date;
}

export interface Quote {
  id: string;
  tenantId: string;
  // Jamais numéroté légalement (contrairement aux ventes/BC) — généré côté
  // client par commodité d'affichage uniquement.
  reference: string | null;
  customerId: string | null;
  customer?: Customer;
  // Instantané pris à la création : reste lisible même si le client est
  // supprimé ensuite (voir migration 032).
  customerName: string | null;
  status: QuoteStatus;
  validUntil: Date | null;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  items: QuoteItem[];
  convertedSaleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Valeurs réellement utilisées par l'app (quotes/page.tsx) — corrigé en
// migration 031, l'enum d'origine (DRAFT/SENT/REJECTED) était aspirationnel.
export type QuoteStatus = 'PENDING' | 'ACCEPTED' | 'CONVERTED' | 'REFUSED' | 'EXPIRED';

export interface QuoteItem {
  id: string;
  quoteId: string;
  productId: string | null;
  productName: string;
  productSku: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  total: number;
}

export interface Supplier {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  paymentTerms: number | null;
  taxId: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Alert {
  id: string;
  tenantId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  reference: string | null;
  referenceId: string | null;
  isRead: boolean;
  isResolved: boolean;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export type AlertType = 'LOW_STOCK' | 'OUT_OF_STOCK' | 'OVERDUE_CREDIT' | 'LARGE_DISCOUNT' | 'REFUND' | 'CASH_VARIANCE' | 'FAILED_PAYMENT' | 'SUSPICIOUS_ACTIVITY' | 'OFFLINE_SYNC_CONFLICT' | 'USER_DELETION_REQUEST' | 'USER_DELETION_RESOLVED' | 'CREDIT_WRITTEN_OFF' | 'CREDIT_WRITE_OFF_PENDING' | 'CREDIT_LIMIT_CHANGED';
export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  reference: string | null;
  referenceId: string | null;
  channel: NotificationChannel;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH';

/** Agrégat quotidien pré-calculé — voir netlify/functions/aggregate-daily-stats. */
export interface DailyStat {
  date: string; // AAAA-MM-JJ
  revenue: number;
  cost: number;
  margin: number;
  saleCount: number;
  itemCount: number;
  uniqueCustomers: number;
  byPayment: Record<string, number> | null;
  byStore: Record<string, number> | null;
  revenueByCategory: Record<string, number> | null;
  costByCategory: Record<string, number> | null;
  marginByCategory: Record<string, number> | null;
  topProducts: { productId: string; name: string; revenue: number; quantity: number }[];
  costIncomplete: boolean;
}

export interface DashboardStats {
  todaySales: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
  grossProfit: number;
  netProfit: number;
  stockValuation: number;
  overdueCredits: number;
  lowStockCount: number;
  topProducts: TopProduct[];
  recentSales: Sale[];
  salesTrend: SalesTrendPoint[];
}

export interface TopProduct {
  id: string;
  name: string;
  sku: string;
  quantitySold: number;
  revenue: number;
}

export interface SalesTrendPoint {
  date: string;
  sales: number;
  revenue: number;
}

export type CashSessionStatus = 'OPEN' | 'CLOSED';

export interface CashRegisterSession {
  id: string;
  tenantId: string;
  storeId: string | null;
  registerId: string | null;
  status: CashSessionStatus;
  openedBy: string | null;
  openedByName: string | null;
  openedByUser?: User;
  openedAt: Date;
  openingBalance: number;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: Date | null;
  closingBalance: number | null;
  expectedBalance: number | null;
  cashSalesTotal: number | null;
  acompteTotal: number | null;
  creditRepaymentTotal: number | null;
  cashRefundTotal: number | null;
  difference: number | null;
  varianceReason: string | null;
  salesCount: number | null;
  salesTotal: number | null;
  notes: string | null;
  createdAt: Date;
}

export interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  total: number;
  // Uniquement pour un produit à suivi de série (product.trackSerial) : les
  // numéros choisis au POS, un par exemplaire. quantity === serials.length
  // toujours pour ce type de ligne — voir components/pos/serial-picker-dialog.tsx.
  serials?: string[];
}

export interface Cart {
  items: CartItem[];
  customerId: string | null;
  discountPercent: number;
  discountReason: string | null;
  notes: string | null;
}

// ─── Achats fournisseurs (bons de commande) ────────────────────────────────

export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  reference: string;
  supplierId: string;
  supplier?: Supplier;
  storeId: string | null; // magasin/entrepôt de destination — nullable après suppression
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  subtotal: number;
  notes: string | null;
  expectedDate: string | null; // date de livraison attendue (YYYY-MM-DD)
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  receivedAt: Date | null;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantityOrdered: number;
  quantityReceived: number; // cumul reçu (permet la réception partielle)
  unitCost: number; // coût d'achat unitaire pour cette commande
  total: number;
}

// ─── Retours / remboursements ──────────────────────────────────────────────

export type ReturnStatus = 'COMPLETED' | 'CANCELLED';
export type RefundMethod = 'CASH' | 'STORE_CREDIT' | 'ORIGINAL_PAYMENT_METHOD';

export interface SaleReturn {
  id: string;
  tenantId: string;
  saleId: string;
  saleReference: string;
  storeId: string | null;
  customerId: string | null;
  items: SaleReturnItem[];
  refundAmount: number;
  refundMethod: RefundMethod;
  reason: string;
  status: ReturnStatus;
  processedBy: string;
  processedByName: string | null;
  createdAt: Date;
}

export interface SaleReturnItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  restocked: boolean; // false si l'article est retourné défectueux (pas remis en stock)
}
