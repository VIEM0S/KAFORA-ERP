'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Search, X, RefreshCw, FileText, ChevronRight,
  CheckCircle2, XCircle, ShoppingCart, Clock, AlertCircle, Minus
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils/helpers';
import { useAuthStore, useCartStore } from '@/hooks/store';
import { collection, query, orderBy, where, doc, addDoc, updateDoc, serverTimestamp, getDocs } from 'firebase/firestore';
// onSnapshot vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/firebase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { onSnapshot } from '@/lib/firebase/watch';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { useRouter } from 'next/navigation';
import type { Product, Customer } from '@/lib/types';

interface QuoteItem { product: Product; quantity: number; unitPrice: number; }
/** Structure réelle d'un article de devis stocké dans Firestore */
interface QuoteItemStored { productId: string; productName: string; productSku: string; quantity: number; unitPrice: number; total: number; }
interface Quote {
  id: string; tenantId: string; customerId: string; customerName: string;
  status: 'PENDING' | 'ACCEPTED' | 'CONVERTED' | 'REFUSED' | 'EXPIRED';
  dateValidite: string; total: number; note?: string;
  items?: QuoteItemStored[]; userId: string; createdAt: unknown; updatedAt: unknown;
}

const STATUS_CONFIG = {
  PENDING:   { label: 'En attente', color: 'bg-amber-100 text-amber-700',  icon: Clock },
  ACCEPTED:  { label: 'Accepté',    color: 'bg-blue-100 text-blue-700',    icon: CheckCircle2 },
  CONVERTED: { label: 'Converti',   color: 'bg-green-100 text-green-700',  icon: ShoppingCart },
  REFUSED:   { label: 'Refusé',     color: 'bg-red-100 text-red-700',      icon: XCircle },
  EXPIRED:   { label: 'Expiré',     color: 'bg-gray-100 text-gray-500',    icon: AlertCircle },
};

export default function QuotesPage() {
  const { tenant, user, currentStore } = useAuthStore();
  const { addItem, updateItemPrice, setCustomer, clearCart, setNotes, setSourceQuoteId } = useCartStore();
  const tenantId = tenant?.id;
  const router = useRouter();

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selected, setSelected] = useState<Quote | null>(null);
  const [showNewQuote, setShowNewQuote] = useState(false);

  // Formulaire nouveau devis
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [lignes, setLignes] = useState<QuoteItem[]>([]);
  const [dateValidite, setDateValidite] = useState('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [convertTarget, setConvertTarget] = useState<Quote | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    const unsubQ = onSnapshot(query(collection(db, tenantCol(tenantId, 'quotes')), orderBy('createdAt', 'desc')), snap => {
      setQuotes(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Quote[]);
      setIsLoading(false);
    });
    const unsubP = onSnapshot(query(collection(db, tenantCol(tenantId, 'products')), where('isActive', '==', true), orderBy('name')), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]);
    });
    const unsubC = onSnapshot(query(collection(db, tenantCol(tenantId, 'customers')), where('isActive', '==', true), orderBy('createdAt', 'desc')), snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Customer[]);
    });
    return () => { unsubQ(); unsubP(); unsubC(); };
  }, [tenantId]);

  const filtered = quotes.filter(q =>
    filterStatus === 'all' || q.status === filterStatus
  );

  const filteredCustomers = customers.filter(c => {
    const name = `${c.firstName || ''} ${c.lastName || ''} ${c.companyName || ''}`.toLowerCase();
    return !customerSearch || name.includes(customerSearch.toLowerCase()) || (c.phone || '').includes(customerSearch);
  });

  const filteredProducts = products.filter(p =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase())
  );

  const total = lignes.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  const addLine = (p: Product) => {
    if (lignes.find(l => l.product.id === p.id)) return;
    setLignes(prev => [...prev, { product: p, quantity: 1, unitPrice: p.sellingPrice }]);
    setProductSearch('');
  };

  const handleSaveQuote = async () => {
    if (!tenantId || !user) return;
    if (!selectedCustomer) { setFormError('Client obligatoire'); return; }
    if (!lignes.length) { setFormError('Ajoutez au moins un article'); return; }
    if (!dateValidite) { setFormError('Date de validité obligatoire'); return; }
    setIsSaving(true); setFormError(null);
    try {
      const items = lignes.map(l => ({
        productId: l.product.id, productName: l.product.name, productSku: l.product.sku,
        quantity: l.quantity, unitPrice: l.unitPrice, total: l.quantity * l.unitPrice,
      }));
      const customerName = selectedCustomer.customerType === 'BUSINESS'
        ? selectedCustomer.companyName
        : `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim();

      await addDoc(collection(db, tenantCol(tenantId, 'quotes')), {
        tenantId, customerId: selectedCustomer.id, customerName,
        status: 'PENDING', dateValidite, total, note: note || null,
        items, userId: user.id,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      setShowNewQuote(false); setLignes([]); setSelectedCustomer(null);
      setDateValidite(''); setNote(''); setCustomerSearch('');
    } catch (e) { setFormError('Erreur lors de la création'); console.error(e); }
    finally { setIsSaving(false); }
  };

  const handleStatus = async (quoteId: string, status: Quote['status']) => {
    if (!tenantId) return;
    await updateDoc(doc(db, tenantCol(tenantId, 'quotes'), quoteId), {
      status, updatedAt: serverTimestamp(),
    });
    if (selected?.id === quoteId) setSelected(prev => prev ? { ...prev, status } : null);
  };

  const handleConvert = async () => {
    if (!tenantId || !convertTarget || !convertTarget.items) return;

    clearCart();
    const introuvables: string[] = [];

    for (const item of convertTarget.items) {
      const pSnap = await getDocs(query(collection(db, tenantCol(tenantId, 'products')), where('__name__', '==', item.productId)));
      if (pSnap.empty) {
        // Produit supprimé depuis l'établissement du devis : on le signale
        // plutôt que de le faire disparaître silencieusement du panier.
        introuvables.push(item.productName || item.productId);
        continue;
      }
      const p = { id: pSnap.docs[0].id, ...pSnap.docs[0].data() } as Product;
      addItem(p, item.quantity);

      // PRIX DU DEVIS, pas le prix courant.
      //
      // `addItem` reprend le prix de vente actuel du produit. Si le tarif a
      // changé depuis l'établissement du devis, le client se voyait facturer
      // un montant différent de celui qu'on lui avait remis par écrit — un
      // devis n'est pas une estimation, c'est un engagement.
      if (typeof item.unitPrice === 'number' && item.unitPrice !== p.sellingPrice) {
        updateItemPrice(p.id, item.unitPrice);
      }
    }

    const cSnap = await getDocs(query(collection(db, tenantCol(tenantId, 'customers')), where('__name__', '==', convertTarget.customerId)));
    if (!cSnap.empty) {
      setCustomer({ id: cSnap.docs[0].id, ...cSnap.docs[0].data() } as Customer);
    }

    // Traçabilité : la vente doit pouvoir être rattachée à son devis.
    const ref = `Devis ${convertTarget.id.slice(0, 8).toUpperCase()}`;
    setNotes(convertTarget.note ? `${ref} — ${convertTarget.note}` : ref);
    // Lu par le checkout pour faire passer CE devis en "Converti" une fois la
    // vente réellement encaissée (voir commentaire plus bas et hooks/store.ts).
    setSourceQuoteId(convertTarget.id);

    if (introuvables.length > 0) {
      alert(
        `Ces articles du devis n'existent plus et n'ont pas été ajoutés :\n` +
        `${introuvables.join(', ')}\n\nVérifiez le panier avant d'encaisser.`
      );
    }

    // Le devis N'EST PAS marqué « converti » ici.
    //
    // Il l'était avant même que la vente existe : si le caissier abandonnait
    // le panier, le devis restait marqué converti sans qu'aucune vente n'ait
    // eu lieu — et il devenait impossible de le reconvertir. Le statut passe
    // désormais à CONVERTED côté serveur (/api/pos/checkout), uniquement une
    // fois la vente réellement encaissée — voir sourceQuoteId (hooks/store.ts).
    setConvertTarget(null);
    router.push('/pos');
  };

  const StatusBadge = ({ status }: { status: Quote['status'] }) => {
    const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
    const Icon = cfg.icon;
    return <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${cfg.color}`}><Icon className="h-3 w-3" />{cfg.label}</span>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Devis</h1>
            <p className="text-sm text-gray-500 mt-1">{quotes.length} devis au total</p>
          </div>
          <Button onClick={() => setShowNewQuote(true)} className="bg-primary-600 hover:bg-primary-700">
            <Plus className="h-4 w-4 mr-2" />Nouveau devis
          </Button>
        </div>

        {/* Filtres statut */}
        <div className="flex gap-2 flex-wrap">
          {[{ val: 'all', label: 'Tous' }, ...Object.entries(STATUS_CONFIG).map(([val, cfg]) => ({ val, label: cfg.label }))].map(opt => (
            <Button key={opt.val} variant={filterStatus === opt.val ? 'default' : 'outline'} size="sm"
              onClick={() => setFilterStatus(opt.val)}
              className={filterStatus === opt.val ? 'bg-primary-600 hover:bg-primary-700' : ''}>
              {opt.label}
            </Button>
          ))}
        </div>

        {/* Layout */}
        <div className={`gap-6 ${selected ? 'grid grid-cols-1 lg:grid-cols-2' : ''}`}>
          <Card><CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <FileText className="h-12 w-12 mb-4 opacity-30" />
                <p className="font-medium">Aucun devis</p>
                <Button onClick={() => setShowNewQuote(true)} variant="outline" className="mt-4"><Plus className="h-4 w-4 mr-2" />Créer un devis</Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead><TableHead>Client</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Validité</TableHead><TableHead>Statut</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(q => (
                    <TableRow key={q.id} className={`hover:bg-gray-50 cursor-pointer ${selected?.id === q.id ? 'bg-primary-50' : ''}`}
                      onClick={() => setSelected(q)}>
                      <TableCell className="text-sm text-gray-500">{formatDate(q.createdAt)}</TableCell>
                      <TableCell className="font-medium text-sm">{q.customerName}</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(q.total)}</TableCell>
                      <TableCell className="text-sm text-gray-500">{formatDate(q.dateValidite)}</TableCell>
                      <TableCell><StatusBadge status={q.status} /></TableCell>
                      <TableCell><ChevronRight className="h-4 w-4 text-gray-400" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>

          {/* Panneau détail */}
          {selected && (
            <Card><CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900">Détail du devis</h3>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-3 mb-4 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-medium">{selected.customerName}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Statut</span><StatusBadge status={selected.status} /></div>
                <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-bold text-lg text-primary-600">{formatCurrency(selected.total)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Validité</span><span>{formatDate(selected.dateValidite)}</span></div>
                {selected.note && <div><span className="text-gray-500">Note</span><p className="mt-1 text-gray-700">{selected.note}</p></div>}
              </div>

              {/* Articles */}
              {selected.items && selected.items.length > 0 && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-900 mb-2">Articles</p>
                  <div className="space-y-2">
                    {selected.items.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                        <div><p className="font-medium">{item.productName}</p>
                        <p className="text-xs text-gray-400">{item.quantity} × {formatCurrency(item.unitPrice)}</p></div>
                        <p className="font-bold">{formatCurrency(item.quantity * item.unitPrice)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              {selected.status === 'PENDING' && (
                <div className="flex flex-col gap-2">
                  <Button onClick={() => setConvertTarget(selected)} className="bg-green-600 hover:bg-green-700">
                    <ShoppingCart className="h-4 w-4 mr-2" />Convertir en vente (POS)
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => handleStatus(selected.id, 'ACCEPTED')}>
                      <CheckCircle2 className="h-4 w-4 mr-2" />Accepter
                    </Button>
                    <Button variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleStatus(selected.id, 'REFUSED')}>
                      <XCircle className="h-4 w-4 mr-2" />Refuser
                    </Button>
                  </div>
                </div>
              )}
              {selected.status === 'ACCEPTED' && (
                <Button onClick={() => setConvertTarget(selected)} className="w-full bg-green-600 hover:bg-green-700">
                  <ShoppingCart className="h-4 w-4 mr-2" />Convertir en vente (POS)
                </Button>
              )}
            </CardContent></Card>
          )}
        </div>
      </div>

      {/* Dialog nouveau devis */}
      <Dialog open={showNewQuote} onOpenChange={o => { if (!o) setShowNewQuote(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nouveau devis</DialogTitle></DialogHeader>
          {formError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{formError}</div>}

          <div className="space-y-4 py-2">
            {/* Client */}
            <div className="space-y-2">
              <Label>Client *</Label>
              <div className="relative">
                <Input placeholder="Rechercher un client..." value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)} />
                {selectedCustomer && (
                  <div className="flex items-center justify-between bg-primary-50 border border-primary-200 rounded-lg px-3 py-2 mt-2">
                    <span className="text-sm font-medium text-primary-700">
                      {selectedCustomer.customerType === 'BUSINESS' ? selectedCustomer.companyName : `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim()}
                    </span>
                    <button onClick={() => setSelectedCustomer(null)} className="text-primary-400"><X className="h-4 w-4" /></button>
                  </div>
                )}
                {customerSearch && !selectedCustomer && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto mt-1">
                    {filteredCustomers.map(c => (
                      <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b"
                        onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); }}>
                        <p className="font-medium">{c.customerType === 'BUSINESS' ? c.companyName : `${c.firstName || ''} ${c.lastName || ''}`.trim()}</p>
                        <p className="text-xs text-gray-400">{c.phone || c.email || ''}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Produits */}
            <div className="space-y-2">
              <Label>Articles *</Label>
              <div className="relative">
                <Input placeholder="Rechercher et ajouter un article..." value={productSearch}
                  onChange={e => setProductSearch(e.target.value)} />
                {productSearch && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto mt-1">
                    {filteredProducts.filter(p => !lignes.find(l => l.product.id === p.id)).slice(0, 10).map(p => (
                      <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b"
                        onClick={() => addLine(p)}>
                        <div className="flex justify-between">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-primary-600 font-bold">{formatCurrency(p.sellingPrice)}</span>
                        </div>
                        <p className="text-xs text-gray-400">{p.sku}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {lignes.length > 0 && (
                <div className="space-y-2 mt-2">
                  {lignes.map((l, i) => (
                    <div key={l.product.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{l.product.name}</p>
                        <p className="text-xs text-gray-400">{l.product.sku}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setLignes(p => p.map((x, j) => j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}
                          className="h-6 w-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center">
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-8 text-center text-sm font-bold">{l.quantity}</span>
                        <button onClick={() => setLignes(p => p.map((x, j) => j === i ? { ...x, quantity: x.quantity + 1 } : x))}
                          className="h-6 w-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center">
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="text-sm font-bold w-24 text-right text-primary-600">{formatCurrency(l.unitPrice * l.quantity)}</p>
                      <button onClick={() => setLignes(p => p.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-2 border-t font-bold">
                    <span>TOTAL</span><span className="text-primary-600 text-lg">{formatCurrency(total)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Date de validité *</Label>
              <Input type="date" min={new Date().toISOString().split('T')[0]} value={dateValidite} onChange={e => setDateValidite(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Note (optionnelle)</Label>
              <Textarea placeholder="Conditions particulières, remarques..." value={note} onChange={e => setNote(e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewQuote(false)}>Annuler</Button>
            <Button onClick={handleSaveQuote} disabled={isSaving} className="bg-primary-600 hover:bg-primary-700">
              {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Création...</> : `Créer le devis — ${formatCurrency(total)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog conversion */}
      <AlertDialog open={!!convertTarget} onOpenChange={o => { if (!o) setConvertTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convertir en vente ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le devis de <strong>{convertTarget?.customerName}</strong> ({formatCurrency(convertTarget?.total || 0)}) sera chargé dans le POS. Vous pourrez finaliser le paiement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} className="bg-green-600 hover:bg-green-700">
              <ShoppingCart className="h-4 w-4 mr-2" />Ouvrir dans le POS
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
