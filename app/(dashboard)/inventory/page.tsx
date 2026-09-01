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
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { mapProduct, mapInventory } from '@/lib/supabase/mappers';
import type { Product, Inventory } from '@/lib/types';
import { estEnAlerte, seuilAlerte } from '@/lib/inventory/alert-threshold';

export default function InventoryPage() {
  const { tenant, currentStore } = useAuthStore();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;

  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAlert, setFilterAlert] = useState('all');

  const [adjProduct, setAdjProduct] = useState<Product | null>(null);
  // Seuil d'alerte PROPRE À CE MAGASIN. Vide = on retombe sur celui du
  // produit. Une boutique et un dépôt n'ont pas le même rythme d'écoulement :
  // un seuil unique alerte trop tôt pour l'une, trop tard pour l'autre.
  const [adjSeuil, setAdjSeuil] = useState('');
  const [adjType, setAdjType] = useState<'add' | 'remove' | 'set'>('add');
  const [adjQty, setAdjQty] = useState('');
  const [adjNote, setAdjNote] = useState('');
  // Péremption (track_expiry) : date requise sur une entrée de stock, crée
  // un lot en plus du total. Série (track_serial) : liste de numéros à la
  // place d'une quantité — la réception ne fait sens qu'en entrée, voir
  // handleAdjust.
  const [adjExpiryDate, setAdjExpiryDate] = useState('');
  const [adjSerials, setAdjSerials] = useState('');
  const [adjError, setAdjError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'products',
      () => supabase.from('products').select('*').eq('tenant_id', tenantId).order('name'),
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

  const getStock = (productId: string) =>
    inventory.find((i) => i.productId === productId && i.storeId === storeId)?.quantity ?? 0;

  /** Seuil applicable à ce produit DANS CE MAGASIN (voir lib/inventory). */
  const seuilDe = (productId: string, seuilProduit: number | null | undefined) =>
    ({
      seuilMagasin: inventory.find(i => i.productId === productId && i.storeId === storeId)?.minQuantity,
      seuilProduit,
    });

  const rows = products.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const stock = getStock(p.id);
    const isLow = estEnAlerte(stock, seuilDe(p.id, p.alertThreshold));
    const matchAlert = filterAlert === 'all' || (filterAlert === 'low' && isLow) || (filterAlert === 'ok' && !isLow);
    return matchSearch && matchAlert && p.trackInventory;
  });

  const lowCount = products.filter((p) => p.trackInventory && estEnAlerte(getStock(p.id), seuilDe(p.id, p.alertThreshold))).length;

  // Numéros de série saisis (un par ligne), nettoyés et dédupliqués.
  const parsedSerials = Array.from(new Set(
    adjSerials.split('\n').map((s) => s.trim()).filter(Boolean)
  ));

  const handleAdjust = async () => {
    if (!tenantId || !storeId || !adjProduct) return;
    const isSerialEntry = adjProduct.trackSerial;
    const qty = isSerialEntry ? parsedSerials.length : Number(adjQty);
    if (!qty) return;
    if (adjProduct.trackExpiry && adjType === 'add' && !adjExpiryDate) {
      setAdjError('La date de péremption est requise pour une entrée de stock.');
      return;
    }
    setIsSaving(true);
    setAdjError(null);
    try {
      const currentQty = getStock(adjProduct.id);
      const newQty = adjType === 'add' ? currentQty + qty : adjType === 'remove' ? Math.max(0, currentQty - qty) : qty;
      const minQuantity = adjSeuil.trim() === '' ? null : Number(adjSeuil);

      const existing = inventory.find((i) => i.productId === adjProduct.id && i.storeId === storeId);
      if (existing) {
        await supabase.from('inventory').update({
          quantity: newQty,
          // `null` efface le seuil propre au magasin et fait retomber sur
          // celui du produit — distinct de 0, qui désactive l'alerte.
          min_quantity: minQuantity,
        }).eq('id', existing.id);
      } else {
        await supabase.from('inventory').insert({
          tenant_id: tenantId, product_id: adjProduct.id, store_id: storeId, quantity: newQty,
          min_quantity: minQuantity,
        });
      }

      // Ventilation additionnelle (lots ou séries), en plus du total
      // inventory.quantity déjà à jour ci-dessus — voir migration 041.
      // Seule l'ENTRÉE de stock crée un lot/des séries : une sortie ou une
      // correction manuelle ne sait pas quel lot/exemplaire précis retirer
      // (ça, c'est le rôle de la vente POS pour la série, et de "Marquer
      // périmé" pour un lot).
      if (adjType === 'add' && adjProduct.trackExpiry) {
        const { error } = await supabase.from('product_lots').insert({
          tenant_id: tenantId, product_id: adjProduct.id, store_id: storeId,
          quantity: qty, expiry_date: adjExpiryDate, notes: adjNote || null,
        });
        if (error) throw error;
      }
      if (adjType === 'add' && isSerialEntry) {
        const { error } = await supabase.from('product_serials').insert(
          parsedSerials.map((serial_number) => ({
            tenant_id: tenantId, product_id: adjProduct.id, store_id: storeId, serial_number,
          }))
        );
        if (error) throw error;
      }

      // type ADJUSTMENT pour les deux sens (entrée/sortie manuelle) — même
      // valeur d'enum que l'annulation de vente (cancel_sale), qui restocke
      // aussi sous ADJUSTMENT ; le sens se lit dans le signe de `quantity`,
      // pas dans un type "IN"/"OUT" séparé qui n'existe pas dans l'enum
      // inventory_movement_type (les valeurs IN/OUT de l'ancien code
      // Firestore n'avaient jamais été harmonisées avec le reste de l'app).
      await supabase.from('inventory_movements').insert({
        tenant_id: tenantId, product_id: adjProduct.id, product_name: adjProduct.name, store_id: storeId,
        type: 'ADJUSTMENT',
        quantity: adjType === 'set' ? newQty - currentQty : (adjType === 'remove' ? -qty : qty),
        previous_quantity: currentQty, new_quantity: newQty,
        reason: adjNote || 'Ajustement manuel',
      });
      setAdjProduct(null); setAdjQty(''); setAdjNote(''); setAdjSeuil(''); setAdjExpiryDate(''); setAdjSerials('');
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setAdjError(
        code === '23505'
          ? 'Un ou plusieurs numéros de série sont déjà enregistrés pour ce produit.'
          : "Erreur lors de l'enregistrement. Réessayez."
      );
      console.error(e);
    }
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
                  const isLow = estEnAlerte(stock, seuilDe(p.id, p.alertThreshold));
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
                      {/* Seuil EFFECTIF (magasin s'il est défini, sinon produit) — pas
                          p.alertThreshold brut, qui affichait toujours le seuil du
                          produit même quand ce magasin avait son propre seuil, en
                          contradiction avec la colonne État juste à côté qui, elle,
                          utilise déjà le bon seuil via seuilDe(). */}
                      <TableCell className="text-right text-sm text-gray-500">{seuilAlerte(seuilDe(p.id, p.alertThreshold))}</TableCell>
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
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
                          setAdjProduct(p); setAdjType('add'); setAdjQty(''); setAdjNote('');
                          setAdjExpiryDate(''); setAdjSerials(''); setAdjError(null);
                          // Pré-remplir le seuil existant : sans cela, chaque
                          // ajustement de stock l'aurait silencieusement effacé.
                          const inv = inventory.find(i => i.productId === p.id && i.storeId === storeId);
                          setAdjSeuil(inv?.minQuantity == null ? '' : String(inv.minQuantity));
                        }}>
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

            {adjError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{adjError}</div>
            )}

            {/* Un produit à numéro de série ne se reçoit qu'en entrée : retirer
                un exemplaire précis se fait à la vente, pas ici. */}
            {adjProduct?.trackSerial ? (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-700">
                Réception de nouveaux exemplaires — un numéro de série par ligne ci-dessous.
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Type d&apos;ajustement</Label>
                <Select value={adjType} onValueChange={(v) => setAdjType(v as 'add' | 'remove' | 'set')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add">➕ Entrée de stock</SelectItem>
                    <SelectItem value="remove">➖ Sortie de stock</SelectItem>
                    <SelectItem value="set">🎯 Définir la quantité exacte</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {adjProduct?.trackSerial ? (
              <div className="space-y-2">
                <Label>Numéros de série / IMEI *</Label>
                <Textarea
                  placeholder={'Un numéro par ligne\nex: 359123456789012'}
                  value={adjSerials} onChange={(e) => setAdjSerials(e.target.value)} rows={5}
                />
                <p className="text-xs text-gray-500">{parsedSerials.length} numéro{parsedSerials.length !== 1 ? 's' : ''} détecté{parsedSerials.length !== 1 ? 's' : ''}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Quantité *</Label>
                <Input type="number" placeholder="0" min="0" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} />
              </div>
            )}

            {adjProduct?.trackExpiry && adjType === 'add' && (
              <div className="space-y-2">
                <Label>Date de péremption *</Label>
                <Input type="date" value={adjExpiryDate} onChange={(e) => setAdjExpiryDate(e.target.value)} />
                <p className="text-xs text-gray-500">Ce lot sera vendu en priorité si sa date est la plus proche (FEFO).</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Seuil d&apos;alerte pour ce magasin</Label>
              <Input
                type="number" min="0" placeholder={`Par défaut : ${adjProduct?.alertThreshold ?? 10}`}
                value={adjSeuil} onChange={(e) => setAdjSeuil(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                Laissez vide pour utiliser le seuil du produit. 0 = aucune alerte
                sur cet article dans ce magasin.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Motif</Label>
              <Textarea placeholder="ex: Réception commande fournisseur, inventaire physique..." value={adjNote} onChange={(e) => setAdjNote(e.target.value)} rows={2} />
            </div>
            {adjProduct && (adjQty || parsedSerials.length > 0) && (
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                Nouveau stock : <strong>
                  {adjProduct.trackSerial ? getStock(adjProduct.id) + parsedSerials.length
                   : adjType === 'add' ? getStock(adjProduct.id) + Number(adjQty)
                   : adjType === 'remove' ? Math.max(0, getStock(adjProduct.id) - Number(adjQty))
                   : Number(adjQty)} {adjProduct.unit}
                </strong>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjProduct(null)}>Annuler</Button>
            <Button
              onClick={handleAdjust}
              disabled={isSaving || (adjProduct?.trackSerial ? parsedSerials.length === 0 : !adjQty)}
              className="bg-primary-600 hover:bg-primary-700"
            >
              {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : 'Confirmer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
