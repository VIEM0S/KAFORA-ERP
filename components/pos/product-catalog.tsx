import { Search, X, AlertTriangle, RefreshCw, Package, Clock, WifiOff, Wifi, CloudUpload } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils/helpers';
import { useCartStore } from '@/hooks/store';
import type { QueuedSale } from '@/lib/offline-queue';
import type { Product } from '@/lib/types';

interface ProductCatalogProps {
  products: Product[];
  inventory: Record<string, number>;
  isLoading: boolean;
  search: string;
  setSearch: (v: string) => void;
  isSearching: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  checkoutError: string | null;
  showPayment: boolean;
  onAddItem: (p: Product) => void;
  outsideHours: boolean;
  workingHours: { start: string; end: string } | null | undefined;
  isOnline: boolean;
  pendingQueue: QueuedSale[];
  isSyncing: boolean;
  onSync: () => void;
}

export function ProductCatalog({
  products, inventory, isLoading, search, setSearch, isSearching, hasMore, onLoadMore,
  checkoutError, showPayment, onAddItem,
  outsideHours, workingHours, isOnline, pendingQueue, isSyncing, onSync,
}: ProductCatalogProps) {
  const { items } = useCartStore();

  // Plus de filtrage en mémoire : la recherche est faite côté serveur par
  // usePosData. Filtrer ici reviendrait à ne chercher que dans la page
  // courante — donc à ne pas trouver un produit pourtant existant.
  const filteredProducts = products;

  return (
    <div className="flex-1 flex flex-col gap-3 min-w-0">
      {outsideHours && (
        <div className="rounded-lg border bg-slate-50 border-slate-200 text-slate-700 text-sm px-4 py-2 flex items-center gap-2">
          <Clock className="h-4 w-4 flex-shrink-0" />
          Tu es en dehors de tes horaires habituels ({workingHours?.start}–{workingHours?.end}). Ceci n&apos;empêche pas de vendre — c&apos;est juste un rappel.
        </div>
      )}
      {(!isOnline || pendingQueue.length > 0) && (
        <div className={`rounded-lg border text-sm ${
          !isOnline ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              {!isOnline ? <WifiOff className="h-4 w-4 flex-shrink-0" /> : <Wifi className="h-4 w-4 flex-shrink-0" />}
              <span>
                {!isOnline
                  ? 'Hors connexion — les ventes sont enregistrées localement et se synchroniseront au retour du réseau.'
                  : `${pendingQueue.length} vente${pendingQueue.length > 1 ? 's' : ''} en attente de synchronisation.`}
              </span>
            </div>
            {isOnline && pendingQueue.length > 0 && (
              <Button size="sm" variant="outline" onClick={onSync} disabled={isSyncing} className="h-7 text-xs">
                {isSyncing ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <CloudUpload className="h-3 w-3 mr-1" />}
                Synchroniser
              </Button>
            )}
          </div>
          {/* Ventes qui n'ont pas pu se synchroniser du tout (rare : produit
              supprimé, session expirée...). Le stock insuffisant et le
              dépassement de crédit ne bloquent PLUS ici — ils sont acceptés
              côté serveur et remontés comme alerte à régulariser. */}
          {pendingQueue.some(s => s.status === 'ERROR') && (
            <div className="border-t border-current/20 px-4 py-2 space-y-1.5 bg-red-50 text-red-800 rounded-b-lg">
              <p className="text-xs font-medium">
                {pendingQueue.filter(s => s.status === 'ERROR').length} vente(s) n&apos;ont pas pu être synchronisées :
              </p>
              {pendingQueue.filter(s => s.status === 'ERROR').map(s => (
                <div key={s.localId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    {formatCurrency(s.displayTotal)} — {s.errorMessage || 'Erreur inconnue'} ({s.attempts} tentative{s.attempts > 1 ? 's' : ''})
                  </span>
                  <Button size="sm" variant="ghost" onClick={onSync} disabled={isSyncing} className="h-6 text-xs flex-shrink-0">
                    Réessayer
                  </Button>
                </div>
              ))}
              <p className="text-[11px] text-red-700/80">
                Signaler à un manager si le problème persiste après plusieurs tentatives.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="Rechercher un produit ou scanner un code-barres..."
          value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X className="h-4 w-4" /></button>}
      </div>

      {checkoutError && !showPayment && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{checkoutError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredProducts.map(p => {
              const stock = inventory[p.id] ?? 0;
              const outOfStock = p.trackInventory && stock <= 0;
              const cartQty = items.find(i => i.product.id === p.id)?.quantity || 0;
              const stockLeft = stock - cartQty;
              const almostOut = p.trackInventory && stockLeft > 0 && stockLeft <= p.alertThreshold;
              return (
                <button key={p.id} onClick={() => onAddItem(p)} disabled={outOfStock}
                  className={`relative text-left p-3 rounded-xl border-2 transition-all ${
                    outOfStock
                      ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-50'
                      : cartQty > 0
                      ? 'border-primary-500 bg-primary-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-primary-400 hover:shadow-md active:scale-95'
                  }`}>
                  {cartQty > 0 && (
                    <span className="absolute -top-2 -right-2 h-6 w-6 bg-primary-600 text-white text-xs rounded-full flex items-center justify-center font-bold shadow">
                      {cartQty}
                    </span>
                  )}
                  {outOfStock && (
                    <span className="absolute top-1 right-1 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">Rupture</span>
                  )}
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center mb-2 ${outOfStock ? 'bg-gray-100' : 'bg-primary-100'}`}>
                    <Package className={`h-5 w-5 ${outOfStock ? 'text-gray-300' : 'text-primary-500'}`} />
                  </div>
                  <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-tight">{p.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{p.sku}</p>
                  <p className="text-sm font-bold text-primary-600 mt-2">{formatCurrency(p.sellingPrice)}</p>
                  {p.trackInventory && (
                    <p className={`text-xs mt-1 font-medium ${outOfStock ? 'text-red-500' : almostOut ? 'text-amber-500' : 'text-gray-400'}`}>
                      {outOfStock ? 'Rupture' : `${stockLeft} restant${stockLeft > 1 ? 's' : ''}`}
                    </p>
                  )}
                </button>
              );
            })}
            {filteredProducts.length === 0 && (
              <div className="col-span-4 flex flex-col items-center justify-center py-16 text-gray-400">
                <Package className="h-12 w-12 mb-4 opacity-30" />
                <p>{isSearching ? 'Recherche en cours…' : 'Aucun produit trouvé'}</p>
                {!isSearching && search && !isOnline && (
                  <p className="text-xs mt-2 text-center max-w-xs">
                    Vous êtes hors ligne : seuls les produits déjà consultés
                    sont disponibles à la recherche.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {hasMore && !search && (
          <div className="flex justify-center py-4">
            <button
              onClick={onLoadMore}
              className="px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 rounded-lg hover:bg-primary-100"
            >
              Afficher plus de produits
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
