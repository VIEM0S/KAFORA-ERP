'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ClipboardCheck, Search, X, RefreshCw, CheckCircle2, XCircle, Clock, Play } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuthStore } from '@/hooks/store';
import { isManagerPlus, isOwnerOrAdmin } from '@/lib/auth/roles';
import { supabase } from '@/lib/supabase/client';
import { watch } from '@/lib/supabase/watch';
import { mapStocktake, mapStocktakeLine } from '@/lib/supabase/mappers';
import { formatCurrency, formatDateTime } from '@/lib/utils/helpers';
import type { Stocktake, StocktakeLine, StocktakeStatus } from '@/lib/types';

const STATUS_LABEL: Record<StocktakeStatus, string> = {
  IN_PROGRESS: 'En cours', PENDING_APPROVAL: 'En attente de validation',
  COMPLETED: 'Terminé', REJECTED: 'Refusé', CANCELLED: 'Annulé',
};

function statusBadge(s: StocktakeStatus) {
  const map: Record<StocktakeStatus, { cls: string; Icon: typeof Clock }> = {
    IN_PROGRESS: { cls: 'bg-blue-100 text-blue-700 hover:bg-blue-100', Icon: Play },
    PENDING_APPROVAL: { cls: 'bg-amber-100 text-amber-700 hover:bg-amber-100', Icon: Clock },
    COMPLETED: { cls: 'bg-green-100 text-green-700 hover:bg-green-100', Icon: CheckCircle2 },
    REJECTED: { cls: 'bg-red-100 text-red-700 hover:bg-red-100', Icon: XCircle },
    CANCELLED: { cls: 'bg-gray-100 text-gray-600 hover:bg-gray-100', Icon: XCircle },
  };
  const { cls, Icon } = map[s];
  return <Badge className={`${cls} border-transparent`}><Icon className="h-3 w-3 mr-1" />{STATUS_LABEL[s]}</Badge>;
}

async function postJson(body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch('/api/stocktakes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// PostgREST plafonne une requête à 1000 lignes : un catalogue plus grand
// (plans Business/Enterprise) doit être lu par pages.
async function fetchAllLines(stocktakeId: string): Promise<StocktakeLine[]> {
  const all: StocktakeLine[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('stocktake_lines').select('*')
      .eq('stocktake_id', stocktakeId).order('product_name', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data ?? []).map(mapStocktakeLine));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

export default function StocktakePage() {
  const { tenant, user, currentStore } = useAuthStore();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;
  // Décisions d'affichage seulement — les vraies barrières sont les RPC *_stocktake.
  const canCount = isManagerPlus(user?.role);
  const canDecide = isOwnerOrAdmin(user?.role);

  const [all, setAll] = useState<Stocktake[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lines, setLines] = useState<StocktakeLine[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'stocktakes',
      () => supabase.from('stocktakes').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      rows => { setAll(rows.map(mapStocktake)); setIsLoading(false); },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId]);

  const forStore = useMemo(() => all.filter(s => s.storeId === storeId), [all, storeId]);
  const active = forStore.find(s => s.status === 'IN_PROGRESS' || s.status === 'PENDING_APPROVAL') ?? null;
  const history = forStore.filter(s => s.id !== active?.id);
  const activeId = active?.id;
  const activeStatus = active?.status;

  const loadLines = useCallback(async (id: string) => {
    try {
      const rows = await fetchAllLines(id);
      setLines(rows);
      setCounts(prev => {
        const next: Record<string, string> = {};
        rows.forEach(l => { next[l.productId] = prev[l.productId] ?? (l.countedQty === null ? '' : String(l.countedQty)); });
        return next;
      });
    } catch (e) { console.error(e); setError('Impossible de charger la liste des produits'); }
  }, []);

  useEffect(() => {
    // Recharge les lignes à chaque changement d'inventaire actif ou de statut.
    if (!activeId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLines(activeId);
  }, [activeId, activeStatus, loadLines]);

  const countedNum = (productId: string): number | null => {
    const v = counts[productId];
    if (v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const summary = useMemo(() => {
    let counted = 0, loss = 0;
    lines.forEach(l => {
      const c = countedNum(l.productId);
      if (c === null) return;
      counted++;
      if (c < l.expectedQty) loss += (l.expectedQty - c) * l.unitCost;
    });
    return { counted, total: lines.length, loss };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, counts]);

  const pendingPayload = () => lines.map(l => ({ product_id: l.productId, counted: countedNum(l.productId) }));

  const run = async (fn: () => Promise<{ ok: boolean; data: Record<string, unknown> }>, onOk?: (d: Record<string, unknown>) => void) => {
    setBusy(true); setError(null);
    try {
      const { ok, data } = await fn();
      if (!ok) { setError((data.error as string) || 'Erreur'); return false; }
      onOk?.(data);
      return true;
    } catch (e) { console.error(e); setError('Erreur de connexion'); return false; }
    finally { setBusy(false); }
  };

  const handleStart = () => run(() => postJson({ action: 'start', storeId }), () => { setCounts({}); setLines([]); });
  const handleSave = () => run(() => postJson({ action: 'save', id: active!.id, counts: pendingPayload() }), () => {
    setNotice('Progression enregistrée.'); setTimeout(() => setNotice(null), 3000);
  });
  const handleSubmit = () => run(() => postJson({ action: 'submit', id: active!.id, counts: pendingPayload() }), d => {
    setNotice(d.status === 'PENDING_APPROVAL'
      ? `Inventaire soumis : la perte estimée (${formatCurrency(Number(d.lossValue))}) dépasse le seuil de ${formatCurrency(Number(d.threshold))}. Le stock sera ajusté après validation du Propriétaire ou d'un Administrateur.`
      : 'Inventaire terminé : le stock a été ajusté.');
    setTimeout(() => setNotice(null), 8000);
  });
  const handleCancel = () => run(() => postJson({ action: 'cancel', id: active!.id }), () => { setLines([]); setCounts({}); });
  const handleApprove = () => run(() => postJson({ action: 'decide', id: active!.id, approve: true }), () => {
    setNotice('Inventaire validé : le stock a été ajusté.'); setTimeout(() => setNotice(null), 5000);
  });
  const handleReject = async () => {
    if (!rejectNote.trim()) { setError('Un motif est obligatoire pour refuser'); return; }
    if (await run(() => postJson({ action: 'decide', id: active!.id, approve: false, note: rejectNote }))) { setRejectOpen(false); setRejectNote(''); }
  };

  const visible = lines.filter(l => {
    if (search && !`${l.productName} ${l.sku ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (onlyGaps) { const c = countedNum(l.productId); return c !== null && c !== l.expectedQty; }
    return true;
  });
  const isOwnStocktake = active?.createdBy === user?.id;

  if (!canCount) {
    return (
      <DashboardLayout>
        <Alert variant="destructive"><AlertDescription>L&apos;inventaire physique est réservé aux Responsables, Administrateurs et au Propriétaire.</AlertDescription></Alert>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventaire physique</h1>
          <p className="text-sm text-gray-500 mt-1">
            Comptez le stock réel{currentStore ? ` de ${currentStore.name}` : ''} et rapprochez-le du stock enregistré. Les écarts sont ajustés à la fin du comptage.
          </p>
        </div>

        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {!storeId ? (
          <Alert><AlertDescription>Choisissez d&apos;abord un magasin.</AlertDescription></Alert>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
        ) : !active ? (
          <Card><CardContent className="p-6 flex flex-col items-center text-center gap-3">
            <ClipboardCheck className="h-12 w-12 text-gray-300" />
            <p className="font-medium text-gray-900">Aucun inventaire en cours</p>
            <p className="text-sm text-gray-500 max-w-md">
              Le stock théorique de chaque produit est figé au démarrage. Vous saisissez ensuite ce que vous comptez réellement. Vous pouvez ne compter qu&apos;une partie des produits.
            </p>
            <Button onClick={handleStart} disabled={busy} className="bg-primary-600 hover:bg-primary-700">
              {busy ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Démarrage...</> : <><Play className="h-4 w-4 mr-2" />Démarrer un inventaire</>}
            </Button>
          </CardContent></Card>
        ) : (
          <>
            <Card><CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">{statusBadge(active.status)}<span className="text-sm text-gray-500">démarré le {formatDateTime(active.createdAt)}{active.createdByName ? ` par ${active.createdByName}` : ''}</span></div>
                <p className="text-sm text-gray-700">
                  {summary.counted} / {summary.total} produits comptés · perte estimée{' '}
                  <span className={summary.loss > (tenant?.stockLossApprovalThreshold ?? Infinity) ? 'font-semibold text-red-600' : 'font-semibold'}>{formatCurrency(summary.loss)}</span>
                  {tenant && <span className="text-gray-400"> (seuil de validation : {formatCurrency(tenant.stockLossApprovalThreshold)})</span>}
                </p>
              </div>
              {active.status === 'IN_PROGRESS' && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleSave} disabled={busy}>Enregistrer</Button>
                  <Button onClick={handleSubmit} disabled={busy || summary.counted === 0} className="bg-primary-600 hover:bg-primary-700">Terminer l&apos;inventaire</Button>
                  <Button variant="outline" onClick={handleCancel} disabled={busy}>Annuler</Button>
                </div>
              )}
            </CardContent></Card>

            {active.status === 'PENDING_APPROVAL' && (
              <Alert className="border-amber-300 bg-amber-50">
                <AlertDescription className="text-amber-800 space-y-3">
                  <p>
                    Cet inventaire a une perte estimée de <strong>{formatCurrency(active.lossValue ?? 0)}</strong>, au-dessus du seuil de validation.
                    Le stock ne sera ajusté qu&apos;après validation par le Propriétaire ou un Administrateur.
                  </p>
                  {canDecide && !isOwnStocktake && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleApprove} disabled={busy} className="bg-green-600 hover:bg-green-700">Valider et ajuster le stock</Button>
                      <Button size="sm" variant="outline" onClick={() => { setRejectOpen(true); setError(null); }} disabled={busy}>Refuser</Button>
                    </div>
                  )}
                  {canDecide && isOwnStocktake && <p className="text-xs">Vous avez soumis cet inventaire : une autre personne habilitée doit le valider.</p>}
                  {canDecide && (
                    <Button size="sm" variant="ghost" onClick={handleCancel} disabled={busy}>Annuler cet inventaire</Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Card><CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input placeholder="Produit ou référence..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                  {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X className="h-4 w-4" /></button>}
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} className="h-4 w-4" />
                  Seulement les écarts
                </label>
              </div>
            </CardContent></Card>

            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead className="text-right">Stock enregistré</TableHead>
                    <TableHead className="w-36 text-right">Quantité comptée</TableHead>
                    <TableHead className="text-right">Écart</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map(l => {
                    const c = active.status === 'IN_PROGRESS' ? countedNum(l.productId) : l.countedQty;
                    const diff = c === null ? null : c - l.expectedQty;
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          <p className="text-sm font-medium text-gray-900">{l.productName}</p>
                          {l.sku && <p className="text-xs text-gray-400">{l.sku}</p>}
                        </TableCell>
                        <TableCell className="text-right text-sm">{l.expectedQty}</TableCell>
                        <TableCell className="text-right">
                          {active.status === 'IN_PROGRESS' ? (
                            <Input type="number" min={0} inputMode="numeric" className="w-28 ml-auto text-right"
                              aria-label={`Quantité comptée — ${l.productName}`}
                              value={counts[l.productId] ?? ''} onChange={e => setCounts(p => ({ ...p, [l.productId]: e.target.value }))} />
                          ) : <span className="text-sm">{l.countedQty ?? '—'}</span>}
                        </TableCell>
                        <TableCell className={`text-right text-sm font-medium ${diff === null || diff === 0 ? 'text-gray-400' : diff < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {diff === null ? '—' : diff > 0 ? `+${diff}` : diff}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {visible.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-gray-400 py-10">
                      {lines.length === 0 ? 'Aucun produit à compter.' : 'Aucun produit ne correspond.'}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent></Card>
          </>
        )}

        {history.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Historique</h2>
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Par</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Perte estimée</TableHead>
                    <TableHead>Décision</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm whitespace-nowrap">{formatDateTime(s.createdAt)}</TableCell>
                      <TableCell className="text-sm">{s.createdByName || '—'}</TableCell>
                      <TableCell>{statusBadge(s.status)}</TableCell>
                      <TableCell className="text-right text-sm">{s.lossValue === null ? '—' : formatCurrency(s.lossValue)}</TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {s.decidedByName ? `${s.decidedByName}${s.decisionNote ? ` — ${s.decisionNote}` : ''}` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </div>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={o => { if (!o) setRejectOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Refuser cet inventaire</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Label htmlFor="stocktake-reject-note">Motif du refus *</Label>
            <Textarea id="stocktake-reject-note" value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3} placeholder="Ex. Recomptez les produits en écart important" />
            <p className="text-xs text-gray-500">Le stock ne sera pas modifié.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={busy}>Annuler</Button>
            <Button onClick={handleReject} disabled={busy} className="bg-red-600 hover:bg-red-700">Refuser</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
