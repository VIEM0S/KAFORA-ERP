'use client';

import { useState, useEffect } from 'react';
import { Search, AlertTriangle, Package, RefreshCw, Plus, Minus, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/utils/helpers';
import { useAuthStore } from '@/hooks/store';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, getDocs, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { tenantCol, inventoryKey } from '@/lib/firebase/collections';
import type { Product } from '@/lib/types';

interface InventoryItem { id: string; productId: string; storeId: string; quantity: number; minQuantity?: number; }

export default function InventoryPage() {
  const { tenant, currentStore } = useAuthStore();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;

  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAlert, setFilterAlert] = useState('all');

  const [adjProduct, setAdjProduct] = useState<Product | null>(null);
  const [adjType, setAdjType] = useState<'add' | 'remove' | 'set'>('add');
  const [adjQty, setAdjQty] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const unsubP = onSnapshot(query(collection(db, tenantCol(tenantId, 'products')), orderBy('name')), (snap) => {
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Product[]);
      setIsLoading(false);
    });
    const unsubI = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'inventory')), where('storeId', '==', storeId)),
      (snap) => {
      setInventory(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as InventoryItem[]);
    });
    return () => { unsubP(); unsubI(); };
  }, [tenantId]);

  const getStock = (productId: string) =>
    inventory.find((i) => i.productId === productId && i.storeId === storeId)?.quantity ?? 0;

  const rows = products.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const stock = getStock(p.id);
    const isLow = stock <= p.alertThreshold;
    const matchAlert = filterAlert === 'all' || (filterAlert === 'low' && isLow) || (filterAlert === 'ok' && !isLow);
    return matchSearch && matchAlert && p.trackInventory;
  });

  const lowCount = products.filter((p) => p.trackInventory && getStock(p.id) <= p.alertThreshold).length;

  const handleAdjust = async () => {
    if (!tenantId || !storeId || !adjProduct || !adjQty) return;
    setIsSaving(true);
    try {
      const qty = Number(adjQty);
      const currentQty = getStock(adjProduct.id);
      let newQty = adjType === 'add' ? currentQty + qty : adjType === 'remove' ? Math.max(0, currentQty - qty) : qty;

      const invKey = inventoryKey(adjProduct.id, storeId);
      const existing = inventory.find((i) => i.productId === adjProduct.id && i.storeId === storeId);
      if (existing) {
        await updateDoc(doc(db, tenantCol(tenantId, 'inventory'), existing.id), { quantity: newQty, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, tenantCol(tenantId, 'inventory')), {
          tenantId, productId: adjProduct.id, storeId, quantity: newQty, minQuantity: adjProduct.alertThreshold, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      }
      await addDoc(collection(db, tenantCol(tenantId, 'inventory_movements')), {
        tenantId, productId: adjProduct.id, storeId,
        type: adjType === 'add' ? 'IN' : adjType === 'remove' ? 'OUT' : 'ADJUSTMENT',
        quantity: adjType === 'set' ? newQty - currentQty : (adjType === 'remove' ? -qty : qty),
        previousQuantity: currentQty, newQuantity: newQty,
        reason: adjNote || 'Ajustement manuel', createdAt: serverTimestamp(),
      });
      setAdjProduct(null); setAdjQty(''); setAdjNote('');
    } catch (e) { console.error(e); }
    finally { setIsSaving(false); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inventaire</h1>
            <p className="text-sm text-gray-500 mt-1">{rows.length} produit{rows.length !== 1 ? 's' : ''} suivis {lowCount > 0 && <span className="text-amber-600 font-medium">· {lowCount} en stock faible</span>}</p>
          </div>
        </div>

        <Card><CardContent className="p-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Rechercher un produit..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterAlert} onValueChange={setFilterAlert}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les produits</SelectItem>
                <SelectItem value="low">Stock faible</SelectItem>
                <SelectItem value="ok">Stock suffisant</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent></Card>

        <Card><CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Package className="h-12 w-12 mb-4 opacity-30" />
              <p className="font-medium">Aucun produit en inventaire</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Stock actuel</TableHead>
                  <TableHead className="text-right">Seuil alerte</TableHead>
                  <TableHead className="text-right">Valeur stock</TableHead>
                  <TableHead className="text-center">État</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const stock = getStock(p.id);
                  const isLow = stock <= p.alertThreshold;
                  return (
                    <TableRow key={p.id} className={`hover:bg-gray-50 ${isLow ? 'bg-amber-50/40' : ''}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {isLow && <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />}
                          <span className="font-medium text-sm">{p.name}</span>
                        </div>
                      </TableCell>
                      <TableCell><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{p.sku}</code></TableCell>
                      <TableCell className={`text-right font-bold ${isLow ? 'text-amber-600' : 'text-gray-900'}`}>{stock} <span className="text-xs font-normal text-gray-400">{p.unit}</span></TableCell>
                      <TableCell className="text-right text-sm text-gray-500">{p.alertThreshold}</TableCell>
                      <TableCell className="text-right text-sm">
                        {/* Sans prix d'achat, la valeur du stock est inconnue —
                            l'afficher à 0 laisserait croire à un stock sans
                            valeur, ce qui fausse l'inventaire comptable. */}
                        {p.purchasePrice == null
                          ? <span className="text-amber-600">—</span>
                          : formatCurrency(stock * p.purchasePrice)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${isLow ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                          {isLow ? 'Faible' : 'OK'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setAdjProduct(p); setAdjType('add'); setAdjQty(''); setAdjNote(''); }}>
                          Ajuster
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>

      <Dialog open={!!adjProduct} onOpenChange={(o) => { if (!o) setAdjProduct(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ajuster le stock — {adjProduct?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              Stock actuel : <strong>{adjProduct ? getStock(adjProduct.id) : 0} {adjProduct?.unit}</strong>
            </div>
            <div className="space-y-2">
              <Label>Type d'ajustement</Label>
              <Select value={adjType} onValueChange={(v) => setAdjType(v as 'add' | 'remove' | 'set')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">➕ Entrée de stock</SelectItem>
                  <SelectItem value="remove">➖ Sortie de stock</SelectItem>
                  <SelectItem value="set">🎯 Définir la quantité exacte</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantité *</Label>
              <Input type="number" placeholder="0" min="0" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Motif</Label>
              <Textarea placeholder="ex: Réception commande fournisseur, inventaire physique..." value={adjNote} onChange={(e) => setAdjNote(e.target.value)} rows={2} />
            </div>
            {adjQty && adjProduct && (
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                Nouveau stock : <strong>
                  {adjType === 'add' ? getStock(adjProduct.id) + Number(adjQty)
                   : adjType === 'remove' ? Math.max(0, getStock(adjProduct.id) - Number(adjQty))
                   : Number(adjQty)} {adjProduct.unit}
                </strong>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjProduct(null)}>Annuler</Button>
            <Button onClick={handleAdjust} disabled={isSaving || !adjQty} className="bg-primary-600 hover:bg-primary-700">
              {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : 'Confirmer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
