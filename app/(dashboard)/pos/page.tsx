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
import { SerialPickerDialog } from '@/components/pos/serial-picker-dialog';
import type { Product } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';

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
  const [serialPickerProduct, setSerialPickerProduct] = useState<Product | null>(null);

  // ─── État de la caisse ───────────────────────────────────────────────────
  //
  // On peut encaisser caisse fermée, et c'est VOLONTAIRE : bloquer la vente
  // parce qu'un caissier a oublié d'ouvrir sa session empêcherait un commerce
  // de servir ses clients — un remède pire que le mal.
  //
  // Mais ces ventes n'entrent alors dans AUCUNE clôture : l'argent est dans
  // le tiroir sans qu'aucune session ne le justifie, et le rapprochement de
  // fin de journée devient impossible. D'où cet avertissement bien visible.
  const [registerOpen, setRegisterOpen] = useState<boolean | null>(null);

  useEffect(() => {
    if (!tenantId || !storeId) return;
    return watch(
      'cash_sessions',
      () => supabase.from('cash_sessions').select('id').eq('tenant_id', tenantId).eq('store_id', storeId)
        .eq('status', 'OPEN').limit(1),
      rows => setRegisterOpen(rows.length > 0),
      () => setRegisterOpen(null),
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId]);

  // ─── Ajout au panier avec vérification stock ─────────────────────────────
  const handleAddItem = (p: Product) => {
    // Suivi de série (migration 041) : chaque exemplaire est distinct, on ne
    // peut pas juste "ajouter 1" — le picker fait choisir lequel.
    if (p.trackSerial) { setSerialPickerProduct(p); return; }
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
      {registerOpen === false && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            Caisse fermée — vos ventes ne seront rattachées à aucune session.
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Vous pouvez continuer à encaisser, mais ces ventes n&apos;apparaîtront
            pas dans le rapprochement de fin de journée. Ouvrez la caisse
            depuis le menu <strong>Caisse</strong> pour que le contrôle soit fiable.
          </p>
        </div>
      )}

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

      <SerialPickerDialog
        product={serialPickerProduct}
        storeId={storeId}
        onClose={() => setSerialPickerProduct(null)}
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
