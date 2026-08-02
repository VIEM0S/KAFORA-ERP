'use client';

import { useState, useEffect, useMemo } from 'react';
import { ArrowRightLeft, Plus, Check, X, Truck, PackageCheck, Loader2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuthStore } from '@/hooks/store';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { ProductPicker } from '@/components/transfers/product-picker';
import { TRANSFER_STATUS_LABELS } from '@/lib/transfers/rules';
import type { TransferStatus } from '@/lib/types';

interface TransferRow {
  id: string;
  reference: string;
  fromStoreId: string;
  toStoreId: string;
  status: TransferStatus;
  lines: { productId: string; productName: string; quantity: number }[];
  note: string | null;
  createdAt: { seconds: number } | null;
}

const STATUS_STYLE: Record<TransferStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  SHIPPED: 'bg-purple-100 text-purple-800',
  RECEIVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

export default function TransfersPage() {
  const { tenant, stores: myStores } = useAuthStore();
  const tenantId = tenant?.id;

  // TOUS les magasins du tenant, pas seulement ceux de l'utilisateur.
  //
  // `myStores` ne contient que les magasins auxquels il est affecté. Un
  // responsable de boutique n'en voit donc qu'un — et se retrouvait dans
  // l'impossibilité de demander un transfert, alors que c'est justement lui
  // qui a besoin d'être réapprovisionné.
  //
  // Le cloisonnement reste entier : seul le NOM des magasins est lisible
  // (leur stock et leurs ventes restent inaccessibles), et le serveur vérifie
  // que l'utilisateur est bien concerné par le transfert qu'il demande.
  const [allStores, setAllStores] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    const unsub = onSnapshot(
      collection(db, tenantCol(tenantId, 'stores')),
      snap => setAllStores(snap.docs.map(d => ({ id: d.id, name: (d.data().name as string) || '—' })))
    );
    return () => unsub();
  }, [tenantId]);

  const stores = allStores.length > 0 ? allStores : myStores;
  const myStoreIds = myStores.map(s => s.id);

  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const unsub = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'transfers')), orderBy('createdAt', 'desc'), limit(100)),
      snap => {
        setTransfers(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TransferRow));
        setIsLoading(false);
      },
      () => setIsLoading(false)
    );
    return () => unsub();
  }, [tenantId]);

  const storeName = (id: string) => stores.find(s => s.id === id)?.name || '—';

  const act = async (url: string, body: Record<string, unknown>, id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ArrowRightLeft className="h-6 w-6" /> Transferts entre magasins
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Le stock sort du magasin source à l&apos;expédition et entre à destination
              à la réception. Entre les deux, il est en transit.
            </p>
          </div>
          {stores.length >= 2 && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" /> Nouveau transfert
            </Button>
          )}
        </div>

        {stores.length < 2 && (
          <Card>
            <CardContent className="p-6 text-sm text-gray-600">
              Les transferts nécessitent au moins deux magasins. Créez-en un second
              depuis la page Magasins.
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : transfers.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-gray-500">
              Aucun transfert pour le moment.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {transfers.map(t => (
              <Card key={t.id}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{t.reference}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[t.status]}`}>
                          {TRANSFER_STATUS_LABELS[t.status]}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {storeName(t.fromStoreId)} → {storeName(t.toStoreId)}
                      </p>
                      <ul className="mt-2 text-sm text-gray-500 space-y-0.5">
                        {t.lines?.map(l => (
                          <li key={l.productId}>
                            {l.quantity} × {l.productName || l.productId}
                          </li>
                        ))}
                      </ul>
                      {t.note && <p className="mt-2 text-xs text-gray-400 italic">{t.note}</p>}
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      {t.status === 'PENDING' && (
                        <>
                          <Button size="sm" disabled={busyId === t.id}
                            onClick={() => act('/api/transfers/decide', { transferId: t.id, action: 'APPROVE' }, t.id)}>
                            <Check className="h-4 w-4 mr-1" /> Valider
                          </Button>
                          <Button size="sm" variant="outline" disabled={busyId === t.id}
                            onClick={() => act('/api/transfers/decide', { transferId: t.id, action: 'REJECT' }, t.id)}>
                            <X className="h-4 w-4 mr-1" /> Refuser
                          </Button>
                        </>
                      )}
                      {t.status === 'APPROVED' && (
                        <Button size="sm" disabled={busyId === t.id}
                          onClick={() => act('/api/transfers/ship', { transferId: t.id }, t.id)}>
                          <Truck className="h-4 w-4 mr-1" /> Expédier
                        </Button>
                      )}
                      {t.status === 'SHIPPED' && (
                        <Button size="sm" disabled={busyId === t.id}
                          onClick={() => act('/api/transfers/receive', { transferId: t.id }, t.id)}>
                          <PackageCheck className="h-4 w-4 mr-1" /> Confirmer la réception
                        </Button>
                      )}
                      {['PENDING', 'APPROVED', 'SHIPPED'].includes(t.status) && (
                        <Button size="sm" variant="outline" disabled={busyId === t.id}
                          onClick={() => act('/api/transfers/decide', { transferId: t.id, action: 'CANCEL' }, t.id)}>
                          Annuler
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CreateTransferDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onError={setError}
        stores={stores}
        myStoreIds={myStoreIds}
      />
    </DashboardLayout>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function CreateTransferDialog({
  open, onOpenChange, onError, stores, myStoreIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onError: (m: string | null) => void;
  stores: { id: string; name: string }[];
  myStoreIds: string[];
}) {
  const { tenant } = useAuthStore();
  const [fromStoreId, setFromStoreId] = useState('');
  const [toStoreId, setToStoreId] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<{ productId: string; productName: string; quantity: string }[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = () => {
    setFromStoreId(''); setToStoreId(''); setNote('');
    setRows([]);
    setLocalError(null);
  };

  const submit = async () => {
    setLocalError(null);
    if (!fromStoreId || !toStoreId) return setLocalError('Choisissez les deux magasins');
    if (fromStoreId === toStoreId) return setLocalError('Les magasins doivent être différents');

    const lines = rows
      .filter(r => r.productId.trim() && Number(r.quantity) > 0)
      .map(r => ({
        productId: r.productId.trim(),
        productName: r.productName.trim(),
        productSku: '',
        quantity: Math.floor(Number(r.quantity)),
      }));
    if (lines.length === 0) return setLocalError('Ajoutez au moins un produit avec une quantité');

    setIsSaving(true);
    try {
      const res = await fetch('/api/transfers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromStoreId, toStoreId, lines, note }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
      reset();
      onOpenChange(false);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (o) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nouveau transfert</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Magasin source *</Label>
              <Select value={fromStoreId} onValueChange={setFromStoreId}>
                <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                <SelectContent>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Magasin destination *</Label>
              <Select value={toStoreId} onValueChange={setToStoreId}>
                <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                <SelectContent>
                  {stores.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {/* Repère visuel : un responsable de boutique demande
                          presque toujours un transfert VERS son magasin. */}
                      {myStoreIds.includes(s.id) ? ' (le vôtre)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Produits *</Label>
            {!fromStoreId ? (
              <p className="mt-2 text-sm text-gray-500">
                Choisissez d&apos;abord le magasin source : le stock disponible
                dépend de lui.
              </p>
            ) : (
              <div className="mt-2">
                <ProductPicker
                  tenantId={tenant?.id}
                  storeId={fromStoreId}
                  alreadyPicked={rows.map(r => r.productId)}
                  onPick={p =>
                    setRows(rs => [
                      ...rs,
                      { productId: p.productId, productName: p.productName, quantity: '1' },
                    ])
                  }
                />
              </div>
            )}

            {rows.length > 0 && (
              <div className="mt-3 space-y-2">
                {rows.map((r, i) => (
                  <div key={r.productId} className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-gray-800 truncate">{r.productName}</span>
                    <Input
                      type="number" min="1" className="w-20"
                      value={r.quantity}
                      onChange={e =>
                        setRows(rs => rs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
                      }
                    />
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Note (optionnel)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>

          {fromStoreId && toStoreId &&
            !myStoreIds.includes(fromStoreId) && !myStoreIds.includes(toStoreId) && (
            <p className="text-sm text-amber-700">
              Vous devez être affecté à l&apos;un des deux magasins pour créer ce
              transfert. Choisissez le vôtre comme source ou comme destination.
            </p>
          )}

          {localError && <p className="text-sm text-red-600">{localError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Créer la demande
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
