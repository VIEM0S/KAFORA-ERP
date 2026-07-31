'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useAuthStore, useCartStore } from '@/hooks/store';
import { usePosData } from '@/hooks/use-pos-data';
import { useOfflineSync } from '@/hooks/use-offline-sync';
import { useWorkingHoursWarning } from '@/hooks/use-working-hours-warning';
import { useCheckout } from '@/hooks/use-checkout';
import { ProductCatalog } from '@/components/pos/product-catalog';
import { CartPanel } from '@/components/pos/cart-panel';
import { PaymentDialog } from '@/components/pos/payment-dialog';
import { CustomerPickerDialog } from '@/components/pos/customer-picker-dialog';
import { SuccessDialog } from '@/components/pos/success-dialog';
import type { Product } from '@/lib/types';

export default function POSPage() {
  const { tenant, currentStore, user } = useAuthStore();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;

  const { items, addItem, clearCart } = useCartStore();
  const {
    products, customers, inventory, isLoading,
    isSearching, hasMore, search, setSearch, loadMore, searchCustomers,
  } = usePosData(tenantId, storeId);
  const { isOnline, setIsOnline, pendingQueue, refreshQueue, isSyncing, runSync } = useOfflineSync();
  const outsideHours = useWorkingHoursWarning(user?.workingHours);
  const checkout = useCheckout({ tenantId, storeId, refreshQueue, setIsOnline });

  const [showCustomerPicker, setShowCustomerPicker] = useState(false);

  // ─── Ajout au panier avec vérification stock ─────────────────────────────
  const handleAddItem = (p: Product) => {
    if (!p.trackInventory) { addItem(p); return; }
    const cartQty = items.find(i => i.product.id === p.id)?.quantity || 0;
    const stockDisponible = (inventory[p.id] ?? 0) - cartQty;
    if (stockDisponible <= 0) {
      checkout.setCheckoutError(`Stock insuffisant pour "${p.name}" (${inventory[p.id] ?? 0} disponible)`);
      setTimeout(() => checkout.setCheckoutError(null), 3000);
      return;
    }
    addItem(p);
  };

  // Raccourcis clavier POS
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // F2 ou Ctrl+F → focus recherche produit
      if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.key === 'f')) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="produit"]');
        searchInput?.focus();
      }
      // Escape → fermer les dialogs ouverts
      if (e.key === 'Escape') {
        if (checkout.showPayment) { checkout.setShowPayment(false); checkout.setCheckoutError(null); }
        if (showCustomerPicker) setShowCustomerPicker(false);
        if (checkout.showSuccess) checkout.setShowSuccess(false);
      }
      // Ctrl+Entrée → valider le paiement si dialog ouvert
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && checkout.showPayment && !checkout.isProcessing) {
        checkout.handleCheckout();
      }
      // Ctrl+Suppr → vider le panier
      if ((e.ctrlKey || e.metaKey) && e.key === 'Delete' && !checkout.showPayment) {
        if (items.length > 0 && window.confirm('Vider le panier ?')) clearCart();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout.showPayment, showCustomerPicker, checkout.showSuccess, checkout.isProcessing, items.length]);

  return (
    <DashboardLayout>
      <div className="flex gap-4 h-[calc(100vh-8rem)]">
        <ProductCatalog
          products={products}
          inventory={inventory}
          isLoading={isLoading}
          search={search}
          setSearch={setSearch}
          isSearching={isSearching}
          hasMore={hasMore}
          onLoadMore={loadMore}
          checkoutError={checkout.checkoutError}
          showPayment={checkout.showPayment}
          onAddItem={handleAddItem}
          outsideHours={outsideHours}
          workingHours={user?.workingHours}
          isOnline={isOnline}
          pendingQueue={pendingQueue}
          isSyncing={isSyncing}
          onSync={runSync}
        />

        <CartPanel
          inventory={inventory}
          onOpenCustomerPicker={() => setShowCustomerPicker(true)}
          onPay={checkout.openPayment}
        />
      </div>

      <PaymentDialog
        open={checkout.showPayment}
        onClose={() => { checkout.setShowPayment(false); checkout.setCheckoutError(null); }}
        total={checkout.total}
        change={checkout.change}
        soldeCredit={checkout.soldeCredit}
        paymentMethod={checkout.paymentMethod}
        setPaymentMethod={checkout.setPaymentMethod}
        amountReceived={checkout.amountReceived}
        setAmountReceived={checkout.setAmountReceived}
        checkoutError={checkout.checkoutError}
        isProcessing={checkout.isProcessing}
        onConfirm={checkout.handleCheckout}
      />

      <CustomerPickerDialog
        customers={customers}
        open={showCustomerPicker}
        onOpenChange={setShowCustomerPicker}
        onSearch={searchCustomers}
      />

      <SuccessDialog
        open={checkout.showSuccess}
        onClose={() => checkout.setShowSuccess(false)}
        wasOfflineSale={checkout.wasOfflineSale}
        lastReceiptData={checkout.lastReceiptData}
      />
    </DashboardLayout>
  );
}
