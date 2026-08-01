'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign, Lock, Unlock, RefreshCw, TrendingUp,
  TrendingDown, History, CheckCircle2, AlertCircle, Banknote
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, toFirestoreDate, formatDateTime } from '@/lib/utils/helpers';
import { useAuthStore } from '@/hooks/store';
import { ref, onValue, set, push, get } from 'firebase/database';
import { rtdb } from '@/lib/firebase/client';
import { RTDB_PATHS } from '@/lib/firebase/rtdb';
import {
  collection, query, where, orderBy, onSnapshot, limit
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { isManagerPlus as isManagerPlusRole } from '@/lib/auth/roles';

interface CashSession {
  status: 'OPEN' | 'CLOSED';
  openedBy: string;
  openedByName: string;
  openedAt: number;
  openingBalance: number;
  closedAt?: number;
  closingBalance?: number;
  expectedBalance?: number;
  difference?: number;
  notes?: string;
}

interface Sale { id: string; total: number; paymentMethod?: string; createdAt: unknown; }


export default function CashRegisterPage() {
  const { tenant, currentStore, user } = useAuthStore();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;
  const registerId = storeId ? `register_${storeId}` : null;

  const [session, setSession] = useState<CashSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [todaySales, setTodaySales] = useState<Sale[]>([]);
  const [sessionHistory, setSessionHistory] = useState<{ id: string; data: CashSession }[]>([]);

  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [closingAmount, setClosingAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // ─── Écoute RTDB de la caisse ────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || !registerId) return;
    const path = RTDB_PATHS.cashRegister(tenantId, registerId);
    const cashRef = ref(rtdb, path);
    const unsub = onValue(cashRef, snap => {
      setSession(snap.exists() ? snap.val() : null);
      setIsLoading(false);
    });
    return () => unsub();
  }, [tenantId, registerId]);

  // ─── Ventes du jour (pour calcul attendu) ────────────────────────────────
  // Fix : ne filtrait ni par magasin ni par session — le solde attendu à la
  // fermeture mélangeait les ventes de TOUS les magasins du tenant, et
  // comptait depuis minuit même si la caisse avait été ouverte plus tard dans
  // la journée. On scope maintenant au magasin courant + à la session en
  // cours (depuis son ouverture), ce qui est aussi ce qui permet à un
  // Caissier de ne voir que le total de SA session (ou de la session
  // partagée en cas de relève), jamais un CA jour/mois consolidé.
  useEffect(() => {
    if (!tenantId || !storeId) return;
    const q = query(
      collection(db, tenantCol(tenantId, 'sales')),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'), limit(200)
    );
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Sale[];
      const sinceStart = session?.status === 'OPEN' && session.openedAt
        ? new Date(session.openedAt)
        : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
      setTodaySales(all.filter(s => toFirestoreDate(s.createdAt) >= sinceStart));
    });
  }, [tenantId, storeId, session?.status, session?.openedAt]);

  // ─── Historique des sessions (Firestore) ──────────────────────────────────
  // Réservé à Manager+ : un Caissier n'a besoin que du statut de la session en
  // cours pour ouvrir/fermer son poste, pas de l'historique des clôtures
  // passées (CA d'autres jours/caissiers/magasins).
  const canViewHistory = isManagerPlusRole(user?.role);
  useEffect(() => {
    if (!tenantId || !storeId || !canViewHistory) { setSessionHistory([]); return; }
    const q = query(
      collection(db, tenantCol(tenantId, 'cash_sessions')),
      orderBy('openedAt', 'desc'), limit(10)
    );
    return onSnapshot(q, snap => {
      setSessionHistory(snap.docs.map(d => ({ id: d.id, data: d.data() as CashSession })));
    });
  }, [tenantId, storeId, canViewHistory]);

  // ─── Calculs ────────────────────────────────────────────────────────────
  const cashSalesToday = todaySales.filter(s => (s.paymentMethod || 'CASH') === 'CASH');
  const cashTotal = cashSalesToday.reduce((s, v) => s + (v.total || 0), 0);
  const expectedBalance = (session?.openingBalance || 0) + cashTotal;
  const totalToday = todaySales.reduce((s, v) => s + (v.total || 0), 0);
  const txCount = todaySales.length;

  // ─── Ouvrir la caisse ───────────────────────────────────────────────────
  const handleOpen = async () => {
    if (!tenantId || !registerId || !user) return;
    const amount = Number(openingAmount) || 0;
    setIsSaving(true);
    try {
      const path = RTDB_PATHS.cashRegister(tenantId, registerId);
      const newSession: CashSession = {
        status: 'OPEN',
        openedBy: user.id,
        openedByName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        openedAt: Date.now(),
        openingBalance: amount,
      };
      await set(ref(rtdb, path), newSession);
      setShowOpen(false);
      setOpeningAmount('');
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Fermer la caisse ───────────────────────────────────────────────────
  const [closeError, setCloseError] = useState<string | null>(null);
  const handleClose = async () => {
    if (!tenantId || !registerId || !user || !session) return;
    const counted = Number(closingAmount) || 0;
    setIsSaving(true);
    setCloseError(null);
    try {
      // La différence est recalculée côté serveur à partir des vraies ventes
      // Firestore — on ne fait plus confiance au total calculé côté client,
      // ce qui empêche un caissier de masquer un manque de caisse.
      const res = await fetch('/api/cash-register/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, storeId, registerId,
          openedBy: session.openedBy,
          openedByName: session.openedByName,
          openedAt: session.openedAt,
          openingBalance: session.openingBalance,
          countedAmount: counted,
          notes: closeNotes || null,
          closedByName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la clôture');

      // Réinitialiser RTDB
      const path = RTDB_PATHS.cashRegister(tenantId, registerId);
      await set(ref(rtdb, path), { status: 'CLOSED', closedAt: Date.now() });

      setShowClose(false);
      setClosingAmount('');
      setCloseNotes('');
    } catch (e) {
      console.error(e);
      setCloseError(e instanceof Error ? e.message : 'Erreur lors de la clôture de la caisse');
    } finally {
      setIsSaving(false);
    }
  };

  const isOpen = session?.status === 'OPEN';

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-gray-400">
          <RefreshCw className="h-6 w-6 animate-spin mr-3" />Chargement...
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Caisse</h1>
            <p className="text-sm text-gray-500 mt-1">{currentStore?.name || 'Magasin'}</p>
          </div>
          {isOpen ? (
            <Button onClick={() => { setClosingAmount(''); setCloseNotes(''); setShowClose(true); }}
              variant="outline" className="text-red-600 border-red-200 hover:bg-red-50">
              <Lock className="h-4 w-4 mr-2" />Fermer la caisse
            </Button>
          ) : (
            <Button onClick={() => { setOpeningAmount(''); setShowOpen(true); }} className="bg-green-600 hover:bg-green-700">
              <Unlock className="h-4 w-4 mr-2" />Ouvrir la caisse
            </Button>
          )}
        </div>

        {/* État de la caisse */}
        <Card className={isOpen ? 'border-green-200' : 'border-gray-200'}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${isOpen ? 'bg-green-100' : 'bg-gray-100'}`}>
                  {isOpen ? <Unlock className="h-6 w-6 text-green-600" /> : <Lock className="h-6 w-6 text-gray-400" />}
                </div>
                <div>
                  <p className="font-bold text-lg text-gray-900">
                    Caisse {isOpen ? 'ouverte' : 'fermée'}
                  </p>
                  {isOpen && session && (
                    <p className="text-sm text-gray-500">
                      Ouverte par {session.openedByName} · {formatDateTime(new Date(session.openedAt))}
                    </p>
                  )}
                </div>
              </div>
              <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {isOpen ? 'EN COURS' : 'FERMÉE'}
              </span>
            </div>

            {isOpen && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Fond de caisse</p>
                  <p className="font-bold text-gray-900">{formatCurrency(session?.openingBalance || 0)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Ventes espèces</p>
                  <p className="font-bold text-blue-600">{formatCurrency(cashTotal)}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Solde attendu</p>
                  <p className="font-bold text-green-700">{formatCurrency(expectedBalance)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Transactions</p>
                  <p className="font-bold text-gray-900">{txCount}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Résumé du jour */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "CA de cette session", value: formatCurrency(totalToday), icon: DollarSign, color: 'text-primary-600' },
            { label: 'Ventes espèces', value: formatCurrency(cashTotal), icon: Banknote, color: 'text-green-600' },
            { label: 'Transactions', value: txCount, icon: TrendingUp, color: 'text-blue-600' },
            { label: 'Ticket moyen', value: txCount > 0 ? formatCurrency(totalToday / txCount) : '—', icon: TrendingUp, color: 'text-purple-600' },
          ].map((s, i) => (
            <Card key={i}><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <s.icon className={`h-7 w-7 ${s.color} opacity-80`} />
                <div><p className="text-xs text-gray-500">{s.label}</p><p className="font-bold text-gray-900">{s.value}</p></div>
              </div>
            </CardContent></Card>
          ))}
        </div>

        {/* Historique des sessions — réservé à Manager+ */}
        {canViewHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-gray-600" />Historique des sessions</CardTitle>
            <CardDescription>Les 10 dernières fermetures de caisse</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {sessionHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <History className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">Aucune session fermée pour le moment</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ouverture</TableHead>
                    <TableHead>Fermeture</TableHead>
                    <TableHead className="text-right">Fond initial</TableHead>
                    <TableHead className="text-right">Attendu</TableHead>
                    <TableHead className="text-right">Compté</TableHead>
                    <TableHead className="text-right">Écart</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessionHistory.map(({ id, data }) => {
                    const diff = data.difference || 0;
                    return (
                      <TableRow key={id}>
                        <TableCell className="text-sm text-gray-500">{formatDateTime(new Date(data.openedAt))}</TableCell>
                        <TableCell className="text-sm text-gray-500">{data.closedAt ? formatDateTime(new Date(data.closedAt)) : '—'}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(data.openingBalance)}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(data.expectedBalance || 0)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatCurrency(data.closingBalance || 0)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm font-bold ${diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                            {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      {/* Dialog ouverture */}
      <Dialog open={showOpen} onOpenChange={o => { if (!o) setShowOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Ouvrir la caisse</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Fond de caisse initial (FCFA)</Label>
              <Input type="number" min="0" placeholder="0" value={openingAmount}
                onChange={e => setOpeningAmount(e.target.value)} className="text-lg font-bold" autoFocus />
              <p className="text-xs text-gray-400">Montant en espèces présent dans la caisse au démarrage</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOpen(false)}>Annuler</Button>
            <Button onClick={handleOpen} disabled={isSaving} className="bg-green-600 hover:bg-green-700">
              {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Ouverture...</> : <><Unlock className="h-4 w-4 mr-2" />Ouvrir</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog fermeture */}
      <Dialog open={showClose} onOpenChange={o => { if (!o) setShowClose(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fermer la caisse</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Solde attendu</p>
              <p className="text-xl font-bold text-green-700">{formatCurrency(expectedBalance)}</p>
            </div>
            <div className="space-y-2">
              <Label>Montant compté en caisse *</Label>
              <Input type="number" min="0" placeholder="0" value={closingAmount}
                onChange={e => setClosingAmount(e.target.value)} className="text-lg font-bold" autoFocus />
            </div>
            {closingAmount && (
              <div className={`rounded-lg p-3 text-center ${Number(closingAmount) - expectedBalance === 0 ? 'bg-green-50' : Number(closingAmount) - expectedBalance > 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
                <p className="text-xs text-gray-500 mb-1">Écart</p>
                <p className={`text-lg font-bold ${Number(closingAmount) - expectedBalance === 0 ? 'text-green-700' : Number(closingAmount) - expectedBalance > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  {Number(closingAmount) - expectedBalance > 0 ? '+' : ''}{formatCurrency(Number(closingAmount) - expectedBalance)}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Notes (optionnel)</Label>
              <Textarea placeholder="Remarques sur la fermeture..." value={closeNotes} onChange={e => setCloseNotes(e.target.value)} rows={2} />
            </div>
            {closeError && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />{closeError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClose(false)}>Annuler</Button>
            <Button onClick={handleClose} disabled={isSaving || !closingAmount} className="bg-red-600 hover:bg-red-700">
              {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Fermeture...</> : <><Lock className="h-4 w-4 mr-2" />Confirmer la fermeture</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
