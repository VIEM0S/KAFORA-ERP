'use client';

import { useState, useEffect } from 'react';
import {
  CreditCard, Search, X, Plus, RefreshCw,
  AlertTriangle, Clock, CheckCircle2, ChevronRight,
  User, Calendar, TrendingDown, Banknote
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils/helpers';
import { exportToCsv, formatDateForCsv } from '@/lib/utils/export';
import { Download } from 'lucide-react';
import { useAuthStore } from '@/hooks/store';
import { collection, query, orderBy, doc, serverTimestamp, runTransaction } from 'firebase/firestore';
// onSnapshot vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/firebase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { onSnapshot } from '@/lib/firebase/watch';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { ROLE_PERMISSIONS } from '@/lib/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Versement {
  id: string;
  creditId: string;
  montant: number;
  soldeAvant: number;
  soldeApres: number;
  userId: string;
  userName: string;
  createdAt: unknown;
}

interface Credit {
  id: string;
  tenantId: string;
  saleId: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  montantTotal: number;
  acompte: number;
  solde: number;
  dateEcheance: string;
  status: 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';
  userId: string;
  versements?: Versement[];
  createdAt: unknown;
  updatedAt: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  PENDING:        { label: 'En cours',      color: 'bg-amber-100 text-amber-700',  icon: Clock },
  PARTIALLY_PAID: { label: 'Partiel',       color: 'bg-blue-100 text-blue-700',    icon: TrendingDown },
  PAID:           { label: 'Soldé',         color: 'bg-green-100 text-green-700',  icon: CheckCircle2 },
  OVERDUE:        { label: 'En retard',     color: 'bg-red-100 text-red-700',      icon: AlertTriangle },
};

function isEcheanceProche(dateStr: string): boolean {
  if (!dateStr) return false;
  const echeance = new Date(dateStr);
  const now = new Date();
  const diff = echeance.getTime() - now.getTime();
  return diff > 0 && diff < 48 * 60 * 60 * 1000;
}

function isEnRetard(dateStr: string, status: string): boolean {
  if (status === 'PAID') return false;
  return new Date(dateStr) < new Date();
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CreditsPage() {
  const { tenant, user, currentStore } = useAuthStore();
  const tenantId = tenant?.id;
  const canManageCredits = user?.role
    ? Boolean(ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS]?.canManageCredits)
    : false;

  const [credits, setCredits] = useState<Credit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [selected, setSelected] = useState<Credit | null>(null);
  const [versements, setVersements] = useState<Versement[]>([]);

  // Formulaire versement
  const [montantVersement, setMontantVersement] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [versementError, setVersementError] = useState<string | null>(null);

  // ─── Listeners ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tenantId) return;
    const q = query(
      collection(db, tenantCol(tenantId, 'credits')),
      orderBy('dateEcheance', 'asc')
    );
    return onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Credit[];
      // Marquer automatiquement en retard côté client
      const updated = data.map(c => ({
        ...c,
        status: c.status !== 'PAID' && isEnRetard(c.dateEcheance, c.status)
          ? 'OVERDUE' as const
          : c.status,
      }));
      setCredits(updated);
      setIsLoading(false);
    });
  }, [tenantId]);

  // Charger les versements du crédit sélectionné
  useEffect(() => {
    if (!tenantId || !selected) { setVersements([]); return; }
    const q = query(
      collection(db, `tenants/${tenantId}/credits/${selected.id}/credit_payments`),
      orderBy('createdAt', 'asc')
    );
    return onSnapshot(q, (snap) => {
      setVersements(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Versement[]);
    });
  }, [tenantId, selected?.id]);

  // ─── Filtres ────────────────────────────────────────────────────────────────

  const filtered = credits.filter(c => {
    const matchSearch = !search ||
      c.customerName.toLowerCase().includes(search.toLowerCase()) ||
      (c.customerPhone || '').includes(search);
    const matchStatus =
      filterStatus === 'all' ||
      (filterStatus === 'active' && ['PENDING', 'PARTIALLY_PAID'].includes(c.status)) ||
      (filterStatus === 'overdue' && c.status === 'OVERDUE') ||
      (filterStatus === 'paid' && c.status === 'PAID');
    return matchSearch && matchStatus;
  });

  // ─── Stats ──────────────────────────────────────────────────────────────────

  const totalEnCours = credits
    .filter(c => ['PENDING', 'PARTIALLY_PAID'].includes(c.status))
    .reduce((s, c) => s + c.solde, 0);
  const nbActifs = credits.filter(c => ['PENDING', 'PARTIALLY_PAID'].includes(c.status)).length;
  const nbEnRetard = credits.filter(c => c.status === 'OVERDUE').length;
  const echeancesProches = credits.filter(
    c => ['PENDING', 'PARTIALLY_PAID'].includes(c.status) && isEcheanceProche(c.dateEcheance)
  );

  // ─── Versement ──────────────────────────────────────────────────────────────

  const handleVersement = async () => {
    if (!tenantId || !selected || !user) return;
    if (!canManageCredits) {
      setVersementError('Vous n\'avez pas la permission d\'enregistrer un versement de crédit.');
      return;
    }
    const montant = Number(montantVersement);
    if (!montant || montant <= 0) {
      setVersementError('Montant invalide'); return;
    }
    if (montant > selected.solde) {
      setVersementError(`Montant supérieur au solde restant (${formatCurrency(selected.solde)})`); return;
    }

    setIsSaving(true);
    setVersementError(null);

    const creditRef = doc(db, tenantCol(tenantId, 'credits'), selected.id);
    const paymentRef = doc(collection(db, `tenants/${tenantId}/credits/${selected.id}/credit_payments`));

    try {
      // Fix : les 3 écritures (versement, crédit, client) se faisaient auparavant
      // en 3 appels séparés non-atomiques, avec un solde calculé côté client sur
      // une valeur potentiellement périmée (`selected.solde`). Deux versements
      // presque simultanés (double onglet, deux appareils) pouvaient s'écraser
      // l'un l'autre. On relit tout DANS la transaction et on écrit ensemble.
      const result = await runTransaction(db, async (tx) => {
        const creditSnap = await tx.get(creditRef);
        if (!creditSnap.exists()) throw new Error('Crédit introuvable');
        const creditData = creditSnap.data() as Credit;

        const soldeAvant = creditData.solde;
        if (montant > soldeAvant) {
          throw new Error(`Montant supérieur au solde restant (${formatCurrency(soldeAvant)})`);
        }
        const soldeApres = Math.max(0, soldeAvant - montant);
        const nouveauStatut = soldeApres === 0 ? 'PAID'
          : soldeApres < creditData.montantTotal ? 'PARTIALLY_PAID'
          : creditData.status;

        let customerRef: ReturnType<typeof doc> | null = null;
        let currentUsed = 0;
        if (creditData.customerId) {
          customerRef = doc(db, tenantCol(tenantId, 'customers'), creditData.customerId);
          const customerSnap = await tx.get(customerRef);
          if (customerSnap.exists()) {
            currentUsed = Number(customerSnap.data().creditUsed) || 0;
          } else {
            customerRef = null;
          }
        }

        tx.set(paymentRef, {
          creditId: selected.id,
          montant,
          soldeAvant,
          soldeApres,
          // tenantId / storeId / paymentMethod : indispensables au
          // rapprochement de caisse. Un client qui vient régler sa dette
          // dépose de l'argent dans un TIROIR PRÉCIS ; sans le magasin, ce
          // versement n'apparaît nulle part à la clôture et la caisse
          // semble excédentaire.
          tenantId,
          storeId: currentStore?.id || null,
          paymentMethod: 'CASH',
          userId: user.id,
          userName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          createdAt: serverTimestamp(),
        });

        tx.update(creditRef, {
          solde: soldeApres,
          status: nouveauStatut,
          updatedAt: serverTimestamp(),
        });

        if (customerRef) {
          tx.update(customerRef, {
            creditUsed: Math.max(0, currentUsed - montant),
            updatedAt: serverTimestamp(),
          });
        }

        return { soldeApres, nouveauStatut };
      });

      setMontantVersement('');
      setSelected(prev => prev ? { ...prev, solde: result.soldeApres, status: result.nouveauStatut } : null);
    } catch (e) {
      setVersementError(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement');
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const StatusBadge = ({ status }: { status: Credit['status'] }) => {
    const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${cfg.color}`}>
        <Icon className="h-3 w-3" />{cfg.label}
      </span>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Crédits clients</h1>
            <p className="text-sm text-gray-500 mt-1">
              {nbActifs} crédit{nbActifs !== 1 ? 's' : ''} actif{nbActifs !== 1 ? 's' : ''}
              {nbEnRetard > 0 && <span className="ml-2 text-red-600 font-medium">· {nbEnRetard} en retard</span>}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={filtered.length === 0}
            onClick={() => exportToCsv(`credits-${new Date().toISOString().slice(0, 10)}`, filtered, [
              { key: 'id', label: 'N° créance' },
              { key: 'customerName', label: 'Client' },
              { key: 'customerPhone', label: 'Téléphone' },
              { key: 'montantTotal', label: 'Montant total' },
              { key: 'acompte', label: 'Acompte versé' },
              { key: 'solde', label: 'Solde restant' },
              { key: 'status', label: 'Statut', format: (v) => STATUS_CONFIG[v as keyof typeof STATUS_CONFIG]?.label || String(v) },
              { key: 'dateEcheance', label: 'Échéance', format: (v) => v ? formatDate(v as string) : '' },
              { key: 'createdAt', label: 'Date création', format: (v) => formatDateForCsv(v) },
            ])}
          >
            <Download className="h-4 w-4 mr-2" />
            Exporter CSV
          </Button>
        </div>

        {/* Alerte échéances proches */}
        {echeancesProches.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                {echeancesProches.length} crédit{echeancesProches.length > 1 ? 's arrivent' : ' arrive'} à échéance dans moins de 48h
              </p>
              <p className="text-xs text-amber-700 mt-1">
                {echeancesProches.map(c => `${c.customerName} (${formatCurrency(c.solde)})`).join(' · ')}
              </p>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total en cours', value: formatCurrency(totalEnCours), icon: CreditCard, color: 'text-amber-600' },
            { label: 'Crédits actifs', value: nbActifs, icon: Clock, color: 'text-blue-600' },
            { label: 'En retard', value: nbEnRetard, icon: AlertTriangle, color: 'text-red-600' },
            { label: 'Échéances < 48h', value: echeancesProches.length, icon: Calendar, color: echeancesProches.length > 0 ? 'text-red-600' : 'text-gray-500' },
          ].map((s, i) => (
            <Card key={i}><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <s.icon className={`h-8 w-8 ${s.color} opacity-80`} />
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="text-xl font-bold text-gray-900">{s.value}</p>
                </div>
              </div>
            </CardContent></Card>
          ))}
        </div>

        {/* Filtres */}
        <Card><CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Rechercher par client ou téléphone..." value={search}
                onChange={e => setSearch(e.target.value)} className="pl-9" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>}
            </div>
            <div className="flex gap-2">
              {[
                { val: 'active', label: 'En cours' },
                { val: 'overdue', label: 'En retard' },
                { val: 'paid', label: 'Soldés' },
                { val: 'all', label: 'Tous' },
              ].map(opt => (
                <Button key={opt.val} variant={filterStatus === opt.val ? 'default' : 'outline'}
                  size="sm" onClick={() => setFilterStatus(opt.val)}
                  className={filterStatus === opt.val ? 'bg-primary-600 hover:bg-primary-700' : ''}>
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent></Card>

        {/* Layout principal */}
        <div className={`gap-6 ${selected ? 'grid grid-cols-1 lg:grid-cols-2' : ''}`}>
          {/* Table crédits */}
          <Card><CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <CreditCard className="h-12 w-12 mb-4 opacity-30" />
                <p className="font-medium">Aucun crédit trouvé</p>
                <p className="text-sm mt-1">Les crédits sont créés depuis le POS lors d&apos;un paiement en crédit</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Solde restant</TableHead>
                    <TableHead>Échéance</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(c => {
                    const proche = isEcheanceProche(c.dateEcheance) && ['PENDING', 'PARTIALLY_PAID'].includes(c.status);
                    const pct = c.montantTotal > 0 ? ((c.montantTotal - c.solde) / c.montantTotal) * 100 : 0;
                    return (
                      <TableRow key={c.id}
                        className={`hover:bg-gray-50 cursor-pointer ${selected?.id === c.id ? 'bg-primary-50' : ''}`}
                        onClick={() => { setSelected(c); setMontantVersement(''); setVersementError(null); }}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                              {c.customerName[0]}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{c.customerName}</p>
                              {c.customerPhone && <p className="text-xs text-gray-400">{c.customerPhone}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(c.montantTotal)}</TableCell>
                        <TableCell className="text-right">
                          <p className={`font-bold text-sm ${c.status === 'PAID' ? 'text-green-600' : 'text-amber-600'}`}>
                            {formatCurrency(c.solde)}
                          </p>
                          <div className="w-16 h-1 bg-gray-200 rounded-full mt-1 ml-auto">
                            <div className="h-1 bg-green-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`text-sm ${proche ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                            {formatDate(c.dateEcheance)}{proche && ' ⚠️'}
                          </span>
                        </TableCell>
                        <TableCell><StatusBadge status={c.status} /></TableCell>
                        <TableCell><ChevronRight className="h-4 w-4 text-gray-400" /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>

          {/* Panneau détail */}
          {selected && (
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold text-gray-900">Détail du crédit</h3>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Client */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center font-bold text-primary-700">
                    {selected.customerName[0]}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">{selected.customerName}</p>
                    {selected.customerPhone && <p className="text-sm text-gray-400">{selected.customerPhone}</p>}
                  </div>
                </div>

                {/* Infos montants */}
                <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs mb-1">Montant initial</p>
                    <p className="font-bold">{formatCurrency(selected.montantTotal)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs mb-1">Acompte versé</p>
                    <p className="font-bold">{formatCurrency(selected.acompte)}</p>
                  </div>
                </div>

                {/* Solde en grand */}
                <div className={`rounded-xl p-4 text-center mb-5 ${selected.status === 'PAID' ? 'bg-green-50 border border-green-200' : selected.status === 'OVERDUE' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                  <p className="text-xs text-gray-500 mb-1">Solde restant</p>
                  <p className={`text-3xl font-bold ${selected.status === 'PAID' ? 'text-green-700' : selected.status === 'OVERDUE' ? 'text-red-700' : 'text-amber-700'}`}>
                    {formatCurrency(selected.solde)}
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <StatusBadge status={selected.status} />
                    <span className="text-xs text-gray-500">· Échéance : {formatDate(selected.dateEcheance)}</span>
                  </div>
                  {/* Barre de progression remboursement */}
                  {selected.montantTotal > 0 && (
                    <div className="mt-3">
                      <div className="w-full h-2 bg-gray-200 rounded-full">
                        <div className="h-2 bg-green-500 rounded-full transition-all"
                          style={{ width: `${Math.min(((selected.montantTotal - selected.solde) / selected.montantTotal) * 100, 100)}%` }} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {Math.round(((selected.montantTotal - selected.solde) / selected.montantTotal) * 100)}% remboursé
                      </p>
                    </div>
                  )}
                </div>

                {/* Formulaire versement */}
                {['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(selected.status) && (
                  <div className="mb-5">
                    <p className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                      <Banknote className="h-4 w-4" />
                      Enregistrer un versement
                    </p>
                    {versementError && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 mb-3">
                        {versementError}
                      </div>
                    )}
                    {!canManageCredits ? (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500">
                        Seuls les managers et responsables peuvent enregistrer un versement de crédit.
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Input
                            type="number" min="1" max={selected.solde}
                            placeholder={`Max ${formatCurrency(selected.solde)}`}
                            value={montantVersement}
                            onChange={e => { setMontantVersement(e.target.value); setVersementError(null); }}
                            className="flex-1"
                          />
                          <Button
                            onClick={handleVersement}
                            disabled={isSaving || !montantVersement}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1" />Valider</>}
                          </Button>
                        </div>
                        {montantVersement && Number(montantVersement) > 0 && Number(montantVersement) <= selected.solde && (
                          <p className="text-xs text-gray-500 mt-2">
                            Solde après versement : <strong>{formatCurrency(selected.solde - Number(montantVersement))}</strong>
                            {Number(montantVersement) >= selected.solde && ' → Crédit soldé ✅'}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Historique versements */}
                <div>
                  <p className="text-sm font-medium text-gray-900 mb-3">Historique des versements</p>
                  {versements.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Aucun versement enregistré</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {versements.map(v => (
                        <div key={v.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                          <div>
                            <p className="text-sm font-bold text-green-700">+{formatCurrency(v.montant)}</p>
                            <p className="text-xs text-gray-400">{formatDateTime(v.createdAt)} · {v.userName}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Solde après</p>
                            <p className="text-sm font-medium">{formatCurrency(v.soldeApres)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
