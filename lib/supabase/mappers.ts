import type { Database } from './database.types';
import type {
  Store, Category, Product, Inventory, InventoryMovement, Customer, Supplier,
  Sale, SaleItem, Payment, Credit, CreditPayment, Quote, QuoteItem,
  PurchaseOrder, PurchaseOrderItem, Transfer, TransferLine,
  Alert, Notification, SaleReturn, SaleReturnItem, CashRegisterSession,
  Tenant, Subscription, User, DailyStat,
} from '@/lib/types';

/**
 * Convertit une ligne Postgres (snake_case, telle que renvoyée par Supabase)
 * vers les interfaces applicatives existantes (camelCase, `lib/types/index.ts`).
 *
 * POURQUOI CE FICHIER EXISTE : plutôt que de réécrire chaque composant qui
 * consomme `Store`, `Product`, etc. (des dizaines de fichiers, aucun rapport
 * avec la migration elle-même), la frontière snake_case ↔ camelCase est
 * absorbée ICI, au point de lecture des données. Le reste de l'application
 * ne voit jamais une ligne Postgres brute.
 *
 * Les dates restent en `Date` (comme le faisaient les `Timestamp` Firestore
 * convertis par l'ancien code) — Postgres renvoie des chaînes ISO via
 * PostgREST, `new Date(iso)` les interprète correctement.
 */

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

const toDate = (v: string | null): Date => new Date(v ?? Date.now());
const toDateOrNull = (v: string | null | undefined): Date | null => (v ? new Date(v) : null);

export function mapStore(r: Row<'stores'>): Store {
  return {
    id: r.id, tenantId: r.tenant_id, name: r.name, code: r.code,
    address: r.address, city: r.city, phone: r.phone, email: r.email,
    isWarehouse: r.is_warehouse, isActive: r.is_active,
    createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
  };
}

export function mapCategory(r: Row<'categories'>): Category {
  return {
    id: r.id, tenantId: r.tenant_id, name: r.name, slug: r.slug,
    description: r.description, parentId: r.parent_id, isActive: r.is_active,
    createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
  };
}

export function mapProduct(r: Row<'products'>): Product {
  return {
    id: r.id, tenantId: r.tenant_id, sku: r.sku ?? '', barcode: r.barcode,
    name: r.name, description: r.description, categoryId: r.category_id,
    unit: r.unit ?? 'unité', purchasePrice: r.purchase_price, sellingPrice: r.selling_price,
    taxRate: r.tax_rate, alertThreshold: r.alert_threshold ?? 0, imageData: r.image_data,
    isActive: r.is_active, trackInventory: r.track_inventory,
    createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
  };
}

export function mapInventory(r: Row<'inventory'>): Inventory {
  return {
    id: r.id, tenantId: r.tenant_id, productId: r.product_id, storeId: r.store_id,
    quantity: r.quantity, minQuantity: r.min_quantity ?? undefined,
    maxQuantity: r.max_quantity, reorderPoint: r.reorder_point,
    lastStockCheck: toDateOrNull(r.last_stock_check),
  };
}

export function mapInventoryMovement(r: Row<'inventory_movements'>): InventoryMovement {
  return {
    id: r.id, tenantId: r.tenant_id, productId: r.product_id, productName: r.product_name,
    storeId: r.store_id, type: r.type, quantity: r.quantity,
    previousQuantity: r.previous_quantity, newQuantity: r.new_quantity,
    saleId: r.sale_id, transferId: r.transfer_id, purchaseOrderId: r.purchase_order_id,
    reason: r.reason, createdAt: toDate(r.created_at),
  };
}

export function mapCustomer(r: Row<'customers'>): Customer {
  return {
    id: r.id, tenantId: r.tenant_id, code: r.code ?? '', firstName: r.first_name,
    lastName: r.last_name, companyName: r.company_name, email: r.email, phone: r.phone,
    address: r.address, city: r.city, customerType: r.customer_type,
    creditLimit: r.credit_limit, creditUsed: r.credit_used, notes: r.notes,
    isActive: r.is_active, createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
  };
}

export function mapSupplier(r: Row<'suppliers'>): Supplier {
  return {
    id: r.id, tenantId: r.tenant_id, code: r.code ?? '', name: r.name,
    contactPerson: r.contact_person, email: r.email, phone: r.phone,
    address: r.address, city: r.city, country: r.country, website: r.website,
    paymentTerms: r.payment_terms, taxId: r.tax_id, notes: r.notes,
    isActive: r.is_active, createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
  };
}

export function mapPayment(r: Row<'payments'>): Payment {
  return {
    id: r.id, saleId: r.sale_id, method: r.method, amount: r.amount,
    reference: r.reference, mobileProvider: r.mobile_provider,
  };
}

export function mapSaleItem(r: Row<'sale_items'>): SaleItem {
  return {
    id: r.id, saleId: r.sale_id, productId: r.product_id ?? '', productName: r.product_name,
    productSku: r.product_sku ?? '', quantity: r.quantity, unitPrice: r.unit_price,
    purchasePrice: r.purchase_price ?? 0, discountPercent: r.discount_percent,
    taxRate: r.tax_rate, total: r.total, returnedQuantity: r.returned_quantity,
  };
}

/** `items`/`payments` : passer les lignes déjà chargées séparément (jointure faite par l'appelant, comme avant avec les sous-collections). */
export function mapSale(r: Row<'sales'>, items: SaleItem[] = [], payments: Payment[] = []): Sale {
  return {
    id: r.id, tenantId: r.tenant_id, reference: r.reference, customerId: r.customer_id,
    customerName: r.customer_name,
    storeIdFrom: r.store_id, cashierId: r.cashier_id ?? '', status: r.status,
    subtotal: r.subtotal, taxAmount: r.tax_amount, discountAmount: r.discount_amount,
    discountPercent: r.discount_percent,
    discountReason: r.discount_reason, itemCount: r.item_count, total: r.total, paidAmount: r.paid_amount,
    changeGiven: r.change_given, paymentMethod: r.payment_method, notes: r.notes,
    items, payments,
    cancellationReason: r.cancellation_reason, cancelledBy: r.cancelled_by,
    cancelledAt: toDateOrNull(r.cancelled_at),
    createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
  };
}

export function mapCreditPayment(r: Row<'credit_payments'>): CreditPayment {
  return {
    id: r.id, creditId: r.credit_id, storeId: r.store_id, amount: r.amount,
    paymentMethod: r.payment_method, reference: r.reference, notes: r.notes,
    userName: r.user_name, remainingAfter: r.remaining_after, createdAt: toDate(r.created_at),
  };
}

export function mapCredit(r: Row<'credits'>, payments: CreditPayment[] = []): Credit {
  return {
    id: r.id, tenantId: r.tenant_id, customerId: r.customer_id,
    customerName: r.customer_name, customerPhone: r.customer_phone,
    saleId: r.sale_id,
    reference: r.reference ?? '', totalAmount: r.total_amount, paidAmount: r.paid_amount,
    remainingAmount: r.remaining_amount, dueDate: toDate(r.due_date),
    status: r.status, penaltyRate: r.penalty_rate ?? 0, penaltyAmount: r.penalty_amount ?? 0,
    notes: r.notes, payments, createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
    lastReminderSentAt: toDateOrNull(r.last_reminder_sent_at),
  };
}

export function mapQuoteItem(r: Row<'quote_items'>): QuoteItem {
  return {
    id: r.id, quoteId: r.quote_id, productId: r.product_id, productName: r.product_name,
    productSku: r.product_sku, quantity: r.quantity, unitPrice: r.unit_price,
    discountPercent: r.discount_percent, taxRate: r.tax_rate, total: r.total,
  };
}

export function mapQuote(r: Row<'quotes'>, items: QuoteItem[] = []): Quote {
  return {
    id: r.id, tenantId: r.tenant_id, reference: r.reference, customerId: r.customer_id,
    customerName: r.customer_name,
    status: r.status, validUntil: toDateOrNull(r.valid_until), subtotal: r.subtotal,
    taxAmount: r.tax_amount, discountAmount: r.discount_amount, total: r.total,
    notes: r.notes, terms: r.terms, items, convertedSaleId: r.converted_sale_id,
    createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
  };
}

export function mapPurchaseOrderItem(r: Row<'purchase_order_items'>): PurchaseOrderItem {
  return {
    id: r.id, productId: r.product_id ?? '', productName: r.product_name,
    productSku: r.product_sku ?? '', quantityOrdered: r.quantity_ordered,
    quantityReceived: r.quantity_received, unitCost: r.unit_cost, total: r.total,
  };
}

export function mapPurchaseOrder(r: Row<'purchase_orders'>, items: PurchaseOrderItem[] = []): PurchaseOrder {
  return {
    id: r.id, tenantId: r.tenant_id, reference: r.reference, supplierId: r.supplier_id ?? '',
    storeId: r.store_id, status: r.status, items, subtotal: r.subtotal, notes: r.notes,
    expectedDate: r.expected_date ? r.expected_date.slice(0, 10) : null,
    createdBy: r.created_by ?? '', createdByName: r.created_by_name,
    createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
    receivedAt: toDateOrNull(r.received_at),
  };
}

export function mapTransferLine(r: Row<'transfer_lines'>): TransferLine {
  return {
    productId: r.product_id ?? '', productName: r.product_name,
    productSku: r.product_sku ?? '', quantity: r.quantity,
  };
}

export function mapTransfer(r: Row<'transfers'>, lines: TransferLine[] = []): Transfer {
  return {
    id: r.id, tenantId: r.tenant_id, reference: r.reference,
    fromStoreId: r.from_store_id, toStoreId: r.to_store_id, status: r.status, lines,
    note: r.note, requestedBy: r.requested_by ?? '', approvedBy: r.approved_by,
    shippedBy: r.shipped_by, receivedBy: r.received_by,
    createdAt: toDate(r.created_at), approvedAt: toDateOrNull(r.approved_at),
    shippedAt: toDateOrNull(r.shipped_at), receivedAt: toDateOrNull(r.received_at),
    rejectionReason: r.rejection_reason,
  };
}

export function mapAlert(r: Row<'alerts'>): Alert {
  return {
    id: r.id, tenantId: r.tenant_id, type: r.type, severity: r.severity,
    title: r.title, message: r.message ?? '', reference: r.reference, referenceId: r.reference_id,
    isRead: r.is_read, isResolved: r.is_resolved, resolvedBy: r.resolved_by,
    resolvedAt: toDateOrNull(r.resolved_at), createdAt: toDate(r.created_at),
  };
}

export function mapNotification(r: Row<'notifications'>): Notification {
  return {
    id: r.id, userId: r.user_id, title: r.title, message: r.message ?? '',
    type: r.type ?? '', reference: r.reference, referenceId: r.reference_id,
    channel: r.channel, isRead: r.is_read, readAt: toDateOrNull(r.read_at),
    createdAt: toDate(r.created_at),
  };
}

export function mapSaleReturnItem(r: Row<'sale_return_items'>): SaleReturnItem {
  return {
    productId: r.product_id ?? '', productName: r.product_name, quantity: r.quantity,
    unitPrice: r.unit_price, total: r.total, restocked: r.restocked,
  };
}

export function mapSaleReturn(r: Row<'sale_returns'>, items: SaleReturnItem[] = []): SaleReturn {
  return {
    id: r.id, tenantId: r.tenant_id, saleId: r.sale_id, saleReference: r.sale_reference,
    storeId: r.store_id, customerId: r.customer_id, items, refundAmount: r.refund_amount,
    refundMethod: r.refund_method, reason: r.reason ?? '', status: r.status,
    processedBy: r.processed_by ?? '', processedByName: r.processed_by_name,
    createdAt: toDate(r.created_at),
  };
}

export function mapCashSession(r: Row<'cash_sessions'>): CashRegisterSession {
  return {
    id: r.id, tenantId: r.tenant_id, storeId: r.store_id, registerId: r.register_id,
    status: r.status as CashRegisterSession['status'],
    openedBy: r.opened_by, openedByName: r.opened_by_name, openedAt: toDate(r.opened_at),
    openingBalance: r.opening_balance,
    closedBy: r.closed_by, closedByName: r.closed_by_name, closedAt: toDateOrNull(r.closed_at),
    closingBalance: r.closing_balance, expectedBalance: r.expected_balance,
    cashSalesTotal: r.cash_sales_total, acompteTotal: r.acompte_total,
    creditRepaymentTotal: r.credit_repayment_total, cashRefundTotal: r.cash_refund_total,
    difference: r.difference, varianceReason: r.variance_reason,
    salesCount: r.sales_count, salesTotal: r.sales_total, notes: r.notes,
    createdAt: toDate(r.created_at),
  };
}

export function mapTenant(r: Row<'tenants'>): Tenant {
  return {
    id: r.id, name: r.name, slug: r.slug, logo: r.logo, email: r.email,
    phone: r.phone, address: r.address, city: r.city, country: r.country,
    rccm: r.rccm, nif: r.nif, currency: r.currency, timezone: r.timezone,
    isActive: r.is_active, createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
    transferSettings: (r.transfer_settings as unknown as Tenant['transferSettings']) ?? undefined,
    referralCode: r.referral_code, referredByTenantId: r.referred_by_tenant_id,
  };
}

export function mapSubscription(r: Row<'subscriptions'>): Subscription {
  return {
    id: r.id, tenantId: r.tenant_id, plan: r.plan, status: r.status,
    trialEndsAt: toDateOrNull(r.trial_ends_at),
    currentPeriodStart: toDateOrNull(r.current_period_start),
    currentPeriodEnd: toDateOrNull(r.current_period_end),
    limits: (r.limits as unknown as Subscription['limits']) ?? undefined,
  };
}

export function mapDailyStat(r: Row<'daily_stats'>): DailyStat {
  return {
    date: r.date, revenue: r.revenue, cost: r.cost, margin: r.margin,
    saleCount: r.sale_count, itemCount: r.item_count, uniqueCustomers: r.unique_customers,
    byPayment: r.by_payment as Record<string, number> | null,
    byStore: r.by_store as Record<string, number> | null,
    revenueByCategory: r.revenue_by_category as Record<string, number> | null,
    costByCategory: r.cost_by_category as Record<string, number> | null,
    marginByCategory: r.margin_by_category as Record<string, number> | null,
    topProducts: (r.top_products as DailyStat['topProducts']) ?? [],
    costIncomplete: r.cost_incomplete,
  };
}

export function mapUser(r: Row<'users'>): User {
  return {
    id: r.id, tenantId: r.tenant_id, email: r.email, firstName: r.first_name,
    lastName: r.last_name, phone: r.phone, avatar: r.avatar, role: r.role,
    storeIds: r.store_ids, isActive: r.is_active, emailVerified: r.email_verified,
    mfaEnabled: r.mfa_enabled, lastLoginAt: toDateOrNull(r.last_login_at),
    createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
    workingHours: (r.working_hours as User['workingHours']) ?? undefined,
  };
}
