'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Plus, Search, PackageCheck, Truck, RefreshCw, X, ChevronDown, Download,
  Trash2, PackagePlus, Clock, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuthStore } from '@/hooks/store';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { mapPurchaseOrder, mapPurchaseOrderItem } from '@/lib/supabase/mappers';
import { formatCurrency } from '@/lib/utils/helpers';
import { exportToCsv, formatDateForCsv } from '@/lib/utils/export';
import { PO_REORDER_SUGGESTION_KEY, type ReorderSuggestionLine } from '@/lib/purchase-orders/reorder-suggestion';
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/types';

/** Fournisseur allégé pour cet écran — pas de mapSupplier() (`select('*')`
 * complet) : seuls ces champs sont réellement utilisés ici (dropdown de
 * création + libellé). Voir products/suppliers ci-dessous pour le même motif. */
interface SupplierLite { id: string; name: string; isActive: boolean; paymentTerms: number | null }
/** Produit allégé — idem, et purchasePrice vient de la relation product_costs
 * (voir costOf() dans lib/supabase/mappers.ts, non exportée, reproduite ici
 * pour n'extraire que cette colonne au lieu du `select('*', ...)` complet). */
interface ProductLite { id: string; name: string; sku: string; trackExpiry: boolean; trackSerial: boolean; purchasePrice: number | null }

const STATUS_LABELS: Record<PurchaseOrderStatus, { label: string; color: string; icon: typeof Clock }> = {
  DRAFT: { label: 'Brouillon', color: 'bg-gray-100 text-gray-600', icon: Clock },
  SENT: { label: 'Envoyé', color: 'bg-blue-100 text-blue-700', icon: Truck },
  PARTIALLY_RECEIVED: { label: 'Reçu partiellement', color: 'bg-amber-100 text-amber-700', icon: AlertCircle },
  RECEIVED: { label: 'Reçu', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  CANCELLED: { label: 'Annulé', color: 'bg-red-100 text-red-600', icon: X },
};

interface DraftLine { productId: string; quantityOrdered: string; unitCost: string; }

export default function PurchaseOrdersPage() {
  const { tenant, user, currentStore } = useAuthStore();
  // Même liste que app/api/purchase-orders/create/route.ts (pas isManagerPlus :
  // REGIONAL_MANAGER en est volontairement exclu ici, contrairement au reste
  // de l'app — cohérence UI/API, pas une nouvelle restriction).
  const canManage = ['OWNER', 'ADMIN', 'MANAGER'].includes(user?.role || '');
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [isExporting, setIsExporting] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ productId: '', quantityOrdered: '', unitCost: '' }]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [fromReorderSuggestion, setFromReorderSuggestion] = useState(false);

  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  // Péremption/série (voir migration 041) : capturés uniquement pour les
  // produits concernés, indexés par productId comme receiveQty.
  const [receiveExpiry, setReceiveExpiry] = useState<Record<string, string>>({});
  const [receiveSerials, setReceiveSerials] = useState<Record<string, string>>({});
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);

  // Avant : un seul fetch sans .range() chargeait TOUS les bons de commande
  // (avec leurs lignes jointes) du magasin, plus la table suppliers ET tout
  // le catalogue products (avec coût d'achat) en entier — TROIS fetches non
  // bornés sur un seul écran, le pire cas trouvé lors de l'audit de
  // performance du 2026-09-29. La liste affichée est désormais paginée et
  // filtrée côté serveur (recherche sur la référence + statut, même motif
  // que credits/customers/suppliers) ; suppliers et products restent
  // chargés en entier (nécessaires tels quels pour les menus déroulants du
  // formulaire de création et de réception), mais en colonnes réduites —
  // voir SupplierLite/ProductLite plus haut.
  const PAGE_SIZE = 30;
  const [hasMore, setHasMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const offsetRef = useRef(0);
  const searchSeq = useRef(0);

  function baseOrdersQuery() {
    let q = supabase.from('purchase_orders').select('*, purchase_order_items(*)').eq('tenant_id', tenantId as string).eq('store_id', storeId as string);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus as PurchaseOrderStatus);
    return q;
  }

  // Navigation : première page, en écoute temps réel — hors recherche (la
  // recherche a son propre effet ci-dessous, sans watch()).
  useEffect(() => {
    if (!tenantId || !storeId || search.trim()) return;
    setIsLoading(true);
    // purchase_order_items embarqué via la relation FK. Filtré par store_id
    // (comme la création, storeId: currentStore.id plus bas) : sans ce
    // filtre, un Manager+ multi-magasins voyait les bons de commande de TOUS
    // les magasins en changeant simplement de magasin via le sélecteur —
    // même bug que cash-register/dashboard (store_id absent alors que la
    // table le porte).
    return watch(
      'purchase_orders',
      () => baseOrdersQuery().order('created_at', { ascending: false }).range(0, PAGE_SIZE - 1),
      rows => {
        const mapped = rows.map(r => mapPurchaseOrder(r, (r.purchase_order_items ?? []).map(mapPurchaseOrderItem)));
        setOrders(mapped);
        offsetRef.current = mapped.length;
        setHasMore(mapped.length === PAGE_SIZE);
        setIsLoading(false);
      },
      () => setIsLoading(false),
      `tenant_id=eq.${tenantId}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, storeId, filterStatus, search]);

  const loadMore = useCallback(async () => {
    if (!tenantId || !storeId || search.trim()) return;
    const from = offsetRef.current;
    const { data } = await baseOrdersQuery().order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    const mapped = (data ?? []).map(r => mapPurchaseOrder(r, (r.purchase_order_items ?? []).map(mapPurchaseOrderItem)));
    setOrders(prev => [...prev, ...mapped]);
    offsetRef.current = from + mapped.length;
    setHasMore(mapped.length === PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, storeId, filterStatus, search]);

  // Recherche : exécutée côté serveur, débouncée — un seul champ (référence),
  // pas besoin de fusionner plusieurs requêtes comme sur customers/suppliers.
  useEffect(() => {
    const term = search.trim();
    if (!tenantId || !storeId || !term) return;
    const seq = ++searchSeq.current;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await baseOrdersQuery().ilike('reference', `%${term}%`).order('created_at', { ascending: false }).limit(PAGE_SIZE);
        if (seq !== searchSeq.current) return;
        setOrders((data ?? []).map(r => mapPurchaseOrder(r, (r.purchase_order_items ?? []).map(mapPurchaseOrderItem))));
        setHasMore(false);
        setIsLoading(false);
      } finally {
        if (seq === searchSeq.current) setIsSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, storeId, filterStatus, search]);

  useEffect(() => {
    if (!tenantId) return;
    const unsub2 = watch(
      'suppliers',
      () => supabase.from('suppliers').select('id, name, is_active, payment_terms').eq('tenant_id', tenantId).order('name', { ascending: true }),
      rows => setSuppliers(rows.map(r => ({ id: r.id, name: r.name, isActive: r.is_active, paymentTerms: r.payment_terms }))),
      undefined,
      `tenant_id=eq.${tenantId}`
    );
    const unsub3 = watch(
      'products',
      () => supabase.from('products').select('id, name, sku, track_expiry, track_serial, product_costs(purchase_price)').eq('tenant_id', tenantId).order('name', { ascending: true }),
      rows => setProducts(rows.map(r => {
        const costRel = r.product_costs;
        const one = Array.isArray(costRel) ? costRel[0] : costRel;
        return { id: r.id, name: r.name, sku: r.sku ?? '', trackExpiry: r.track_expiry, trackSerial: r.track_serial, purchasePrice: one?.purchase_price ?? null };
      })),
      undefined,
      `tenant_id=eq.${tenantId}`
    );
    return () => { unsub2(); unsub3(); };
  }, [tenantId]);

  // Statistiques (nombre total de bons de commande) : fetch séparé, non
  // paginé mais réduit à une seule colonne, indépendant de la recherche/du
  // filtre affiché — même motif que customers/suppliers.
  const [statsRows, setStatsRows] = useState<{ id: string }[]>([]);
  useEffect(() => {
    if (!tenantId || !storeId) return;
    return watch(
      'purchase_orders',
      () => supabase.from('purchase_orders').select('id').eq('tenant_id', tenantId).eq('store_id', storeId),
      rows => setStatsRows(rows as typeof statsRows),
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId]);
  const totalCount = statsRows.length;

  // Export CSV : l'utilisateur attend TOUT ce qui correspond au filtre actif,
  // pas seulement la page actuellement chargée — requête dédiée non bornée
  // au clic (même motif que credits/page.tsx), plutôt que d'exporter `orders`
  // (la liste paginée).
  const handleExportCsv = async () => {
    if (!tenantId || !storeId) return;
    setIsExporting(true);
    try {
      const term = search.trim();
      let q = baseOrdersQuery();
      if (term) q = q.ilike('reference', `%${term}%`);
      const { data } = await q.order('created_at', { ascending: false });
      const rows = (data ?? []).map(r => mapPurchaseOrder(r, (r.purchase_order_items ?? []).map(mapPurchaseOrderItem)));
      exportToCsv(`achats-${new Date().toISOString().slice(0, 10)}`, rows, [
        { key: 'reference', label: 'Référence' },
        { key: 'supplierId', label: 'Fournisseur', format: (v) => supplierName(v as string) },
        { key: 'status', label: 'Statut', format: (v) => STATUS_LABELS[v as PurchaseOrder['status']]?.label || String(v) },
        { key: 'subtotal', label: 'Montant' },
        { key: 'createdAt', label: 'Date', format: (v) => formatDateForCsv(v) },
      ]);
    } finally {
      setIsExporting(false);
    }
  };

  // Reprend une suggestion de réappro déposée par la page Alertes stock (voir
  // lib/purchase-orders/reorder-suggestion.ts). On attend que `products` soit
  // chargé pour pouvoir pré-remplir le coût d'achat de chaque ligne comme le
  // fait déjà onPickProduct() à la sélection manuelle. Le ref évite de
  // rouvrir le formulaire à chaque mise à jour live de `products`.
  const suggestionConsumed = useRef(false);
  useEffect(() => {
    if (suggestionConsumed.current || products.length === 0) return;
    const raw = sessionStorage.getItem(PO_REORDER_SUGGESTION_KEY);
    if (!raw) return;
    suggestionConsumed.current = true;
    sessionStorage.removeItem(PO_REORDER_SUGGESTION_KEY);
    try {
      const suggestion = JSON.parse(raw) as ReorderSuggestionLine[];
      const prefilled: DraftLine[] = suggestion
        .map(s => {
          const p = products.find(pp => pp.id === s.productId);
          if (!p) return null; // produit supprimé entre-temps : ligne ignorée
          return { productId: p.id, quantityOrdered: String(s.quantityOrdered), unitCost: String(p.purchasePrice ?? '') };
        })
        .filter((l): l is DraftLine => l !== null);
      if (prefilled.length === 0) return;
      // Consommation unique d'un dépôt sessionStorage (garde `suggestionConsumed`
      // ci-dessus) — pas dérivable pendant le rendu, sessionStorage est une API
      // navigateur.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupplierId(''); setExpectedDate(''); setNotes('');
      setLines(prefilled);
      setCreateError(null);
      setFromReorderSuggestion(true);
      setShowCreate(true);
    } catch {
      // Suggestion illisible (format changé, storage corrompu...) : on ignore
      // silencieusement, l'utilisateur peut toujours créer le bon à la main.
    }
  }, [products]);

  // `orders` est désormais déjà filtré côté serveur (recherche + statut).
  const activeSuppliers = useMemo(() => suppliers.filter(s => s.isActive), [suppliers]);

  // ── Formulaire de création ────────────────────────────────────────────────
  const resetCreateForm = () => {
    setSupplierId(''); setExpectedDate(''); setNotes('');
    setLines([{ productId: '', quantityOrdered: '', unitCost: '' }]);
    setCreateError(null);
    setFromReorderSuggestion(false);
  };
  const openCreate = () => { resetCreateForm(); setShowCreate(true); };

  const updateLine = (i: number, patch: Partial<DraftLine>) =>
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines(prev => [...prev, { productId: '', quantityOrdered: '', unitCost: '' }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));

  // Pré-remplit le coût d'achat avec le dernier connu quand on choisit un produit
  const onPickProduct = (i: number, productId: string) => {
    const p = products.find(pp => pp.id === productId);
    updateLine(i, { productId, unitCost: p ? String(p.purchasePrice) : '' });
  };

  const draftTotal = useMemo(() =>
    lines.reduce((s, l) => s + (Number(l.quantityOrdered) || 0) * (Number(l.unitCost) || 0), 0),
  [lines]);

  const handleCreate = async (status: 'DRAFT' | 'SENT') => {
    if (!tenantId || !currentStore) return;
    if (!supplierId) { setCreateError('Sélectionne un fournisseur'); return; }
    const validLines = lines.filter(l => l.productId && Number(l.quantityOrdered) > 0);
    if (validLines.length === 0) { setCreateError('Ajoute au moins une ligne avec une quantité valide'); return; }

    setIsSaving(true); setCreateError(null);
    try {
      const res = await fetch('/api/purchase-orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, storeId: currentStore.id, supplierId, status,
          expectedDate: expectedDate || null, notes: notes.trim() || null,
          createdByName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
          items: validLines.map(l => ({
            productId: l.productId,
            quantityOrdered: Number(l.quantityOrdered),
            unitCost: Number(l.unitCost) || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la création');
      setShowCreate(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Erreur lors de la création');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Réception ────────────────────────────────────────────────────────────
  const openReceive = (po: PurchaseOrder) => {
    setReceiveTarget(po);
    setReceiveError(null);
    const initial: Record<string, string> = {};
    po.items.forEach(it => { initial[it.productId] = String(Math.max(0, it.quantityOrdered - it.quantityReceived)); });
    setReceiveQty(initial);
    setReceiveExpiry({});
    setReceiveSerials({});
  };

  const handleReceive = async () => {
    if (!tenantId || !receiveTarget) return;
    const lines = Object.entries(receiveQty)
      .map(([productId, v]) => ({ productId, quantityReceivedNow: Number(v) || 0 }))
      .filter(l => l.quantityReceivedNow > 0);
    if (lines.length === 0) { setReceiveError('Indique au moins une quantité à réceptionner'); return; }

    for (const l of lines) {
      const product = products.find(p => p.id === l.productId);
      if (product?.trackExpiry && !receiveExpiry[l.productId]) {
        setReceiveError(`Date de péremption requise pour "${product.name}"`); return;
      }
      if (product?.trackSerial) {
        const serials = (receiveSerials[l.productId] || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (serials.length !== l.quantityReceivedNow) {
          setReceiveError(`"${product.name}" : ${serials.length} numéro(s) de série saisi(s) pour ${l.quantityReceivedNow} reçu(s)`);
          return;
        }
      }
    }

    const linesWithTracking = lines.map(l => ({
      ...l,
      expiryDate: receiveExpiry[l.productId] || undefined,
      serials: receiveSerials[l.productId]
        ? receiveSerials[l.productId].split('\n').map(s => s.trim()).filter(Boolean)
        : undefined,
    }));

    setIsReceiving(true); setReceiveError(null);
    try {
      const res = await fetch('/api/purchase-orders/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, purchaseOrderId: receiveTarget.id, lines: linesWithTracking }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la réception');
      setReceiveTarget(null);
    } catch (e) {
      setReceiveError(e instanceof Error ? e.message : 'Erreur lors de la réception');
    } finally {
      setIsReceiving(false);
    }
  };

  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name || '—';

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bons de commande</h1>
            <p className="text-sm text-gray-500 mt-1">{totalCount} bon{totalCount !== 1 ? 's' : ''} de commande</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={isExporting || totalCount === 0} onClick={handleExportCsv}>
              {isExporting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Exporter CSV
            </Button>
            {canManage && (
              <Button onClick={openCreate} className="bg-primary-600 hover:bg-primary-700">
                <Plus className="h-4 w-4 mr-2" />Nouveau bon de commande
              </Button>
            )}
          </div>
        </div>

        <Card><CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="N° de bon de commande..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X className="h-4 w-4" /></button>}
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent></Card>

        <Card><CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <PackagePlus className="h-12 w-12 mb-4 opacity-30" />
              <p className="font-medium">{isSearching ? 'Recherche en cours…' : 'Aucun bon de commande'}</p>
              {!isSearching && totalCount === 0 && canManage && <Button onClick={openCreate} variant="outline" className="mt-4"><Plus className="h-4 w-4 mr-2" />Créer le premier bon de commande</Button>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Fournisseur</TableHead>
                  <TableHead className="text-center">Statut</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(o => {
                  const st = STATUS_LABELS[o.status];
                  const canReceive = ['SENT', 'PARTIALLY_RECEIVED', 'DRAFT'].includes(o.status);
                  return (
                    <TableRow key={o.id} className="hover:bg-gray-50">
                      <TableCell className="font-medium text-sm">{o.reference}</TableCell>
                      <TableCell className="text-sm text-gray-600">{supplierName(o.supplierId)}</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${st.color}`}>
                          <st.icon className="h-3 w-3" />{st.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">{formatCurrency(o.subtotal)}</TableCell>
                      <TableCell className="text-right">
                        {canReceive && (
                          <Button size="sm" variant="outline" onClick={() => openReceive(o)}>
                            <PackageCheck className="h-4 w-4 mr-1.5" />Réceptionner
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {hasMore && !search && (
            <div className="flex justify-center py-4 border-t">
              <button onClick={loadMore} className="px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 rounded-lg hover:bg-primary-100">
                Afficher plus de bons de commande
              </button>
            </div>
          )}
        </CardContent></Card>
      </div>

      {/* ── Dialogue de création ────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={o => { if (!o) setShowCreate(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nouveau bon de commande</DialogTitle></DialogHeader>
          {fromReorderSuggestion && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
              Lignes pré-remplies depuis les alertes de stock — vérifiez les quantités et choisissez un fournisseur.
            </div>
          )}
          {createError && <div role="alert" className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{createError}</div>}
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fournisseur *</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Choisir un fournisseur" /></SelectTrigger>
                  <SelectContent>
                    {activeSuppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(() => {
                  const terms = activeSuppliers.find(s => s.id === supplierId)?.paymentTerms;
                  return typeof terms === 'number' ? (
                    <p className="text-xs text-gray-400">
                      {terms === 0 ? 'Ce fournisseur est payé comptant.' : `Ce fournisseur accorde un paiement à ${terms} jours.`}
                    </p>
                  ) : null;
                })()}
              </div>
              <div className="space-y-2">
                <Label>Livraison attendue</Label>
                <Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Articles</Label>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  // Sur mobile, le Select produit + les deux champs numériques + le
                  // bouton supprimer sur une seule ligne dépassaient largement la
                  // largeur du dialogue (qui n'a pas de défilement horizontal) —
                  // le contenu débordait hors de l'écran, notamment la corbeille,
                  // rendant une ligne impossible à retirer au doigt. Empilé en
                  // colonne en dessous de sm, chaque élément reste atteignable.
                  <div key={i} className="flex flex-col sm:flex-row gap-2 sm:items-start">
                    <div className="flex-1">
                      <Select value={l.productId} onValueChange={v => onPickProduct(i, v)}>
                        <SelectTrigger><SelectValue placeholder="Produit" /></SelectTrigger>
                        <SelectContent>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="number" min={1} placeholder="Qté" className="w-24"
                        value={l.quantityOrdered} onChange={e => updateLine(i, { quantityOrdered: e.target.value })}
                      />
                      <Input
                        type="number" min={0} placeholder="Coût unit." className="w-32"
                        value={l.unitCost} onChange={e => updateLine(i, { unitCost: e.target.value })}
                      />
                      <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => removeLine(i)} disabled={lines.length === 1}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="h-4 w-4 mr-1.5" />Ajouter une ligne</Button>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Conditions de livraison, remarques..." />
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium text-gray-600">Total estimé</span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(draftTotal)}</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={isSaving}>Annuler</Button>
            <Button variant="outline" onClick={() => handleCreate('DRAFT')} disabled={isSaving}>Enregistrer en brouillon</Button>
            <Button onClick={() => handleCreate('SENT')} disabled={isSaving} className="bg-primary-600 hover:bg-primary-700">
              {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Envoi...</> : 'Envoyer au fournisseur'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialogue de réception ───────────────────────────────────────────── */}
      <Dialog open={!!receiveTarget} onOpenChange={o => { if (!o) setReceiveTarget(null); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Réceptionner {receiveTarget?.reference}</DialogTitle></DialogHeader>
          {receiveError && <div role="alert" className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{receiveError}</div>}
          <p className="text-sm text-gray-500">
            Indique les quantités effectivement reçues. Une réception partielle est possible :
            le reste restera &quot;à recevoir&quot; et tu pourras réceptionner le solde plus tard.
          </p>
          <div className="space-y-3 py-2">
            {receiveTarget?.items.map(it => {
              const remaining = it.quantityOrdered - it.quantityReceived;
              const product = products.find(p => p.id === it.productId);
              return (
                <div key={it.productId} className="border-b pb-3 last:border-0 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{it.productName}</p>
                      <p className="text-xs text-gray-500">
                        {it.quantityReceived}/{it.quantityOrdered} déjà reçu · reste {remaining}
                      </p>
                    </div>
                    <Input
                      type="number" min={0} max={remaining} className="w-24"
                      value={receiveQty[it.productId] ?? ''}
                      onChange={e => setReceiveQty(prev => ({ ...prev, [it.productId]: e.target.value }))}
                    />
                  </div>
                  {/* Péremption/série (voir migration 041) — uniquement pour
                      les produits qui ont ce suivi activé. */}
                  {product?.trackExpiry && (
                    <div className="pl-1">
                      <Label className="text-xs">Date de péremption de ce lot *</Label>
                      <Input
                        type="date" className="mt-1"
                        value={receiveExpiry[it.productId] ?? ''}
                        onChange={e => setReceiveExpiry(prev => ({ ...prev, [it.productId]: e.target.value }))}
                      />
                    </div>
                  )}
                  {product?.trackSerial && (
                    <div className="pl-1">
                      <Label className="text-xs">Numéros de série / IMEI (un par ligne) *</Label>
                      <Textarea
                        className="mt-1" rows={3}
                        value={receiveSerials[it.productId] ?? ''}
                        onChange={e => setReceiveSerials(prev => ({ ...prev, [it.productId]: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveTarget(null)} disabled={isReceiving}>Annuler</Button>
            <Button onClick={handleReceive} disabled={isReceiving} className="bg-primary-600 hover:bg-primary-700">
              {isReceiving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Réception...</> : 'Confirmer la réception'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
