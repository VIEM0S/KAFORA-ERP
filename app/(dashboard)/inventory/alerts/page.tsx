'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Package, RefreshCw, CheckCircle2, Bell } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils/helpers';
import { useAuthStore } from '@/hooks/store';
import { isManagerPlus } from '@/lib/auth/roles';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { mapProduct, mapInventory } from '@/lib/supabase/mappers';
import { useRouter } from 'next/navigation';
import { estEnAlerte, seuilAlerte } from '@/lib/inventory/alert-threshold';
import { ShoppingCart } from 'lucide-react';
import { PO_REORDER_SUGGESTION_KEY, type ReorderSuggestionLine } from '@/lib/purchase-orders/reorder-suggestion';
import { mapProductLot } from '@/lib/supabase/mappers';
import { formatDate } from '@/lib/utils/helpers';
import { CalendarClock } from 'lucide-react';
import type { Product, Inventory, ProductLot } from '@/lib/types';

const EXPIRY_WARNING_DAYS = 30;

// Date.now() en dehors du composant : un appel direct dans le corps du
// composant est refusé par la règle react-hooks/purity (même via useMemo,
// qui s'exécute encore au rendu) — même motif que isEcheanceProche() /
// isEnRetard() dans app/(dashboard)/credits/page.tsx.
function isLotExpired(expiryDate: Date): boolean {
  return expiryDate.getTime() < Date.now();
}
function daysUntilExpiry(expiryDate: Date): number {
  return (expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}

export default function AlertsPage() {
  const { tenant, currentStore, user } = useAuthStore();
  // inventory_write (RLS) exige is_manager() — décision d'affichage
  // seulement, la vraie barrière reste la policy.
  const canManage = isManagerPlus(user?.role);
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lots, setLots] = useState<ProductLot[]>([]);
  const [expiringLotId, setExpiringLotId] = useState<string | null>(null); // en cours d'écriture

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'products',
      () => supabase.from('products').select('*').eq('tenant_id', tenantId).eq('is_active', true).eq('track_inventory', true).order('name'),
      rows => { setProducts(rows.map(mapProduct)); setIsLoading(false); },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !storeId) return;
    return watch(
      'inventory',
      () => supabase.from('inventory').select('*').eq('tenant_id', tenantId).eq('store_id', storeId),
      rows => setInventory(rows.map(mapInventory)),
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId]);

  useEffect(() => {
    if (!tenantId || !storeId) return;
    return watch(
      'product_lots',
      () => supabase.from('product_lots').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
        .gt('quantity', 0).order('expiry_date', { ascending: true }),
      rows => setLots(rows.map(mapProductLot)),
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId]);

  const getStock = (productId: string) =>
    inventory.find(i => i.productId === productId && i.storeId === storeId)?.quantity ?? 0;

  const productById = (id: string) => products.find(p => p.id === id);
  const expiredLots = lots.filter(l => isLotExpired(l.expiryDate));
  const soonLots = lots.filter(l => {
    const days = daysUntilExpiry(l.expiryDate);
    return days >= 0 && days <= EXPIRY_WARNING_DAYS;
  });

  // Écrit le lot comme périmé : remet sa quantité à 0 et décrémente le
  // total inventory.quantity d'autant, avec un mouvement ADJUSTMENT tracé —
  // même esprit qu'un ajustement manuel de stock (inventory/page.tsx).
  const handleMarkExpired = async (lot: ProductLot) => {
    if (!tenantId) return;
    const product = productById(lot.productId);
    setExpiringLotId(lot.id);
    try {
      await supabase.from('product_lots').update({ quantity: 0 }).eq('id', lot.id);
      const inv = inventory.find(i => i.productId === lot.productId && i.storeId === lot.storeId);
      const currentQty = inv?.quantity ?? 0;
      const newQty = Math.max(0, currentQty - lot.quantity);
      if (inv) await supabase.from('inventory').update({ quantity: newQty }).eq('id', inv.id);
      await supabase.from('inventory_movements').insert({
        tenant_id: tenantId, product_id: lot.productId, product_name: product?.name || 'Produit',
        store_id: lot.storeId, type: 'ADJUSTMENT', quantity: -lot.quantity,
        previous_quantity: currentQty, new_quantity: newQty, reason: 'Péremption',
      });
    } catch (e) { console.error(e); }
    finally { setExpiringLotId(null); }
  };

  // Fix multi-store : getStock filtre déjà par storeId via inventory.find(i => i.storeId === storeId)
  const ruptures = products.filter(p => p.trackInventory && getStock(p.id) === 0);
  /** Seuil applicable à ce produit dans le magasin courant. */
  const seuilDe = (p: Product) =>
    seuilAlerte({
      seuilMagasin: inventory.find(i => i.productId === p.id)?.minQuantity,
      seuilProduit: p.alertThreshold,
    });

  const stockBas = products.filter(
    p => p.trackInventory && getStock(p.id) > 0 && estEnAlerte(getStock(p.id), {
      seuilMagasin: inventory.find(i => i.productId === p.id)?.minQuantity,
      seuilProduit: p.alertThreshold,
    })
  );
  const allAlerts = [
    ...ruptures.map(p => ({ ...p, stock: 0, type: 'RUPTURE' as const })),
    ...stockBas.map(p => ({ ...p, stock: getStock(p.id), type: 'STOCK_BAS' as const })),
  ];

  // Produits sans prix d'achat exclus : les compter à 0 sous-évaluerait le
  // réassort nécessaire sans le dire (voir la note sur le prix facultatif).
  const valeurManquante = ruptures.reduce(
    (s, p) => s + (p.purchasePrice == null ? 0 : seuilDe(p) * p.purchasePrice), 0
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Alertes stock</h1>
            <p className="text-sm text-gray-500 mt-1">
              {allAlerts.length} alerte{allAlerts.length !== 1 ? 's' : ''} active{allAlerts.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {allAlerts.length > 0 && (
              <Button
                onClick={() => {
                  const suggestion: ReorderSuggestionLine[] = allAlerts.map(p => ({
                    productId: p.id,
                    // "Manquant" (déjà affiché dans le tableau ci-dessous) : la
                    // quantité qui ramène juste au-dessus du seuil d'alerte. Au
                    // moins 1 pour garder la ligne valide si l'écart calculé est nul.
                    quantityOrdered: Math.max(1, seuilDe(p) - p.stock),
                  }));
                  sessionStorage.setItem(PO_REORDER_SUGGESTION_KEY, JSON.stringify(suggestion));
                  router.push('/purchase-orders');
                }}
                className="bg-primary-600 hover:bg-primary-700"
              >
                <ShoppingCart className="h-4 w-4 mr-2" />Créer un bon de commande
              </Button>
            )}
            <Button onClick={() => router.push('/inventory')} variant="outline">
              Gérer l&apos;inventaire
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-red-200"><CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-red-500" />
              <div><p className="text-xs text-gray-500">Ruptures de stock</p><p className="text-2xl font-bold text-red-600">{ruptures.length}</p></div>
            </div>
          </CardContent></Card>
          <Card className="border-amber-200"><CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <div><p className="text-xs text-gray-500">Stock bas</p><p className="text-2xl font-bold text-amber-600">{stockBas.length}</p></div>
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-8 w-8 text-blue-500" />
              <div><p className="text-xs text-gray-500">Valeur à réapprovisionner</p><p className="text-lg font-bold text-blue-600">{formatCurrency(valeurManquante)}</p></div>
            </div>
          </CardContent></Card>
        </div>

        {allAlerts.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center justify-center py-20 text-gray-400">
            <CheckCircle2 className="h-16 w-16 mb-4 text-green-400" />
            <p className="text-lg font-medium text-gray-600">Aucune alerte stock</p>
            <p className="text-sm mt-1">Tous vos produits sont au-dessus du seuil d&apos;alerte</p>
          </CardContent></Card>
        ) : (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-center">Alerte</TableHead>
                  <TableHead className="text-right">Stock actuel</TableHead>
                  <TableHead className="text-right">Seuil</TableHead>
                  <TableHead className="text-right">Manquant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allAlerts.map(p => (
                  <TableRow key={p.id} className={`hover:bg-gray-50 ${p.type === 'RUPTURE' ? 'bg-red-50/40' : 'bg-amber-50/30'}`}>
                    <TableCell className="font-medium text-sm">{p.name}</TableCell>
                    <TableCell><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{p.sku}</code></TableCell>
                    <TableCell className="text-center">
                      {p.type === 'RUPTURE' ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium">
                          <Package className="h-3 w-3" />Rupture
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
                          <AlertTriangle className="h-3 w-3" />Stock bas
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-bold ${p.type === 'RUPTURE' ? 'text-red-600' : 'text-amber-600'}`}>
                      {p.stock} {p.unit}
                    </TableCell>
                    <TableCell className="text-right text-sm text-gray-500">{seuilDe(p)} {p.unit}</TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {Math.max(0, seuilDe(p) - p.stock)} {p.unit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        )}

        {/* Péremption — voir migration 041 (product_lots). Même principe
            visuel que le bandeau "Échéances proches" de la page Crédits :
            une requête au chargement, pas de cron pour ce MVP. */}
        {(expiredLots.length > 0 || soonLots.length > 0) && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-red-500" />Péremption
            </h2>
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead className="text-right">Quantité</TableHead>
                    <TableHead>Péremption</TableHead>
                    <TableHead className="text-center">État</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...expiredLots, ...soonLots].map(lot => {
                    const product = productById(lot.productId);
                    const expired = isLotExpired(lot.expiryDate);
                    return (
                      <TableRow key={lot.id} className={`hover:bg-gray-50 ${expired ? 'bg-red-50/40' : 'bg-amber-50/30'}`}>
                        <TableCell className="font-medium text-sm">{product?.name || 'Produit supprimé'}</TableCell>
                        <TableCell className="text-right text-sm">{lot.quantity} {product?.unit}</TableCell>
                        <TableCell className="text-sm">{formatDate(lot.expiryDate)}</TableCell>
                        <TableCell className="text-center">
                          {expired ? (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium">Périmé</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">Bientôt</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {canManage && (
                            <Button
                              variant="outline" size="sm" className="h-7 text-xs"
                              disabled={expiringLotId === lot.id}
                              onClick={() => handleMarkExpired(lot)}
                            >
                              Marquer périmé
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
