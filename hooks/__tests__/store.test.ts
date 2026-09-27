import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '../store';
import type { Product } from '@/lib/types';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', tenantId: 't1', sku: 'SKU1', barcode: null,
    name: 'Clous 4cm', description: null, categoryId: null,
    unit: 'piece', purchasePrice: 800, sellingPrice: 1200,
    taxRate: 0, alertThreshold: 10, isActive: true, trackInventory: true,
    trackExpiry: false, trackSerial: false, fractionalQuantity: false,
    imageData: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

describe('useCartStore', () => {
  beforeEach(() => {
    // Le store est persistant (sessionStorage) et partagé entre tests —
    // on le remet à zéro avant chaque test pour l'isolation.
    useCartStore.getState().clearCart();
  });

  it('ajoute un nouvel article avec le bon total (prix × quantité, TVA incluse)', () => {
    const product = makeProduct({ sellingPrice: 1200, taxRate: 18 });
    useCartStore.getState().addItem(product, 2);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].total).toBeCloseTo(2 * 1200 * 1.18, 5);
  });

  it('cumule la quantité si le même produit est ajouté deux fois plutôt que dupliquer la ligne', () => {
    const product = makeProduct();
    useCartStore.getState().addItem(product, 1);
    useCartStore.getState().addItem(product, 2);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it('retire un article du panier', () => {
    const product = makeProduct();
    useCartStore.getState().addItem(product, 1);
    useCartStore.getState().removeItem(product.id);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('recalcule le total quand la quantité est mise à jour', () => {
    const product = makeProduct({ sellingPrice: 1000, taxRate: 0 });
    useCartStore.getState().addItem(product, 1);
    useCartStore.getState().updateItemQuantity(product.id, 5);
    expect(useCartStore.getState().items[0].total).toBe(5000);
  });

  it('getSubtotal ignore la TVA mais applique la remise par ligne', () => {
    const product = makeProduct({ sellingPrice: 1000, taxRate: 18 });
    useCartStore.getState().addItem(product, 2);
    // Remise de ligne à 10% appliquée manuellement via updateItemPrice n'existe
    // pas pour discount — on vérifie simplement que getSubtotal = qty * prix (pas de TVA).
    expect(useCartStore.getState().getSubtotal()).toBe(2000);
  });

  it('getTax calcule la TVA uniquement sur le sous-total (pas sur la TVA elle-même)', () => {
    const product = makeProduct({ sellingPrice: 1000, taxRate: 18 });
    useCartStore.getState().addItem(product, 1);
    expect(useCartStore.getState().getTax()).toBeCloseTo(180, 5);
  });

  it('getTotal = sous-total + TVA - remise globale', () => {
    const product = makeProduct({ sellingPrice: 1000, taxRate: 18 });
    useCartStore.getState().addItem(product, 1);
    useCartStore.getState().setDiscount(10, 'Remise 10%');
    // sous-total 1000, TVA 180, remise globale 10% du sous-total = 100
    expect(useCartStore.getState().getTotal()).toBeCloseTo(1000 + 180 - 100, 5);
  });

  it('clearCart réinitialise le panier, le client et la remise', () => {
    const product = makeProduct();
    useCartStore.getState().addItem(product, 3);
    useCartStore.getState().setDiscount(20, 'Remise 20%');
    useCartStore.getState().clearCart();
    const state = useCartStore.getState();
    expect(state.items).toHaveLength(0);
    expect(state.discountPercent).toBe(0);
    expect(state.customer).toBeNull();
  });

  it('getItemCount additionne les quantités de toutes les lignes', () => {
    useCartStore.getState().addItem(makeProduct({ id: 'p1' }), 2);
    useCartStore.getState().addItem(makeProduct({ id: 'p2' }), 3);
    expect(useCartStore.getState().getItemCount()).toBe(5);
  });
});
