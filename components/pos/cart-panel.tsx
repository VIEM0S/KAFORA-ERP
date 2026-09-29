import { useEffect, useState } from 'react';
import { ShoppingCart, User, X, Trash2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils/helpers';
import { useCartStore } from '@/hooks/store';
import type { CartItem } from '@/lib/types';
import { displayCustomerName } from '@/hooks/use-checkout';

interface CartPanelProps {
  inventory: Record<string, number>;
  canDiscount: boolean;
  onOpenCustomerPicker: () => void;
  onPay: () => void;
}

// Partagé entre le stepper entier et le champ décimal ci-dessous : la même
// règle ("ne jamais dépasser le stock disponible si trackInventory") ne
// doit vivre qu'à un seul endroit.
function clampToStock(product: CartItem['product'], desired: number, inventory: Record<string, number>): number {
  if (!product.trackInventory) return desired;
  const stock = inventory[product.id] ?? 0;
  return Math.min(desired, stock);
}

// Champ décimal (kg/mètre/litre...) pour un produit fractionné — un composant
// à part est nécessaire pour garder un brouillon texte local (`draft`) : sans
// lui, le champ contrôlé directement par item.quantity se réinitialise dès
// qu'une frappe intermédiaire (ex. "0" en tapant "0,5") ne peut pas encore
// être validée, empêchant physiquement de taper une quantité < 1 caractère
// par caractère (trouvé lors de l'audit de cette fonctionnalité).
function FractionalQuantityInput({
  item, inventory, onChange,
}: { item: CartItem; inventory: Record<string, number>; onChange: (qty: number) => void }) {
  const [draft, setDraft] = useState(String(item.quantity));

  // Resynchronise l'affichage si la quantité committée change depuis
  // l'extérieur (ex. un clamp stock déclenché ailleurs) — sans casser une
  // frappe en cours puisque ce n'est déclenché que par un vrai changement de
  // item.quantity, pas par le brouillon local. Un `key={item.product.id}`
  // remonterait tout le composant à chaque changement de quantité (y
  // compris ceux causés par ce composant lui-même), ce qui est le
  // comportement qu'on essaie justement d'éviter.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDraft(String(item.quantity)), [item.quantity]);

  return (
    <input
      type="number" min="0.01" step="0.01" inputMode="decimal"
      value={draft}
      onChange={e => {
        const raw = e.target.value;
        setDraft(raw);
        const v = Number(raw);
        if (!Number.isFinite(v) || v <= 0) return;
        const clamped = clampToStock(item.product, v, inventory);
        if (clamped <= 0) return;
        onChange(clamped);
      }}
      onBlur={() => setDraft(String(item.quantity))}
      className="w-20 text-sm font-bold border-2 border-gray-200 rounded-lg px-2 py-1 text-center focus:border-primary-400 focus:outline-none"
    />
  );
}

export function CartPanel({ inventory, canDiscount, onOpenCustomerPicker, onPay }: CartPanelProps) {
  const {
    items, removeItem, updateItemQuantity, removeSerialFromItem, clearCart, setCustomer, customer,
    getSubtotal, getTax, getTotal, getItemCount, discountPercent, setDiscount,
  } = useCartStore();

  const subtotal = getSubtotal();
  const tax = getTax();
  const total = getTotal();

  return (
    <div className="flex-1 min-h-0 lg:flex-none lg:w-80 lg:flex-shrink-0 flex flex-col bg-white rounded-xl border-2 border-gray-100 shadow-sm">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary-600" />
            Panier <Badge className="bg-primary-100 text-primary-700">{getItemCount()}</Badge>
          </h2>
          {items.length > 0 && (
            <button onClick={clearCart} className="text-xs text-red-500 hover:text-red-700 font-medium">Vider</button>
          )}
        </div>
        <button onClick={onOpenCustomerPicker}
          className="w-full flex items-center gap-2 text-sm p-2.5 rounded-lg border-2 border-dashed border-gray-200 hover:border-primary-400 transition-colors">
          <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
          {customer ? (
            <span className="text-gray-900 font-semibold truncate">{displayCustomerName(customer)}</span>
          ) : (
            <span className="text-gray-500">Client comptoir (cliquer pour choisir)</span>
          )}
          {customer && (
            <button
              onClick={e => { e.stopPropagation(); setCustomer(null); }}
              aria-label="Retirer le client sélectionné"
              className="ml-auto text-gray-400 hover:text-red-500 h-8 w-8 flex items-center justify-center flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </button>
      </div>

      {/* Articles */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 py-8">
            <ShoppingCart className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-sm font-medium">Panier vide</p>
            <p className="text-xs mt-1">Cliquez sur un produit</p>
          </div>
        ) : items.map(item => (
          <div key={item.product.id} className="bg-gray-50 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-sm font-semibold text-gray-900 line-clamp-2 flex-1 leading-tight">{item.product.name}</p>
              <button
                onClick={() => removeItem(item.product.id)}
                aria-label={`Retirer ${item.product.name} du panier`}
                className="text-gray-400 hover:text-red-500 h-8 w-8 flex items-center justify-center flex-shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {item.product.trackSerial ? (
              // Chaque exemplaire est distinct : pas de +/- quantité, un
              // numéro se retire individuellement — en ajouter se fait via
              // le picker de série, pas depuis le panier.
              <div className="flex flex-wrap gap-1 mb-2">
                {(item.serials || []).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-full pl-2 pr-1 py-0.5">
                    {s}
                    <button
                      onClick={() => removeSerialFromItem(item.product.id, s)}
                      aria-label={`Retirer le numéro de série ${s}`}
                      className="text-gray-400 hover:text-red-500 h-6 w-6 flex items-center justify-center"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              {item.product.trackSerial ? (
                <span className="text-xs text-gray-500">{item.quantity} exemplaire{item.quantity !== 1 ? 's' : ''}</span>
              ) : item.product.fractionalQuantity ? (
                // Vendu en kg/mètre/litre... (migration 076) : quantité
                // décimale saisie directement, pas de stepper +/- entier —
                // "2,5 m" n'a pas de sens en incréments de 1.
                <FractionalQuantityInput
                  item={item} inventory={inventory}
                  onChange={qty => updateItemQuantity(item.product.id, qty)}
                />
              ) : (
                <div className="flex items-center gap-1">
                  {/* h-10 w-10 (40px) — pas h-7 (28px) : sous la taille
                      tactile utilisable sur un terminal POS, avec un vrai
                      risque de mal-encaisser (mauvaise quantité) sur l'écran
                      le plus utilisé de l'app. Trouvé lors de l'audit
                      accessibilité du 2026-09-29. */}
                  <button
                    onClick={() => item.quantity > 1 ? updateItemQuantity(item.product.id, item.quantity - 1) : removeItem(item.product.id)}
                    aria-label={item.quantity > 1 ? 'Diminuer la quantité' : `Retirer ${item.product.name} du panier`}
                    className="h-10 w-10 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                  <button
                    onClick={() => {
                      const next = item.quantity + 1;
                      if (clampToStock(item.product, next, inventory) < next) return;
                      updateItemQuantity(item.product.id, next);
                    }}
                    aria-label="Augmenter la quantité"
                    className="h-10 w-10 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
              <p className="text-sm font-bold text-primary-600">{formatCurrency(item.total)}</p>
            </div>
            <p className="text-xs text-gray-400 mt-1">{formatCurrency(item.unitPrice)} / {item.product.unit}</p>
          </div>
        ))}
      </div>

      {/* Totaux + payer */}
      {items.length > 0 && (
        <div className="p-4 border-t space-y-3">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600"><span>Sous-total</span><span>{formatCurrency(subtotal)}</span></div>
            {discountPercent > 0 && <div className="flex justify-between text-green-600 font-medium"><span>Remise ({discountPercent}%)</span><span>-{formatCurrency(subtotal * discountPercent / 100)}</span></div>}
            {tax > 0 && <div className="flex justify-between text-gray-600"><span>TVA</span><span>{formatCurrency(tax)}</span></div>}
            <div className="flex justify-between font-bold text-base text-gray-900 pt-2 border-t-2">
              <span>TOTAL</span><span className="text-primary-600">{formatCurrency(total)}</span>
            </div>
          </div>
          {/* Remise libre — négociation manager, jamais un Caissier (voir
              aussi le clamp à 0 côté serveur dans /api/pos/checkout). */}
          {canDiscount && (
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs text-gray-500 flex-shrink-0">Remise :</span>
              {[0, 5, 10, 15, 20].map(d => (
                <button key={d} onClick={() => setDiscount(d, d > 0 ? `Remise ${d}%` : null)}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors flex-shrink-0 ${discountPercent === d ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 text-gray-600 hover:border-primary-400'}`}>
                  {d === 0 ? 'Aucune' : `${d}%`}
                </button>
              ))}
              <div className="relative flex-1">
                <input type="number" min="0" max="100" placeholder="%" value={discountPercent || ''}
                  onChange={e => { const v = Math.min(100, Math.max(0, Number(e.target.value))); setDiscount(v, v > 0 ? `Remise ${v}%` : null); }}
                  className="w-full text-xs border-2 border-gray-200 rounded-lg px-2 py-1 text-center focus:border-primary-400 focus:outline-none" />
              </div>
            </div>
          )}
          <Button onClick={onPay} className="w-full bg-primary-600 hover:bg-primary-700 h-10 font-bold text-base">
            Payer {formatCurrency(total)}
          </Button>
        </div>
      )}
    </div>
  );
}
