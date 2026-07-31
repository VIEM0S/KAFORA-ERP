import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCartStore } from '@/hooks/store';
import { displayCustomerName } from '@/hooks/use-checkout';
import type { Customer } from '@/lib/types';

interface CustomerPickerDialogProps {
  customers: Customer[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: (term: string) => void;
}

export function CustomerPickerDialog({ customers, open, onOpenChange, onSearch }: CustomerPickerDialogProps) {
  const { customer, setCustomer } = useCartStore();
  const [customerSearch, setCustomerSearch] = useState('');

  // La recherche part côté serveur : les clients ne sont plus tous chargés
  // d'avance. Débounce pour ne pas requêter à chaque frappe.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => onSearch(customerSearch), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSearch, open]);

  // Filtrage local en plus : il affine instantanément le lot déjà reçu
  // pendant que la requête serveur est en vol (confort de frappe).
  const filteredCustomers = customers.filter(c => {
    const name = `${c.firstName || ''} ${c.lastName || ''} ${c.companyName || ''}`.toLowerCase();
    return !customerSearch || name.includes(customerSearch.toLowerCase()) || (c.phone || '').includes(customerSearch);
  });

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onOpenChange(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Sélectionner un client</DialogTitle></DialogHeader>
        <Input placeholder="Rechercher..." value={customerSearch}
          onChange={e => setCustomerSearch(e.target.value)} autoFocus className="border-2" />
        <div className="max-h-72 overflow-y-auto space-y-1 mt-2">
          <button onClick={() => { setCustomer(null); onOpenChange(false); }}
            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-100 text-sm text-gray-500 font-medium">
            ✕ Client comptoir (sans compte)
          </button>
          {filteredCustomers.map(c => (
            <button key={c.id} onClick={() => { setCustomer(c); onOpenChange(false); setCustomerSearch(''); }}
              className={`w-full text-left px-3 py-2.5 rounded-lg hover:bg-primary-50 text-sm transition-colors ${customer?.id === c.id ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-800'}`}>
              <p className="font-semibold">{displayCustomerName(c)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{c.phone || c.email || c.code}</p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
