'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Package, RefreshCw, CheckCircle2, Bell } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils/helpers';
import { useAuthStore } from '@/hooks/store';
import { collection, query, orderBy, where } from 'firebase/firestore';
// onSnapshot vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/firebase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { onSnapshot } from '@/lib/firebase/watch';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { useRouter } from 'next/navigation';
import { estEnAlerte, seuilAlerte } from '@/lib/inventory/alert-threshold';

interface Product { id: string; name: string; sku: string; unit: string; alertThreshold: number; purchasePrice: number; trackInventory: boolean; }
interface InventoryItem { id: string; productId: string; storeId: string; quantity: number; minQuantity?: number; }

export default function AlertsPage() {
  const { tenant, currentStore } = useAuthStore();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    const unsubP = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'products')), where('isActive', '==', true), where('trackInventory', '==', true), orderBy('name')),
      snap => { setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]); setIsLoading(false); }
    );
    const unsubI = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'inventory')), where('storeId', '==', storeId)),
      snap => {
      setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() })) as InventoryItem[]);
    });
    return () => { unsubP(); unsubI(); };
  }, [tenantId]);

  const getStock = (productId: string) =>
    inventory.find(i => i.productId === productId && i.storeId === storeId)?.quantity ?? 0;

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
          <Button onClick={() => router.push('/inventory')} variant="outline">
            Gérer l&apos;inventaire
          </Button>
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
      </div>
    </DashboardLayout>
  );
}
