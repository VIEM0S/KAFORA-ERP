import { CreditCard, Banknote, Smartphone, User, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils/helpers';
import { useCartStore } from '@/hooks/store';
import { displayCustomerName } from '@/hooks/use-checkout';

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Espèces', icon: Banknote },
  { value: 'MOBILE_MONEY', label: 'Mobile Money', icon: Smartphone },
  { value: 'CARD', label: 'Carte bancaire', icon: CreditCard },
  { value: 'CREDIT', label: 'Crédit client', icon: User },
];

interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  total: number;
  change: number;
  soldeCredit: number;
  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  amountReceived: string;
  setAmountReceived: (v: string) => void;
  checkoutError: string | null;
  isProcessing: boolean;
  onConfirm: () => void;
}

export function PaymentDialog({
  open, onClose, total, change, soldeCredit,
  paymentMethod, setPaymentMethod, amountReceived, setAmountReceived,
  checkoutError, isProcessing, onConfirm,
}: PaymentDialogProps) {
  const { customer } = useCartStore();

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-xl">Finaliser le paiement</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-primary-50 border-2 border-primary-100 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500 mb-1">Montant à payer</p>
            <p className="text-4xl font-bold text-primary-700">{formatCurrency(total)}</p>
            {customer && <p className="text-sm text-gray-600 mt-2 font-medium">Client : {displayCustomerName(customer)}</p>}
          </div>

          {checkoutError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />{checkoutError}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-700">Mode de paiement</Label>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map(m => (
                <button key={m.value} onClick={() => { setPaymentMethod(m.value); setAmountReceived(''); }}
                  className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    paymentMethod === m.value
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  }`}>
                  <m.icon className="h-4 w-4" />{m.label}
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'CASH' && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-gray-700">Montant reçu (FCFA)</Label>
              <Input type="number" placeholder={String(total)} value={amountReceived}
                onChange={e => setAmountReceived(e.target.value)} className="text-xl font-bold h-12 border-2" autoFocus />
              {amountReceived && Number(amountReceived) >= total && (
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-3 text-center">
                  <p className="text-xs text-green-600 font-medium">Monnaie à rendre</p>
                  <p className="text-2xl font-bold text-green-700">{formatCurrency(change)}</p>
                </div>
              )}
              {amountReceived && Number(amountReceived) < total && (
                <p className="text-sm text-red-600 font-medium text-center flex items-center justify-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  Insuffisant — manque {formatCurrency(total - Number(amountReceived))}
                </p>
              )}
            </div>
          )}

          {paymentMethod === 'CREDIT' && (
            <div className="space-y-3">
              {!customer ? (
                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-3 text-sm text-red-700 font-medium text-center">
                  ⚠️ Sélectionnez un client avant de continuer en crédit
                </div>
              ) : (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm">
                    <p className="font-semibold text-blue-900">{displayCustomerName(customer)}</p>
                    {/* Le bloc n'apparaissait QUE si la limite dépassait 0.
                        Or 0 est la valeur par défaut de tout nouveau client,
                        et 0 signifie « aucun crédit autorisé » : la vente
                        allait être refusée, sans le moindre avertissement
                        avant validation. C'était précisément le cas où il
                        fallait prévenir. */}
                    {(customer.creditLimit || 0) <= 0 ? (
                      <p className="mt-1 text-red-700 font-semibold">
                        ⚠️ Ce client n&apos;a aucun plafond de crédit : la vente sera
                        refusée. Définissez sa limite depuis sa fiche client.
                      </p>
                    ) : (
                      <div className="mt-1 text-blue-700">
                        <span>Limite : {formatCurrency(customer.creditLimit)}</span>
                        <span className="mx-2">·</span>
                        <span>Utilisé : {formatCurrency(customer.creditUsed || 0)}</span>
                        <span className="mx-2">·</span>
                        <span className="font-semibold">
                          Disponible : {formatCurrency(Math.max(0, (customer.creditLimit || 0) - (customer.creditUsed || 0)))}
                        </span>
                        {soldeCredit > 0 && (customer.creditUsed || 0) + soldeCredit > (customer.creditLimit || 0) && (
                          <p className="text-amber-700 font-semibold mt-1">⚠️ Dépassement de limite prévu — la vente sera refusée</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-gray-700">Acompte versé maintenant (FCFA)</Label>
                    <Input type="number" min="0" max={total} placeholder="0"
                      value={amountReceived} onChange={e => setAmountReceived(e.target.value)} className="h-12 text-xl font-bold border-2" />
                  </div>
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-3 text-center">
                    <p className="text-xs text-amber-600 font-medium">Solde à rembourser</p>
                    <p className="text-2xl font-bold text-amber-700">{formatCurrency(soldeCredit)}</p>
                    <p className="text-xs text-amber-600 mt-1">Échéance : 30 jours</p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-2">Annuler</Button>
          <Button onClick={onConfirm}
            disabled={
              isProcessing ||
              (paymentMethod === 'CASH' && !!amountReceived && Number(amountReceived) < total) ||
              (paymentMethod === 'CREDIT' && !customer)
            }
            className="bg-green-600 hover:bg-green-700 font-bold px-6">
            {isProcessing
              ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Traitement...</>
              : <><CheckCircle2 className="h-4 w-4 mr-2" />Confirmer la vente</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
