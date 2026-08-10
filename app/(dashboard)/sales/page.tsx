'use client';

import { useState, useEffect } from 'react';
import {
  Search, Eye, X, ShoppingBag, RefreshCw,
  XCircle, CheckCircle2, ChevronRight, Banknote,
  Smartphone, CreditCard, Users, Calendar, PackageCheck
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { formatCurrency, formatDateTime, toFirestoreDate } from '@/lib/utils/helpers';
import { exportToCsv, formatDateForCsv } from '@/lib/utils/export';
import { Download } from 'lucide-react';
import { useAuthStore } from '@/hooks/store';
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
// onSnapshot vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/firebase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { onSnapshot } from '@/lib/firebase/watch';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { describeFirestoreError, type ReadableError } from '@/lib/utils/firestore-errors';

interface SaleItem {
  productId: string; productName: string; productSku: string;
  quantity: number; unitPrice: number; total: number; costPrice?: number;
  returnedQuantity?: number;
}
interface Sale {
  id: string; total: number; status: string; paymentMethod?: string;
  customerName?: string; customerId?: string; createdAt: unknown;
  discountPercent?: number; discountAmount?: number; tax?: number;
  itemCount?: number; motifAnnulation?: string;
}

const PM_LABELS: Record<string, { label: string; icon: typeof Banknote }> = {
  CASH:         { label: 'Espèces',      icon: Banknote },
  MOBILE_MONEY: { label: 'Mobile Money', icon: Smartphone },
  CARD:         { label: 'Carte',        icon: CreditCard },
  CREDIT:       { label: 'Crédit',       icon: Users },
};

export default function SalesPage() {
  const { tenant, user, currentStore } = useAuthStore();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;

  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<ReadableError | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const [selected, setSelected] = useState<Sale | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [cancelMotif, setCancelMotif] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  const [showReturn, setShowReturn] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [returnRestock, setReturnRestock] = useState<Record<string, boolean>>({});
  const [returnReason, setReturnReason] = useState('');
  // « Avoir en magasin » retiré : aucune fonction ne créait d'avoir, le
  // client repartait avec une promesse sans trace. Voir la route
  // app/api/sales/returns/create.
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'ORIGINAL_PAYMENT_METHOD'>('CASH');
  const [isReturning, setIsReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !storeId) return;
      // Filtre magasin OBLIGATOIRE : la règle Firestore contrôle le magasin de
      // chaque vente. Une requête qui ne le prouve pas est rejetée EN BLOC
      // pour un utilisateur affecté à un magasin — la page reste alors vide
      // avec « permission-denied » en console, alors que les ventes existent.
    const q = query(
      collection(db, tenantCol(tenantId, 'sales')),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'), limit(300)
    );
    return onSnapshot(
      q,
      snap => {
        setSales(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Sale[]);
        setLoadError(null);
        setIsLoading(false);
      },
      err => {
        // Sans ce gestionnaire, un refus d'accès ou un index manquant
        // laissait la page afficher « 0 vente » — indiscernable d'une
        // boutique qui n'a réellement rien vendu.
        console.error('Sales listener error:', err);
        setLoadError(describeFirestoreError(err));
        setIsLoading(false);
      }
    );
  }, [tenantId, storeId]);

  // Charger les articles de la vente sélectionnée
  useEffect(() => {
    if (!tenantId || !selected) { setSaleItems([]); return; }
    setLoadingItems(true);
    getDocs(collection(db, `tenants/${tenantId}/sales/${selected.id}/sale_items`))
      .then(snap => setSaleItems(snap.docs.map(d => ({ id: d.id, ...d.data() })) as unknown as SaleItem[]))
      .finally(() => setLoadingItems(false));
  }, [tenantId, selected?.id]);

  const filtered = sales.filter(s => {
    const matchSearch = !search || s.id.toLowerCase().includes(search.toLowerCase()) || (s.customerName || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || s.status === filterStatus;

    // Comparaison robuste par objets Date plutôt que par strings
    let matchFrom = true;
    let matchTo = true;
    if (filterDateFrom || filterDateTo) {
      const saleDate = toFirestoreDate(s.createdAt);
      if (filterDateFrom) {
        const fromDate = new Date(filterDateFrom);
        fromDate.setHours(0, 0, 0, 0);
        matchFrom = saleDate >= fromDate;
      }
      if (filterDateTo) {
        const toDate = new Date(filterDateTo);
        toDate.setHours(23, 59, 59, 999);
        matchTo = saleDate <= toDate;
      }
    }
    return matchSearch && matchStatus && matchFrom && matchTo;
  });

  const totalRevenue = filtered.filter(s => s.status === 'COMPLETED').reduce((sum, s) => sum + (s.total || 0), 0);
  const nbCompleted = filtered.filter(s => s.status === 'COMPLETED').length;
  const nbCancelled = filtered.filter(s => s.status === 'CANCELLED').length;

  // Annulation via la route serveur dédiée : le serveur revérifie le statut
  // et restaure lui-même le stock (transaction, filtré par magasin), au lieu
  // de faire confiance à des écritures Firestore calculées côté client.
  const handleCancel = async () => {
    if (!tenantId || !cancelTarget || !cancelMotif.trim()) return;
    setIsCancelling(true);
    try {
      const res = await fetch('/api/sales/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, saleId: cancelTarget.id, motif: cancelMotif.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de l\'annulation');

      setCancelTarget(null); setCancelMotif('');
      if (selected?.id === cancelTarget.id) {
        setSelected(prev => prev ? { ...prev, status: 'CANCELLED', motifAnnulation: cancelMotif.trim() } : null);
      }
    } catch (e) { console.error('Cancel error:', e); }
    finally { setIsCancelling(false); }
  };

  // Ouvre le dialogue de retour, pré-rempli avec le reste retournable de chaque article
  const openReturn = () => {
    const qty: Record<string, string> = {};
    const restock: Record<string, boolean> = {};
    saleItems.forEach(it => {
      qty[it.productId] = '0';
      restock[it.productId] = true;
    });
    setReturnQty(qty); setReturnRestock(restock);
    setReturnReason(''); setRefundMethod('CASH'); setReturnError(null);
    setShowReturn(true);
  };

  // Retour client via la route serveur dédiée : montant recalculé côté
  // serveur à partir des vrais prix de la vente, jamais depuis le client.
  const handleReturn = async () => {
    if (!tenantId || !selected) return;
    const items = Object.entries(returnQty)
      .map(([productId, v]) => ({ productId, quantity: Number(v) || 0, restock: !!returnRestock[productId] }))
      .filter(l => l.quantity > 0);
    if (items.length === 0) { setReturnError('Indique au moins une quantité à retourner'); return; }
    if (!returnReason.trim()) { setReturnError('Le motif du retour est obligatoire'); return; }

    setIsReturning(true); setReturnError(null);
    try {
      const res = await fetch('/api/sales/returns/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, saleId: selected.id, items,
          reason: returnReason.trim(), refundMethod,
          processedByName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors du retour');
      setShowReturn(false);
    } catch (e) {
      setReturnError(e instanceof Error ? e.message : 'Erreur lors du retour');
    } finally {
      setIsReturning(false);
    }
  };

  const StatusBadge = ({ status }: { status: string }) => (
    status === 'COMPLETED'
      ? <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium"><CheckCircle2 className="h-3 w-3" />Complétée</span>
      : <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium"><XCircle className="h-3 w-3" />Annulée</span>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Historique des ventes</h1>
            <p className="text-sm text-gray-500 mt-1">
              {nbCompleted} complétée{nbCompleted !== 1 ? 's' : ''} · {formatCurrency(totalRevenue)}
              {nbCancelled > 0 && <span className="ml-2 text-red-500">· {nbCancelled} annulée{nbCancelled !== 1 ? 's' : ''}</span>}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={filtered.length === 0}
            onClick={() => exportToCsv(`ventes-${new Date().toISOString().slice(0, 10)}`, filtered, [
              { key: 'id', label: 'N° vente' },
              { key: 'createdAt', label: 'Date', format: (v) => formatDateForCsv(v) },
              { key: 'customerName', label: 'Client' },
              { key: 'paymentMethod', label: 'Paiement' },
              { key: 'status', label: 'Statut' },
              { key: 'itemCount', label: 'Articles' },
              { key: 'total', label: 'Total' },
            ])}
          >
            <Download className="h-4 w-4 mr-2" />
            Exporter CSV
          </Button>
        </div>

        {/* Une page vide et une page en erreur ne veulent PAS dire la même
            chose : l'une signifie « aucune vente », l'autre « je n'ai pas pu
            regarder ». Les confondre fait chercher un problème de données là
            où il n'y en a pas. */}
        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-800">{loadError.message}</p>
            {loadError.hint && (
              <p className="mt-1 text-xs text-red-600 break-all">{loadError.hint}</p>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Chiffre d\'affaires', value: formatCurrency(totalRevenue), color: 'text-primary-600' },
            { label: 'Ventes complétées', value: nbCompleted, color: 'text-green-600' },
            { label: 'Ventes annulées', value: nbCancelled, color: 'text-red-600' },
          ].map((s, i) => (
            <Card key={i}><CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-1">{s.label}</p>
            </CardContent></Card>
          ))}
        </div>

        {/* Filtres */}
        <Card><CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="N° vente ou client..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X className="h-4 w-4" /></button>}
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="COMPLETED">Complétées</SelectItem>
                <SelectItem value="CANCELLED">Annulées</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="w-40" placeholder="Du" />
            <Input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="w-40" placeholder="Au" />
            {(filterDateFrom || filterDateTo || filterStatus !== 'all') && (
              <Button variant="outline" size="sm" onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterStatus('all'); }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent></Card>

        {/* Layout */}
        <div className={`gap-6 ${selected ? 'grid grid-cols-1 lg:grid-cols-2' : ''}`}>
          <Card><CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <ShoppingBag className="h-12 w-12 mb-4 opacity-30" />
                <p className="font-medium">Aucune vente trouvée</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N° Vente</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Paiement</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(s => {
                    const pm = PM_LABELS[s.paymentMethod || 'CASH'];
                    const Icon = pm?.icon || Banknote;
                    return (
                      <TableRow key={s.id}
                        className={`hover:bg-gray-50 cursor-pointer ${selected?.id === s.id ? 'bg-primary-50' : ''}`}
                        onClick={() => setSelected(s)}>
                        <TableCell><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.id.slice(0,8).toUpperCase()}</code></TableCell>
                        <TableCell className="text-sm text-gray-500 whitespace-nowrap">{formatDateTime(s.createdAt)}</TableCell>
                        <TableCell className="text-sm">{s.customerName || 'Client comptoir'}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(s.total || 0)}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1 text-xs text-gray-600">
                            <Icon className="h-3 w-3" />{pm?.label || s.paymentMethod}
                          </span>
                        </TableCell>
                        <TableCell><StatusBadge status={s.status} /></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); setSelected(s); }}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {s.status === 'COMPLETED' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600"
                                onClick={e => { e.stopPropagation(); setCancelTarget(s); setCancelMotif(''); }}>
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>

          {/* Panneau détail */}
          {selected && (
            <Card><CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900">Détail de la vente</h3>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
              </div>

              <div className="space-y-3 mb-5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">N° Vente</span><code className="text-xs bg-gray-100 px-2 py-1 rounded">{selected.id.slice(0,8).toUpperCase()}</code></div>
                <div className="flex justify-between"><span className="text-gray-500">Date</span><span>{formatDateTime(selected.createdAt)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-medium">{selected.customerName || 'Client comptoir'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Paiement</span><span>{PM_LABELS[selected.paymentMethod || 'CASH']?.label || selected.paymentMethod}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Statut</span><StatusBadge status={selected.status} /></div>
                {selected.status === 'CANCELLED' && selected.motifAnnulation && (
                  <div className="bg-red-50 rounded-lg p-3">
                    <p className="text-xs text-red-600 font-medium">Motif d&apos;annulation</p>
                    <p className="text-xs text-red-700 mt-1">{selected.motifAnnulation}</p>
                  </div>
                )}
              </div>

              {/* Articles */}
              <p className="text-sm font-medium text-gray-900 mb-3">Articles vendus</p>
              {loadingItems ? (
                <div className="flex items-center justify-center py-4 text-gray-400"><RefreshCw className="h-4 w-4 animate-spin mr-2" />Chargement...</div>
              ) : saleItems.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Aucun article enregistré</p>
              ) : (
                <div className="space-y-2 mb-4">
                  {saleItems.map((item, i) => (
                    <div key={i} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{item.productName}</p>
                        <p className="text-xs text-gray-400">{item.productSku} · {item.quantity} × {formatCurrency(item.unitPrice)}</p>
                      </div>
                      <p className="text-sm font-bold text-primary-600">{formatCurrency(item.total)}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Totaux */}
              <div className="border-t pt-3 space-y-1 text-sm">
                {(selected.discountAmount || 0) > 0 && (
                  <div className="flex justify-between text-green-600"><span>Remise ({selected.discountPercent}%)</span><span>-{formatCurrency(selected.discountAmount || 0)}</span></div>
                )}
                {(selected.tax || 0) > 0 && (
                  <div className="flex justify-between text-gray-500"><span>TVA</span><span>{formatCurrency(selected.tax || 0)}</span></div>
                )}
                <div className="flex justify-between font-bold text-base pt-1 border-t">
                  <span>TOTAL</span>
                  <span className="text-primary-600">{formatCurrency(selected.total || 0)}</span>
                </div>
              </div>

              {(selected.status === 'COMPLETED' || selected.status === 'PARTIALLY_REFUNDED') && (
                <Button onClick={openReturn}
                  variant="outline" className="w-full mt-4 text-amber-700 border-amber-200 hover:bg-amber-50">
                  <PackageCheck className="h-4 w-4 mr-2" />Retourner des articles
                </Button>
              )}
              {selected.status === 'COMPLETED' && (
                <Button onClick={() => { setCancelTarget(selected); setCancelMotif(''); }}
                  variant="outline" className="w-full mt-2 text-red-600 border-red-200 hover:bg-red-50">
                  <XCircle className="h-4 w-4 mr-2" />Annuler cette vente
                </Button>
              )}
            </CardContent></Card>
          )}
        </div>
      </div>

      {/* Dialog annulation */}
      <AlertDialog open={!!cancelTarget} onOpenChange={o => { if (!o) { setCancelTarget(null); setCancelMotif(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler cette vente ?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>Vente <strong>#{cancelTarget?.id.slice(0,8).toUpperCase()}</strong> — <strong>{formatCurrency(cancelTarget?.total || 0)}</strong></p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  ⚠️ Le stock sera automatiquement restauré pour tous les articles de cette vente.
                </div>
                <div className="space-y-1">
                  <Label className="text-sm">Motif d&apos;annulation *</Label>
                  <Textarea
                    placeholder="Ex: Erreur de saisie, client a changé d'avis..."
                    value={cancelMotif}
                    onChange={e => setCancelMotif(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Retour</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={!cancelMotif.trim() || isCancelling}
              className="bg-red-600 hover:bg-red-700"
            >
              {isCancelling ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Annulation...</> : 'Confirmer l\'annulation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog retour client */}
      <Dialog open={showReturn} onOpenChange={o => { if (!o) setShowReturn(false); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Retourner des articles</DialogTitle></DialogHeader>
          {returnError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{returnError}</div>}
          <div className="space-y-3 py-2">
            {saleItems.map(item => {
              const remaining = item.quantity - (item.returnedQuantity || 0);
              if (remaining <= 0) return null;
              return (
                <div key={item.productId} className="flex items-center justify-between gap-3 border-b pb-3 last:border-0">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.productName}</p>
                    <p className="text-xs text-gray-400">
                      {item.productSku} · {remaining} restituable{remaining !== 1 ? 's' : ''} sur {item.quantity}
                    </p>
                    <label className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={!!returnRestock[item.productId]}
                        onChange={e => setReturnRestock(prev => ({ ...prev, [item.productId]: e.target.checked }))}
                      />
                      Remettre en stock (décocher si article défectueux)
                    </label>
                  </div>
                  <Input
                    type="number" min={0} max={remaining} className="w-20"
                    value={returnQty[item.productId] ?? '0'}
                    onChange={e => setReturnQty(prev => ({ ...prev, [item.productId]: e.target.value }))}
                  />
                </div>
              );
            })}
            {saleItems.every(it => (it.quantity - (it.returnedQuantity || 0)) <= 0) && (
              <p className="text-sm text-gray-400 text-center py-2">Tous les articles de cette vente ont déjà été retournés.</p>
            )}

            <div className="space-y-2">
              <Label>Mode de remboursement</Label>
              <Select value={refundMethod} onValueChange={v => setRefundMethod(v as typeof refundMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Espèces</SelectItem>
                  <SelectItem value="ORIGINAL_PAYMENT_METHOD">Mode de paiement d&apos;origine</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Motif du retour *</Label>
              <Textarea
                placeholder="Ex : article défectueux, erreur de commande client..."
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReturn(false)} disabled={isReturning}>Annuler</Button>
            <Button onClick={handleReturn} disabled={isReturning} className="bg-amber-600 hover:bg-amber-700">
              {isReturning ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Traitement...</> : 'Confirmer le retour'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
