'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign, Lock, Unlock, RefreshCw, TrendingUp,
  TrendingDown, History, CheckCircle2, AlertCircle, Banknote, Receipt, BookOpen
} from 'lucide-react';
import { SessionJournalDialog } from '@/components/cash-register/session-journal-dialog';
import { StoreJournalDialog } from '@/components/cash-register/store-journal-dialog';
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
import { formatCurrency, formatDateTime } from '@/lib/utils/helpers';
import { exportToCsv } from '@/lib/utils/export';
import { Download } from 'lucide-react';
import { useAuthStore } from '@/hooks/store';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { mapCashSession, mapSale } from '@/lib/supabase/mappers';
import { isManagerPlus as isManagerPlusRole } from '@/lib/auth/roles';
import type { CashRegisterSession, Sale } from '@/lib/types';


export default function CashRegisterPage() {
  const { tenant, currentStore, user } = useAuthStore();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;

  const [session, setSession] = useState<CashRegisterSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [todaySales, setTodaySales] = useState<Sale[]>([]);
  const [creditRepaymentTotal, setCreditRepaymentTotal] = useState(0);
  const [cashRefundTotal, setCashRefundTotal] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<CashRegisterSession[]>([]);

  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [closingAmount, setClosingAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Journal détaillé (voir components/cash-register/session-journal-dialog.tsx)
  // — accessible depuis ma propre session, "Autres caisses ouvertes" et
  // l'historique des clôtures : n'importe quelle session que je peux déjà
  // voir dans cette page.
  const [journalTarget, setJournalTarget] = useState<CashRegisterSession | null>(null);
  // Journal consolidé du magasin (tous caissiers confondus, par journée) —
  // voir components/cash-register/store-journal-dialog.tsx.
  const [showStoreJournal, setShowStoreJournal] = useState(false);

  // ─── État de la caisse ────────────────────────────────────────────────────
  // Remplace l'écoute RTDB (Realtime Database est entièrement éliminée) : la
  // ligne cash_sessions status='OPEN' de ce magasin EST l'état live, via un
  // abonnement Realtime Postgres — même rôle, une seule source de vérité au
  // lieu d'une double-écriture Firestore+RTDB.
  useEffect(() => {
    if (!tenantId || !storeId || !user?.id) return;
    // MA caisse personnelle (migration 047) — plus "la" caisse du magasin :
    // deux collègues peuvent désormais avoir chacun la leur ouverte en même
    // temps, sans se marcher dessus.
    return watch(
      'cash_sessions',
      () => supabase.from('cash_sessions').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
        .eq('opened_by', user.id).eq('status', 'OPEN').limit(1),
      rows => {
        setSession(rows.length > 0 ? mapCashSession(rows[0]) : null);
        setIsLoading(false);
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId, user?.id]);

  // ─── Ventes du jour (pour calcul attendu) ────────────────────────────────
  // Fix (héritage Firestore) : ne filtrait ni par magasin ni par session — le
  // solde attendu à la fermeture mélangeait les ventes de TOUS les magasins
  // du tenant, et comptait depuis minuit même si la caisse avait été ouverte
  // plus tard dans la journée. Scope au magasin courant + à MA session
  // personnelle (migration 047, depuis son ouverture) : sans le filtre
  // cashier_id, les ventes d'un collègue ayant sa propre caisse ouverte en
  // parallèle se mélangeraient dans mon solde attendu.
  useEffect(() => {
    if (!tenantId || !storeId || !user?.id) return;
    const sinceStart = session?.status === 'OPEN'
      ? session.openedAt
      : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
    return watch(
      'sales',
      () => supabase.from('sales').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
        .eq('cashier_id', user.id)
        .gte('created_at', sinceStart.toISOString()).order('created_at', { ascending: false }).limit(200),
      rows => setTodaySales(rows.map(r => mapSale(r))),
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId, user?.id, session?.status, session?.openedAt]);

  // ─── Versements de dette encaissés pendant la session ────────────────────
  //
  // Un client qui vient régler sa dette dépose de l'argent dans ce tiroir.
  // credit_payments est une table de premier niveau (tenant_id/store_id
  // directs) — plus besoin de la requête par groupe de collections que
  // Firestore imposait pour une sous-collection.
  useEffect(() => {
    if (!tenantId || !storeId || !user?.id) { setCreditRepaymentTotal(0); return; }
    const sinceStart = session?.status === 'OPEN'
      ? session.openedAt
      : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

    return watch(
      'credit_payments',
      // On ne compte que les règlements en espèces (un virement ou un
      // paiement Mobile Money ne passe pas par le tiroir) ET encaissés par
      // MOI (migration 047) — sinon un versement pris par un collègue sur
      // sa propre caisse gonflerait mon solde attendu.
      () => supabase.from('credit_payments').select('amount').eq('tenant_id', tenantId).eq('store_id', storeId)
        .eq('payment_method', 'CASH').eq('user_id', user.id).gte('created_at', sinceStart.toISOString()),
      rows => setCreditRepaymentTotal(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)),
      // Coupure ou refus RLS : on n'empêche pas la caisse de fonctionner, on
      // affiche simplement 0 de ce côté.
      () => setCreditRepaymentTotal(0),
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId, user?.id, session?.status, session?.openedAt]);

  // ─── Remboursements sortis du tiroir pendant la session ──────────────────
  //
  // Un retour de marchandise remboursé en espèces retire de l'argent de la
  // caisse. Sans cette déduction, le solde attendu reste trop élevé et le
  // caissier apparaît en manquant pour de l'argent qu'il a légitimement rendu.
  //
  // On ne compte que `cash_refund`, pas `refund_amount` : la part imputée sur
  // une dette client n'a jamais quitté le tiroir.
  useEffect(() => {
    if (!tenantId || !storeId || !user?.id) { setCashRefundTotal(0); return; }
    const sinceStart = session?.status === 'OPEN'
      ? session.openedAt
      : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

    return watch(
      'sale_returns',
      // processed_by = MOI (migration 047) : un remboursement traité par un
      // collègue sur sa propre caisse ne doit pas amputer mon solde attendu.
      () => supabase.from('sale_returns').select('cash_refund, refund_amount').eq('tenant_id', tenantId).eq('store_id', storeId)
        .eq('refund_method', 'CASH').eq('processed_by', user.id).gte('created_at', sinceStart.toISOString()),
      rows => setCashRefundTotal(rows.reduce((sum, r) => sum + (Number(r.cash_refund ?? r.refund_amount) || 0), 0)),
      () => setCashRefundTotal(0),
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId, user?.id, session?.status, session?.openedAt]);

  // ─── Historique des sessions ──────────────────────────────────────────────
  // Réservé à Manager+ : un Caissier n'a besoin que du statut de sa propre
  // session en cours pour ouvrir/fermer son poste, pas de l'historique des
  // clôtures passées (CA d'autres jours/caissiers/magasins).
  const canViewHistory = isManagerPlusRole(user?.role);
  useEffect(() => {
    if (!tenantId || !storeId || !canViewHistory) { setSessionHistory([]); return; }
    return watch(
      'cash_sessions',
      // status='CLOSED' explicite (migration 047) : depuis que plusieurs
      // caisses peuvent être ouvertes en parallèle, cette table doit rester
      // un historique de clôtures, pas mélanger avec les sessions encore en
      // cours (voir le panneau "Autres caisses ouvertes" juste en dessous).
      // store_id=storeId : sans ce filtre (bug trouvé lors de l'audit —
      // préexistant, jamais visible tant qu'il n'y avait qu'un magasin
      // testé), un Responsable régional ou Admin changeant de magasin via
      // le sélecteur voyait l'historique de TOUS les magasins du tenant
      // mélangés, pas seulement celui affiché à l'écran.
      () => supabase.from('cash_sessions').select('*').eq('tenant_id', tenantId).eq('store_id', storeId).eq('status', 'CLOSED')
        .order('opened_at', { ascending: false }).limit(10),
      rows => setSessionHistory(rows.map(mapCashSession)),
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId, canViewHistory]);

  // ─── Autres caisses ouvertes en ce moment (migration 047) ─────────────────
  // Réservé à Manager+ : vue d'ensemble des collègues qui ont chacun leur
  // propre caisse ouverte sur CE magasin — utile pour repérer une caisse
  // oubliée ouverte, et la seule façon de la clôturer si son titulaire n'est
  // plus là (voir handleCloseOther, qui utilise le même contrôle de rôle
  // que app/api/cash-register/close/route.ts).
  const [otherOpenSessions, setOtherOpenSessions] = useState<CashRegisterSession[]>([]);
  useEffect(() => {
    if (!tenantId || !storeId || !canViewHistory) { setOtherOpenSessions([]); return; }
    return watch(
      'cash_sessions',
      () => supabase.from('cash_sessions').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
        .eq('status', 'OPEN'),
      rows => setOtherOpenSessions(rows.map(mapCashSession).filter(s => s.openedBy !== user?.id)),
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId, canViewHistory, user?.id]);

  // ─── Clôturer la caisse d'un collègue (Manager+) ───────────────────────────
  const [closeTarget, setCloseTarget] = useState<CashRegisterSession | null>(null);
  const [targetCountedAmount, setTargetCountedAmount] = useState('');
  const [targetCloseError, setTargetCloseError] = useState<string | null>(null);
  const [targetCloseResult, setTargetCloseResult] = useState<{ expectedBalance: number; difference: number } | null>(null);
  const handleCloseOther = async () => {
    if (!tenantId || !storeId || !user || !closeTarget) return;
    setIsSaving(true);
    setTargetCloseError(null);
    try {
      const res = await fetch('/api/cash-register/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, storeId,
          targetUserId: closeTarget.openedBy,
          countedAmount: Number(targetCountedAmount) || 0,
          closedByName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'La clôture a échoué');
      setTargetCloseResult({ expectedBalance: data.expectedBalance || 0, difference: data.difference || 0 });
    } catch (e) {
      setTargetCloseError(e instanceof Error ? e.message : 'La clôture a échoué');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Calculs ────────────────────────────────────────────────────────────
  // ─── Rapprochement de caisse ────────────────────────────────────────────
  //
  // Le solde attendu doit refléter le TIROIR RÉEL, pas seulement les ventes
  // comptant. Avant, il valait « ouverture + ventes espèces » — et la caisse
  // d'un commerce pratiquant le crédit ne tombait donc JAMAIS juste :
  //
  //   • un acompte versé sur une vente à crédit est de l'argent dans le
  //     tiroir, mais la vente est de type CREDIT : elle était ignorée, et le
  //     caissier apparaissait en excédent ;
  //   • un client venu régler sa dette dépose lui aussi de l'argent : ce
  //     versement n'était compté nulle part ;
  //   • un remboursement sort de l'argent : il n'était pas déduit, et le
  //     tiroir semblait manquant.
  //
  // Un écart permanent et inexpliqué rend le contrôle de caisse inutile —
  // pire, il masque les vrais écarts, ceux qu'on cherche justement à détecter.
  // Seules les ventes FINALISÉES sont dans le tiroir. Une vente annulée a
  // été remboursée au client : la compter gonflerait le solde attendu et
  // ferait apparaître un manquant au caissier, pour une erreur qui n'est pas
  // la sienne.
  const validSales = todaySales.filter(s => (s.status || 'COMPLETED') === 'COMPLETED');

  const cashSalesToday = validSales.filter(s => (s.paymentMethod || 'CASH') === 'CASH');
  const cashTotal = cashSalesToday.reduce((s, v) => s + (v.total || 0), 0);

  // Acomptes encaissés sur les ventes à crédit de la session. paidAmount
  // PORTE l'acompte pour une vente CREDIT (voir app/api/pos/checkout/route.ts
  // — receivedCash = acompte, stocké tel quel dans sales.paid_amount).
  const acompteTotal = validSales
    .filter(s => (s.paymentMethod || '') === 'CREDIT')
    .reduce((sum, v) => sum + (v.paidAmount || 0), 0);

  // ─── Encaissements HORS espèces ──────────────────────────────────────────
  //
  // Mobile Money, carte et solde à crédit ne passent PAS par le tiroir. Le
  // caissier ne doit donc compter que les espèces — mais il faut le lui dire,
  // sinon il se demande où sont passées ces ventes et croit à un manquant.
  const nonCashByMethod = validSales.reduce<Record<string, number>>((acc, v) => {
    const m = v.paymentMethod || 'CASH';
    if (m === 'CASH') return acc;
    if (m === 'CREDIT') {
      // Seule la part NON versée reste hors caisse ; l'acompte est déjà
      // compté dans le tiroir plus haut.
      const solde = (v.total || 0) - (v.paidAmount || 0);
      if (solde > 0) acc['CREDIT'] = (acc['CREDIT'] || 0) + solde;
      return acc;
    }
    acc[m] = (acc[m] || 0) + (v.total || 0);
    return acc;
  }, {});

  const NON_CASH_LABELS: Record<string, string> = {
    MOBILE_MONEY: 'Mobile Money',
    CARD: 'Carte bancaire',
    BANK_TRANSFER: 'Virement',
    CREDIT: 'Reste à crédit (non encaissé)',
  };

  const expectedBalance =
    (session?.openingBalance || 0)
    + cashTotal
    + acompteTotal
    + creditRepaymentTotal
    - cashRefundTotal;
  // Chiffre d'affaires et nombre de transactions : sur les ventes valides
  // également — afficher les annulées gonflerait le CA de la session.
  const totalToday = validSales.reduce((s, v) => s + (v.total || 0), 0);
  const txCount = validSales.length;

  // ─── Ouvrir la caisse ───────────────────────────────────────────────────
  const handleOpen = async () => {
    if (!tenantId || !storeId || !user) return;
    const amount = Number(openingAmount) || 0;
    setIsSaving(true);
    try {
      const res = await fetch('/api/cash-register/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, storeId, openingBalance: amount,
          openedByName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Erreur lors de l'ouverture de la caisse");
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
    if (!tenantId || !storeId || !user || !session) return;
    const counted = Number(closingAmount) || 0;
    setIsSaving(true);
    setCloseError(null);
    try {
      // La différence est recalculée côté serveur à partir des vraies ventes
      // — on ne fait plus confiance au total calculé côté client, ce qui
      // empêche un caissier de masquer un manque de caisse.
      const res = await fetch('/api/cash-register/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, storeId,
          countedAmount: counted,
          notes: closeNotes || null,
          closedByName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        }),
      });
      // Le serveur peut répondre une page d'erreur HTML au lieu de JSON
      // (plantage non intercepté). Parser sans précaution affichait alors
      // « Unexpected token 'T' » au caissier — un message incompréhensible
      // qui masque la vraie cause.
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          data?.error ||
          `La clôture a échoué (erreur ${res.status}). Réessayez ; si le problème persiste, notez le montant compté et contactez le support.`
        );
      }

      // Pas de réinitialisation manuelle d'état à faire : la ligne
      // cash_sessions passe elle-même à CLOSED, l'abonnement Realtime
      // (voir plus haut) répercute le changement automatiquement.
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Caisse</h1>
            <p className="text-sm text-gray-500 mt-1">{currentStore?.name || 'Magasin'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Tirer un journal (par caisse ou par magasin) est une action
                de supervision, pas une action de caissier — même hiérarchie
                que canViewHistory/otherOpenSessions plus bas (demandé
                explicitement : "c'est le responsable qui peut... tirer le
                journal", "il doit avoir le journal par magasin également"). */}
            {isManagerPlusRole(user?.role) && storeId && (
              <Button variant="outline" onClick={() => setShowStoreJournal(true)}>
                <BookOpen className="h-4 w-4 mr-2" />Journal du magasin
              </Button>
            )}
            {isOpen ? (
              <>
                {isManagerPlusRole(user?.role) && (
                  <Button variant="outline" onClick={() => session && setJournalTarget(session)}>
                    <Receipt className="h-4 w-4 mr-2" />Journal
                  </Button>
                )}
                <Button onClick={() => { setClosingAmount(''); setCloseNotes(''); setShowClose(true); }}
                  variant="outline" className="text-red-600 border-red-200 hover:bg-red-50">
                  <Lock className="h-4 w-4 mr-2" />Fermer la caisse
                </Button>
              </>
            ) : (
              <Button onClick={() => { setOpeningAmount(''); setShowOpen(true); }} className="bg-green-600 hover:bg-green-700">
                <Unlock className="h-4 w-4 mr-2" />Ouvrir la caisse
              </Button>
            )}
          </div>
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
                      Ouverte par {session.openedByName} · {formatDateTime(session.openedAt)}
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
        {/* Autres caisses ouvertes en ce moment (migration 047, Manager+) —
            plusieurs collègues peuvent chacun avoir la leur ouverte sur ce
            magasin ; celle-ci sert à repérer une caisse oubliée ouverte, et
            c'est le seul moyen de la clôturer si son titulaire n'est plus là. */}
        {canViewHistory && otherOpenSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Unlock className="h-5 w-5 text-amber-600" />Autres caisses ouvertes</CardTitle>
            <CardDescription>Sessions ouvertes par d&apos;autres utilisateurs sur ce magasin</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {otherOpenSessions.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-900">{s.openedByName || 'Utilisateur'}</p>
                  <p className="text-xs text-gray-500">Ouverte {formatDateTime(s.openedAt)} · Fond initial {formatCurrency(s.openingBalance)}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setJournalTarget(s)}>
                    <Receipt className="h-3.5 w-3.5 mr-1.5" />Journal
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setCloseTarget(s); setTargetCountedAmount(''); setTargetCloseError(null); setTargetCloseResult(null); }}>
                    <Lock className="h-3.5 w-3.5 mr-1.5" />Clôturer
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        )}

        {canViewHistory && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-gray-600" />Historique des sessions</CardTitle>
              <CardDescription>Les 10 dernières fermetures de caisse</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={sessionHistory.length === 0}
              onClick={() => exportToCsv(
                `clotures-caisse-${new Date().toISOString().slice(0, 10)}`,
                sessionHistory,
                [
                  { key: 'id', label: 'N° session' },
                  { key: 'openedByName', label: 'Ouvert par' },
                  { key: 'openedAt', label: 'Ouverture', format: (v) => v ? formatDateTime(v as Date) : '' },
                  { key: 'closedAt', label: 'Fermeture', format: (v) => v ? formatDateTime(v as Date) : '' },
                  { key: 'openingBalance', label: 'Fond initial' },
                  { key: 'expectedBalance', label: 'Attendu' },
                  { key: 'closingBalance', label: 'Compté' },
                  { key: 'difference', label: 'Écart' },
                  { key: 'notes', label: 'Notes' },
                ]
              )}
            >
              <Download className="h-4 w-4 mr-2" />
              Exporter CSV
            </Button>
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
                    <TableHead>Ouvert par</TableHead>
                    <TableHead>Ouverture</TableHead>
                    <TableHead>Fermeture</TableHead>
                    <TableHead className="text-right">Fond initial</TableHead>
                    <TableHead className="text-right">Attendu</TableHead>
                    <TableHead className="text-right">Compté</TableHead>
                    <TableHead className="text-right">Écart</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessionHistory.map(data => {
                    const diff = data.difference || 0;
                    return (
                      <TableRow key={data.id}>
                        <TableCell className="text-sm text-gray-700">{data.openedByName || '—'}</TableCell>
                        <TableCell className="text-sm text-gray-500">{formatDateTime(data.openedAt)}</TableCell>
                        <TableCell className="text-sm text-gray-500">{data.closedAt ? formatDateTime(data.closedAt) : '—'}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(data.openingBalance)}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(data.expectedBalance || 0)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatCurrency(data.closingBalance || 0)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm font-bold ${diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                            {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Voir le journal" onClick={() => setJournalTarget(data)}>
                            <Receipt className="h-4 w-4 text-gray-400" />
                          </Button>
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
              {/* Détail du calcul : un caissier à qui l'on reproche un écart
                  doit pouvoir vérifier d'où vient le montant attendu. Un
                  chiffre sans justification n'est pas contrôlable. */}
              <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
                <li>Fond de caisse : {formatCurrency(session?.openingBalance || 0)}</li>
                <li>Ventes en espèces : {formatCurrency(cashTotal)}</li>
                {acompteTotal > 0 && (
                  <li>Acomptes sur crédit : {formatCurrency(acompteTotal)}</li>
                )}
                {creditRepaymentTotal > 0 && (
                  <li>Règlements de dettes : {formatCurrency(creditRepaymentTotal)}</li>
                )}
                {cashRefundTotal > 0 && (
                  <li className="text-red-600">
                    Remboursements rendus : −{formatCurrency(cashRefundTotal)}
                  </li>
                )}
              </ul>
            </div>
            {Object.keys(nonCashByMethod).length > 0 && (
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs font-medium text-gray-700 mb-1">
                  Encaissé hors caisse — ne pas compter
                </p>
                <ul className="space-y-0.5 text-xs text-gray-500">
                  {Object.entries(nonCashByMethod).map(([m, v]) => (
                    <li key={m} className="flex justify-between gap-3">
                      <span>{NON_CASH_LABELS[m] || m}</span>
                      <span className="font-medium text-gray-700">{formatCurrency(v)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-gray-400">
                  Ces montants ne sont pas dans le tiroir : comptez uniquement
                  les espèces présentes.
                </p>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 p-3 flex justify-between text-xs">
              <span className="text-gray-500">Transactions de la session</span>
              <span className="font-medium text-gray-700">{txCount}</span>
            </div>

            <div className="space-y-2">
              <Label>Montant compté en caisse *</Label>
              <p className="text-xs text-gray-500">
                Comptez les billets et pièces réellement présents dans le tiroir.
              </p>
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

      {/* Dialog fermeture de la caisse d'un collègue (Manager+, migration 047).
          Pas d'aperçu du solde attendu en direct ici : contrairement à MA
          propre caisse, je n'ai pas les ventes de ce collègue chargées
          côté client — le serveur calcule le vrai solde attendu et
          l'affiche APRÈS validation, jamais avant. */}
      <Dialog open={!!closeTarget} onOpenChange={o => { if (!o) setCloseTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Clôturer la caisse — {closeTarget?.openedByName || 'Utilisateur'}</DialogTitle></DialogHeader>
          {targetCloseResult ? (
            <div className="space-y-4 py-2">
              <div className={`rounded-lg p-3 text-center ${targetCloseResult.difference === 0 ? 'bg-green-50' : targetCloseResult.difference > 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
                <p className="text-xs text-gray-500 mb-1">Solde attendu (calculé côté serveur)</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(targetCloseResult.expectedBalance)}</p>
                <p className="text-xs text-gray-500 mt-2 mb-1">Écart</p>
                <p className={`text-lg font-bold ${targetCloseResult.difference === 0 ? 'text-green-700' : targetCloseResult.difference > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  {targetCloseResult.difference > 0 ? '+' : ''}{formatCurrency(targetCloseResult.difference)}
                </p>
              </div>
              <Button className="w-full" onClick={() => setCloseTarget(null)}>Fermer</Button>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Montant compté en caisse *</Label>
                  <p className="text-xs text-gray-500">
                    Comptez les billets et pièces réellement présents dans ce tiroir.
                  </p>
                  <Input type="number" min="0" placeholder="0" value={targetCountedAmount}
                    onChange={e => setTargetCountedAmount(e.target.value)} className="text-lg font-bold" autoFocus />
                </div>
                {targetCloseError && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />{targetCloseError}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCloseTarget(null)}>Annuler</Button>
                <Button onClick={handleCloseOther} disabled={isSaving || !targetCountedAmount} className="bg-red-600 hover:bg-red-700">
                  {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Fermeture...</> : <><Lock className="h-4 w-4 mr-2" />Confirmer la fermeture</>}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {journalTarget && tenantId && storeId && (
        <SessionJournalDialog
          tenantId={tenantId}
          storeId={storeId}
          session={journalTarget}
          onOpenChange={(o) => { if (!o) setJournalTarget(null); }}
        />
      )}

      {showStoreJournal && tenantId && storeId && (
        <StoreJournalDialog
          tenantId={tenantId}
          storeId={storeId}
          storeName={currentStore?.name || 'Magasin'}
          onOpenChange={(o) => { if (!o) setShowStoreJournal(false); }}
        />
      )}
    </DashboardLayout>
  );
}
