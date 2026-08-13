import { useState } from 'react';
import { useAuthStore, useCartStore } from '@/hooks/store';
import { type InvoiceData } from '@/lib/utils/pdf';
import { enqueueSale, generateLocalSaleId } from '@/lib/offline-queue';
import type { Customer } from '@/lib/types';

export function displayCustomerName(c: Customer) {
  return c.customerType === 'BUSINESS' ? c.companyName! : `${c.firstName || ''} ${c.lastName || ''}`.trim();
}

interface UseCheckoutParams {
  tenantId: string | undefined;
  storeId: string | undefined;
  // Nécessaires pour mettre à jour le bandeau hors-ligne quand une vente
  // bascule dans la file locale suite à un échec réseau (voir use-offline-sync).
  refreshQueue: () => void;
  setIsOnline: (v: boolean) => void;
}

export function useCheckout({ tenantId, storeId, refreshQueue, setIsOnline }: UseCheckoutParams) {
  const { tenant, user } = useAuthStore();
  const { items, clearCart, customer, getTotal, discountPercent, sourceQuoteId } = useCartStore();

  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [amountReceived, setAmountReceived] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastReceiptData, setLastReceiptData] = useState<InvoiceData | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [wasOfflineSale, setWasOfflineSale] = useState(false);
  // Généré une seule fois à l'ouverture du paiement (voir openPayment), pas à
  // chaque appel de handleCheckout : si la transaction serveur réussit mais
  // qu'une écriture secondaire échoue ensuite (voir commentaire plus bas) et
  // que l'utilisateur reclique sur "Confirmer" pour la même vente, il faut
  // que ce soit reconnu comme un rejeu — pas comme une vente distincte.
  const [attemptId, setAttemptId] = useState(generateLocalSaleId());

  const total = getTotal();
  const change = amountReceived ? Math.max(0, Number(amountReceived) - total) : 0;
  const acompte = paymentMethod === 'CREDIT' ? (Number(amountReceived) || 0) : total;
  const soldeCredit = paymentMethod === 'CREDIT' ? Math.max(0, total - acompte) : 0;

  const openPayment = () => {
    setCheckoutError(null);
    setAmountReceived('');
    setAttemptId(generateLocalSaleId());
    setShowPayment(true);
  };

  // ─── Checkout via l'API serveur (prix/coût recalculés côté serveur) ───────
  const handleCheckout = async () => {
    if (!tenantId || !storeId || !user || items.length === 0) return;
    if (paymentMethod === 'CREDIT' && !customer) {
      setCheckoutError('Sélectionnez un client pour un paiement en crédit');
      return;
    }
    if (paymentMethod === 'CASH' && amountReceived && Number(amountReceived) < total) {
      setCheckoutError('Montant insuffisant');
      return;
    }

    setIsProcessing(true);
    setCheckoutError(null);

    const checkoutPayload = {
      tenantId, storeId,
      items: items.map(i => ({ productId: i.product.id, quantity: i.quantity, discount: i.discount })),
      customerId: customer?.id || null,
      paymentMethod,
      amountReceived: Number(amountReceived) || undefined,
      discountPercent,
      userName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      quoteId: sourceQuoteId || undefined,
    };

    // Réutilisé tel quel entre les tentatives (voir sa génération dans
    // openPayment) : c'est ce qui permet au serveur de reconnaître un rejeu
    // de la même vente plutôt que d'en créer une seconde en cas de nouvelle
    // tentative après un échec survenu après la transaction (voir plus haut).

    try {
      const res = await fetch('/api/pos/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Offline-Sync-Id': attemptId },
        body: JSON.stringify(checkoutPayload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la finalisation');

      const receipt: InvoiceData = {
        companyName: tenant?.name || 'KAFORA',
        companyPhone: tenant?.phone || undefined,
        companyAddress: tenant?.address || undefined,
        companyCity: tenant?.city || undefined,
        companyRccm: tenant?.rccm || undefined,
        companyNif: tenant?.nif || undefined,
        currency: tenant?.currency || 'FCFA',
        invoiceNumber: data.reference || data.saleId,
        date: new Date().toLocaleString('fr-FR'),
        type: 'REÇU',
        customerName: customer ? displayCustomerName(customer) : 'Client comptoir',
        customerPhone: customer?.phone || undefined,
        items: items.map(i => ({
          description: i.product.name, quantity: i.quantity,
          unitPrice: i.product.sellingPrice, total: i.product.sellingPrice * i.quantity * (1 - (i.discount || 0) / 100),
        })),
        subtotal: total, discountPercent, total,
        paymentMethod, amountReceived: Number(amountReceived) || total,
        change: data.change || 0,
        soldeCredit: paymentMethod === 'CREDIT' ? Math.max(0, total - (Number(amountReceived) || 0)) : undefined,
      };

      setLastReceiptData(receipt);
      setWasOfflineSale(false);
      clearCart();
      setAmountReceived('');
      setShowPayment(false);
      setShowSuccess(true);

    } catch (e: unknown) {
      // Une requête qui n'atteint même pas le serveur (pas de réseau) lève
      // une TypeError ("Failed to fetch") plutôt qu'une réponse HTTP — c'est
      // ce qui distingue "pas de connexion" d'une vraie erreur métier
      // (stock insuffisant, etc.), qu'on ne veut surtout pas mettre en file
      // d'attente silencieusement.
      const isNetworkFailure = e instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);

      if (isNetworkFailure) {
        enqueueSale(checkoutPayload, total, attemptId);
        refreshQueue();
        setIsOnline(false);
        setLastReceiptData({
          companyName: tenant?.name || 'KAFORA',
          companyPhone: tenant?.phone || undefined,
          companyAddress: tenant?.address || undefined,
          companyCity: tenant?.city || undefined,
          companyRccm: tenant?.rccm || undefined,
          companyNif: tenant?.nif || undefined,
          currency: tenant?.currency || 'FCFA',
          // Numéro provisoire, clairement distinct du format définitif
          // FAC-2026-000001 — remplacé par le vrai numéro séquentiel une fois
          // la vente synchronisée (voir /invoices après reconnexion).
          invoiceNumber: `PROVISOIRE-${attemptId.slice(-8).toUpperCase()}`,
          date: new Date().toLocaleString('fr-FR'),
          type: 'REÇU',
          customerName: customer ? displayCustomerName(customer) : 'Client comptoir',
          customerPhone: customer?.phone || undefined,
          items: items.map(i => ({
            description: i.product.name, quantity: i.quantity,
            unitPrice: i.product.sellingPrice, total: i.product.sellingPrice * i.quantity * (1 - (i.discount || 0) / 100),
          })),
          subtotal: total, discountPercent, total,
          paymentMethod, amountReceived: Number(amountReceived) || total,
          change: Math.max(0, (Number(amountReceived) || total) - total),
          soldeCredit: paymentMethod === 'CREDIT' ? Math.max(0, total - (Number(amountReceived) || 0)) : undefined,
          notes: 'Ticket provisoire — vente en attente de synchronisation.',
        });
        setWasOfflineSale(true);
        clearCart();
        setAmountReceived('');
        setShowPayment(false);
        setShowSuccess(true);
      } else {
        const msg = e instanceof Error ? e.message : 'Erreur lors de la finalisation';
        setCheckoutError(msg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    showPayment, setShowPayment, openPayment,
    paymentMethod, setPaymentMethod,
    amountReceived, setAmountReceived,
    isProcessing, showSuccess, setShowSuccess,
    lastReceiptData, checkoutError, setCheckoutError, wasOfflineSale,
    total, change, acompte, soldeCredit,
    handleCheckout,
  };
}
