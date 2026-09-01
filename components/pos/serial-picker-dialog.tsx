import { useState, useEffect } from 'react';
import { Search, RefreshCw, Package, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase/client';
import { useCartStore } from '@/hooks/store';
import type { Product } from '@/lib/types';

interface SerialPickerDialogProps {
  product: Product | null;
  storeId: string | undefined;
  onClose: () => void;
}

// Produit à suivi de série (product.trackSerial, migration 041) : au POS,
// un clic sur la tuile ouvre ce picker au lieu d'ajouter directement au
// panier — chaque exemplaire est distinct, il faut choisir LEQUEL. La
// disponibilité (IN_STOCK) est revérifiée par pos_checkout() à l'encaissement,
// cette liste est un confort d'affichage, pas la barrière de sécurité.
export function SerialPickerDialog({ product, storeId, onClose }: SerialPickerDialogProps) {
  const { items, addSerialItem } = useCartStore();
  const [available, setAvailable] = useState<{ id: string; serial_number: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!product || !storeId) { setAvailable([]); return; }
    setIsLoading(true);
    setSearch('');
    supabase
      .from('product_serials')
      .select('id, serial_number')
      .eq('product_id', product.id)
      .eq('store_id', storeId)
      .eq('status', 'IN_STOCK')
      .order('serial_number')
      .then(({ data }) => { setAvailable(data || []); setIsLoading(false); });
  }, [product, storeId]);

  const inCart = new Set(
    (items.find((i) => i.product.id === product?.id)?.serials) || []
  );
  const filtered = available.filter(
    (s) => !inCart.has(s.serial_number) && s.serial_number.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={!!product} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Choisir un exemplaire — {product?.name}</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="Rechercher un numéro..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" autoFocus />
        </div>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <Package className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">{available.length === 0 ? 'Aucun exemplaire en stock dans ce magasin' : 'Tous les exemplaires disponibles sont déjà dans le panier'}</p>
            </div>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => product && addSerialItem(product, s.serial_number)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200 hover:border-primary-400 hover:bg-primary-50 text-left transition-colors"
              >
                <span className="text-sm font-mono">{s.serial_number}</span>
                <CheckCircle2 className="h-4 w-4 text-gray-300" />
              </button>
            ))
          )}
        </div>
        {inCart.size > 0 && (
          <p className="text-xs text-gray-500">{inCart.size} déjà dans le panier.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
