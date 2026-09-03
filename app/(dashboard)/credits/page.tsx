'use client';

import { useState, useEffect } from 'react';
import {
  CreditCard, Search, X, Plus, RefreshCw,
  AlertTriangle, Clock, CheckCircle2, ChevronRight,
  User, Calendar, TrendingDown, Banknote, MessageCircle, Ban,
  ShieldAlert, ThumbsUp, ThumbsDown, History
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { mapCredit, mapCreditPayment, mapAuditLog } from '@/lib/supabase/mappers';
import { ROLE_PERMISSIONS } from '@/lib/constants';
import { canManageCustomerRecord, isOwnerOrAdmin } from '@/lib/auth/roles';
import type { Credit, CreditPayment, CreditStatus, AuditLogEntry } from '@/lib/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  PENDING:        { label: 'En cours',      color: 'bg-amber-100 text-amber-700',  icon: Clock },
  PARTIALLY_PAID: { label: 'Partiel',       color: 'bg-blue-100 text-blue-700',    icon: TrendingDown },
  PAID:           { label: 'Soldé',         color: 'bg-green-100 text-green-700',  icon: CheckCircle2 },
  OVERDUE:        { label: 'En retard',     color: 'bg-red-100 text-red-700',      icon: AlertTriangle },
  WRITTEN_OFF:    { label: 'Annulé',        color: 'bg-gray-100 text-gray-600',    icon: Ban },
};

// Piste d'audit (migration 045) — libellés lisibles pour les actions
// enregistrées par les RPC de gouvernance.
const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREDIT_WRITE_OFF_REQUESTED: "Demande d'annulation soumise",
  CREDIT_WRITTEN_OFF: 'Crédit annulé',
  CREDIT_WRITE_OFF_APPROVED: "Demande d'annulation validée",
  CREDIT_WRITE_OFF_REJECTED: "Demande d'annulation refusée",
  CREDIT_LIMIT_CHANGED: 'Limite de crédit modifiée',
};

function isEcheanceProche(dueDate: Date): boolean {
  const diff = dueDate.getTime() - Date.now();
  return diff > 0 && diff < 48 * 60 * 60 * 1000;
}

function isEnRetard(dueDate: Date, status: string): boolean {
  if (status === 'PAID') return false;
  return dueDate.getTime() < Date.now();
}

// Relance "semi-automatique" : Kafora repère le crédit en retard et prépare
// le message, mais c'est le commerçant qui clique pour l'envoyer via son
// propre WhatsApp — aucune API SMS/WhatsApp payante n'est intégrée (voir
// docs/enterprise-pricing-guide.md pour le contexte de cette décision).
// Retourne null si aucun téléphone n'est enregistré pour ce client.
function buildWhatsAppReminderLink(credit: Credit, tenantName: string): string | null {
  if (!credit.customerPhone) return null;

  // Numéros maliens : 8 chiffres locaux, indicatif 223. On accepte la saisie
  // telle quelle (espaces, tirets, +, 00) et on la ramène à un format
  // international sans "+" ni espaces, celui attendu par wa.me.
  let digits = credit.customerPhone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits.startsWith('223') && digits.length === 8) digits = `223${digits}`;
  if (digits.length < 10) return null; // trop court pour être un numéro exploitable

  const firstName = (credit.customerName || 'cher client').split(' ')[0];
  const message =
    `Bonjour ${firstName}, un rappel amical : vous avez un solde de ` +
    `${formatCurrency(credit.remainingAmount)} en cours chez ${tenantName}, ` +
    `échéance le ${formatDate(credit.dueDate)}. Merci de votre confiance !`;

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CreditsPage() {
  const { tenant, user, currentStore } = useAuthStore();
  const [relanceError, setRelanceError] = useState<string | null>(null);
  const tenantId = tenant?.id;
  const canManageCredits = user?.role
    ? Boolean(ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS]?.canManageCredits)
    : false;

  const [credits, setCredits] = useState<Credit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [selected, setSelected] = useState<Credit | null>(null);
  const [versements, setVersements] = useState<CreditPayment[]>([]);

  // Formulaire versement
  const [montantVersement, setMontantVersement] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [versementError, setVersementError] = useState<string | null>(null);

  // Annulation de crédit (modèle "agence bancaire", migration 044) —
  // réservée au magasin d'inscription du client. registeredStoreId n'est
  // pas dénormalisé sur credits (pas de raison de retoucher pos_checkout
  // une 3e fois cette session pour un champ qui ne sert qu'à l'affichage
  // d'un bouton) : résolu par une petite requête séparée à la sélection.
  const [selectedCustomerStoreId, setSelectedCustomerStoreId] = useState<string | null | undefined>(undefined);
  const [showWriteOff, setShowWriteOff] = useState(false);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [isWritingOff, setIsWritingOff] = useState(false);
  const [writeOffError, setWriteOffError] = useState<string | null>(null);

  // Gouvernance (migration 045) : seuil, double validation siège, refus
  // motivé, piste d'audit affichée pour le crédit sélectionné.
  const canApprove = isOwnerOrAdmin(user?.role);
  const [rejectTarget, setRejectTarget] = useState<Credit | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [processingCreditId, setProcessingCreditId] = useState<string | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditLogEntry[]>([]);

  // ─── Listeners ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'credits',
      () => supabase.from('credits').select('*').eq('tenant_id', tenantId).order('due_date', { ascending: true }),
      rows => {
        // Marquer automatiquement en retard côté client
        const updated = rows.map(r => mapCredit(r)).map(c => ({
          ...c,
          status: (c.status !== 'PAID' && isEnRetard(c.dueDate, c.status)
            ? 'OVERDUE'
            : c.status) as CreditStatus,
        }));
        setCredits(updated);
        setIsLoading(false);
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId]);

  // Charger les versements du crédit sélectionné
  useEffect(() => {
    if (!tenantId || !selected) { setVersements([]); return; }
    return watch(
      'credit_payments',
      () => supabase.from('credit_payments').select('*').eq('credit_id', selected.id).order('created_at', { ascending: true }),
      rows => setVersements(rows.map(mapCreditPayment)),
      undefined,
      `credit_id=eq.${selected.id}`
    );
  }, [tenantId, selected?.id]);

  // Résout le magasin d'inscription du client, uniquement pour décider si
  // le bouton "Annuler ce crédit" doit s'afficher — undefined = pas encore
  // chargé (bouton masqué par prudence le temps du fetch).
  useEffect(() => {
    setSelectedCustomerStoreId(undefined);
    if (!selected?.customerId) { setSelectedCustomerStoreId(null); return; }
    let cancelled = false;
    supabase.from('customers').select('registered_store_id').eq('id', selected.customerId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setSelectedCustomerStoreId(data?.registered_store_id ?? null); });
    return () => { cancelled = true; };
  }, [selected?.customerId]);

  // Piste d'audit du crédit sélectionné (migration 045) — lecture seule,
  // alimentée uniquement par les RPC de gouvernance (jamais par le client).
  useEffect(() => {
    if (!selected?.id) { setAuditTrail([]); return; }
    return watch(
      'audit_log',
      () => supabase.from('audit_log').select('*').eq('entity_type', 'credit').eq('entity_id', selected.id).order('created_at', { ascending: false }),
      rows => setAuditTrail(rows.map(mapAuditLog)),
      undefined,
      `entity_id=eq.${selected.id}`
    );
  }, [selected?.id]);

  // ─── Filtres ────────────────────────────────────────────────────────────────

  const filtered = credits.filter(c => {
    const matchSearch = !search ||
      (c.customerName || '').toLowerCase().includes(search.toLowerCase()) ||
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
    .reduce((s, c) => s + c.remainingAmount, 0);
  const nbActifs = credits.filter(c => ['PENDING', 'PARTIALLY_PAID'].includes(c.status)).length;
  const nbEnRetard = credits.filter(c => c.status === 'OVERDUE').length;
  const echeancesProches = credits.filter(
    c => ['PENDING', 'PARTIALLY_PAID'].includes(c.status) && isEcheanceProche(c.dueDate)
  );

  // ─── Versement ──────────────────────────────────────────────────────────────

  const handleVersement = async () => {
    if (!tenantId || !selected || !user || !currentStore) return;
    if (!canManageCredits) {
      setVersementError('Vous n\'avez pas la permission d\'enregistrer un versement de crédit.');
      return;
    }
    const montant = Number(montantVersement);
    if (!montant || montant <= 0) {
      setVersementError('Montant invalide'); return;
    }
    if (montant > selected.remainingAmount) {
      setVersementError(`Montant supérieur au solde restant (${formatCurrency(selected.remainingAmount)})`); return;
    }

    setIsSaving(true);
    setVersementError(null);

    try {
      // Toute l'atomicité (versement + solde crédit + créditUsed client) vit
      // dans repay_credit() en RPC — voir supabase/migrations. Remplace la
      // transaction client Firestore (runTransaction) : PostgREST n'offre pas
      // d'équivalent multi-requêtes atomique depuis le navigateur.
      const { data, error } = await supabase.rpc('repay_credit', {
        p_credit_id: selected.id,
        p_amount: montant,
        p_store_id: currentStore.id,
        p_user_name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      });
      if (error) throw error;
      const result = data as unknown as { remainingAmount: number; status: CreditStatus };

      setMontantVersement('');
      setSelected(prev => prev ? { ...prev, remainingAmount: result.remainingAmount, status: result.status } : null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement';
      setVersementError(msg.replace(/^.*(?:FORBIDDEN|INVALID_AMOUNT|NOT_FOUND):\s*/, ''));
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Relance WhatsApp ───────────────────────────────────────────────────────

  const handleRelance = async (credit: Credit) => {
    setRelanceError(null);
    const link = buildWhatsAppReminderLink(credit, tenant?.name || 'Kafora');
    if (!link) {
      setRelanceError('Aucun téléphone exploitable pour ce client.');
      return;
    }
    // On ouvre d'abord WhatsApp : même si l'enregistrement de l'horodatage
    // échoue ensuite, le commerçant a déjà son message prêt à envoyer.
    window.open(link, '_blank', 'noopener,noreferrer');

    if (!canManageCredits) return; // horodatage réservé aux managers (policy credits_update)
    const now = new Date();
    const { error } = await supabase
      .from('credits')
      .update({ last_reminder_sent_at: now.toISOString() })
      .eq('id', credit.id);
    if (!error) {
      setCredits(prev => prev.map(c => c.id === credit.id ? { ...c, lastReminderSentAt: now } : c));
      setSelected(prev => prev && prev.id === credit.id ? { ...prev, lastReminderSentAt: now } : prev);
    }
  };

  // ─── Annulation de crédit ───────────────────────────────────────────────────

  // Passe par une route API (pas un appel RPC direct) : au-dessus du seuil
  // de gouvernance, le siège doit être notifié (alerte + email), ce qui
  // exige un contexte serveur que write_off_credit() en SQL ne peut pas
  // atteindre seul — voir app/api/credits/write-off/route.ts.
  const handleWriteOff = async () => {
    if (!selected) return;
    if (!writeOffReason.trim()) { setWriteOffError('Le motif est obligatoire.'); return; }
    setIsWritingOff(true);
    setWriteOffError(null);
    try {
      const res = await fetch('/api/credits/write-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditId: selected.id, reason: writeOffReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de l'annulation");

      if (data.status === 'PENDING_APPROVAL') {
        setSelected(prev => prev ? { ...prev, writeOffStatus: 'PENDING', writeOffReason: writeOffReason.trim() } : null);
      } else {
        setSelected(prev => prev ? { ...prev, status: 'WRITTEN_OFF', remainingAmount: 0 } : null);
      }
      setShowWriteOff(false);
      setWriteOffReason('');
    } catch (e) {
      setWriteOffError(e instanceof Error ? e.message : "Erreur lors de l'annulation");
      console.error(e);
    } finally {
      setIsWritingOff(false);
    }
  };

  // ─── Validation / refus par le siège ───────────────────────────────────────

  const handleApprove = async (credit: Credit) => {
    setProcessingCreditId(credit.id);
    setDecisionError(null);
    try {
      const res = await fetch('/api/credits/write-off/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditId: credit.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la validation');
      if (selected?.id === credit.id) {
        setSelected(prev => prev ? { ...prev, status: 'WRITTEN_OFF', writeOffStatus: 'NONE', remainingAmount: 0 } : null);
      }
    } catch (e) {
      setDecisionError(e instanceof Error ? e.message : 'Erreur lors de la validation');
    } finally {
      setProcessingCreditId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { setDecisionError('Le motif du refus est obligatoire.'); return; }
    setProcessingCreditId(rejectTarget.id);
    setDecisionError(null);
    try {
      const res = await fetch('/api/credits/write-off/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditId: rejectTarget.id, reason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors du refus');
      if (selected?.id === rejectTarget.id) {
        setSelected(prev => prev ? { ...prev, writeOffStatus: 'REJECTED', writeOffRejectedReason: rejectReason.trim() } : null);
      }
      setRejectTarget(null);
      setRejectReason('');
    } catch (e) {
      setDecisionError(e instanceof Error ? e.message : 'Erreur lors du refus');
    } finally {
      setProcessingCreditId(null);
    }
  };

  const pendingWriteOffs = credits.filter(c => c.writeOffStatus === 'PENDING');

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
              { key: 'totalAmount', label: 'Montant total' },
              { key: 'paidAmount', label: 'Total versé' },
              { key: 'remainingAmount', label: 'Solde restant' },
              { key: 'status', label: 'Statut', format: (v) => STATUS_CONFIG[v as keyof typeof STATUS_CONFIG]?.label || String(v) },
              { key: 'dueDate', label: 'Échéance', format: (v) => v ? formatDate(v as Date) : '' },
              { key: 'createdAt', label: 'Date création', format: (v) => formatDateForCsv(v) },
            ])}
          >
            <Download className="h-4 w-4 mr-2" />
            Exporter CSV
          </Button>
        </div>

        {/* Demandes d'annulation en attente — siège uniquement (gouvernance,
            migration 045). Un Responsable ne voit jamais ce bloc : il n'a
            pas le pouvoir de trancher, même pour sa propre demande. */}
        {canApprove && pendingWriteOffs.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">
                  {pendingWriteOffs.length} demande{pendingWriteOffs.length > 1 ? 's' : ''} d&apos;annulation en attente de votre validation
                </p>
                <p className="text-xs text-red-700 mt-1">
                  Au-dessus du seuil de {formatCurrency(tenant?.writeOffApprovalThreshold || 0)} — une décision du siège est requise.
                </p>
              </div>
            </div>
            {decisionError && (
              <div className="bg-white border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{decisionError}</div>
            )}
            <div className="space-y-2">
              {pendingWriteOffs.map(c => (
                <div key={c.id} className="bg-white rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.customerName || 'Client supprimé'}</p>
                    <p className="text-xs text-gray-500">
                      {formatCurrency(c.remainingAmount)} · demandé par {c.writeOffRequestedByName || '—'} le {c.writeOffRequestedAt ? formatDate(c.writeOffRequestedAt) : '—'}
                    </p>
                    <p className="text-xs text-gray-400 italic truncate">« {c.writeOffReason} »</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      size="sm" variant="outline"
                      disabled={processingCreditId === c.id}
                      onClick={() => { setRejectTarget(c); setRejectReason(''); setDecisionError(null); }}
                      className="border-gray-300 text-gray-600 hover:bg-gray-50"
                    >
                      <ThumbsDown className="h-3.5 w-3.5 mr-1" />Refuser
                    </Button>
                    <Button
                      size="sm"
                      disabled={processingCreditId === c.id}
                      onClick={() => handleApprove(c)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {processingCreditId === c.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <><ThumbsUp className="h-3.5 w-3.5 mr-1" />Valider</>}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alerte échéances proches */}
        {echeancesProches.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                {echeancesProches.length} crédit{echeancesProches.length > 1 ? 's arrivent' : ' arrive'} à échéance dans moins de 48h
              </p>
              <p className="text-xs text-amber-700 mt-1">
                {echeancesProches.map(c => `${c.customerName || 'Client supprimé'} (${formatCurrency(c.remainingAmount)})`).join(' · ')}
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
                    const proche = isEcheanceProche(c.dueDate) && ['PENDING', 'PARTIALLY_PAID'].includes(c.status);
                    const pct = c.totalAmount > 0 ? ((c.totalAmount - c.remainingAmount) / c.totalAmount) * 100 : 0;
                    return (
                      <TableRow key={c.id}
                        className={`hover:bg-gray-50 cursor-pointer ${selected?.id === c.id ? 'bg-primary-50' : ''}`}
                        onClick={() => { setSelected(c); setMontantVersement(''); setVersementError(null); setRelanceError(null); }}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                              {(c.customerName || '?')[0]}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{c.customerName || 'Client supprimé'}</p>
                              {c.customerPhone && <p className="text-xs text-gray-400">{c.customerPhone}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(c.totalAmount)}</TableCell>
                        <TableCell className="text-right">
                          <p className={`font-bold text-sm ${c.status === 'PAID' ? 'text-green-600' : 'text-amber-600'}`}>
                            {formatCurrency(c.remainingAmount)}
                          </p>
                          <div className="w-16 h-1 bg-gray-200 rounded-full mt-1 ml-auto">
                            <div className="h-1 bg-green-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`text-sm ${proche ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                            {formatDate(c.dueDate)}{proche && ' ⚠️'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={c.status} />
                            {c.writeOffStatus === 'PENDING' && (
                              <span title="Demande d'annulation en attente de validation du siège">
                                <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 justify-end">
                            {(proche || c.status === 'OVERDUE') && (
                              <button
                                title={c.customerPhone ? 'Relancer par WhatsApp' : 'Aucun téléphone enregistré'}
                                disabled={!c.customerPhone}
                                onClick={(e) => { e.stopPropagation(); handleRelance(c); }}
                                className="text-green-600 hover:text-green-700 disabled:text-gray-300 disabled:cursor-not-allowed"
                              >
                                <MessageCircle className="h-4 w-4" />
                              </button>
                            )}
                            <ChevronRight className="h-4 w-4 text-gray-400" />
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
                    {(selected.customerName || '?')[0]}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">{selected.customerName || 'Client supprimé'}</p>
                    {selected.customerPhone && <p className="text-sm text-gray-400">{selected.customerPhone}</p>}
                  </div>
                  {['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(selected.status) && (
                    <div className="text-right">
                      <Button
                        variant="outline" size="sm"
                        disabled={!selected.customerPhone}
                        onClick={() => handleRelance(selected)}
                        className="border-green-300 text-green-700 hover:bg-green-50"
                      >
                        <MessageCircle className="h-4 w-4 mr-1.5" />
                        Relancer
                      </Button>
                      {selected.lastReminderSentAt && (
                        <p className="text-xs text-gray-400 mt-1">
                          Relancé le {formatDateTime(selected.lastReminderSentAt)}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {relanceError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 mb-4">
                    {relanceError}
                  </div>
                )}

                {/* Infos montants */}
                <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs mb-1">Montant initial</p>
                    <p className="font-bold">{formatCurrency(selected.totalAmount)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-500 text-xs mb-1">Total versé</p>
                    <p className="font-bold">{formatCurrency(selected.paidAmount)}</p>
                  </div>
                </div>

                {/* Solde en grand */}
                <div className={`rounded-xl p-4 text-center mb-5 ${selected.status === 'PAID' ? 'bg-green-50 border border-green-200' : selected.status === 'OVERDUE' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                  <p className="text-xs text-gray-500 mb-1">Solde restant</p>
                  <p className={`text-3xl font-bold ${selected.status === 'PAID' ? 'text-green-700' : selected.status === 'OVERDUE' ? 'text-red-700' : 'text-amber-700'}`}>
                    {formatCurrency(selected.remainingAmount)}
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <StatusBadge status={selected.status} />
                    <span className="text-xs text-gray-500">· Échéance : {formatDate(selected.dueDate)}</span>
                  </div>
                  {/* Barre de progression remboursement */}
                  {selected.totalAmount > 0 && (
                    <div className="mt-3">
                      <div className="w-full h-2 bg-gray-200 rounded-full">
                        <div className="h-2 bg-green-500 rounded-full transition-all"
                          style={{ width: `${Math.min(((selected.totalAmount - selected.remainingAmount) / selected.totalAmount) * 100, 100)}%` }} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {Math.round(((selected.totalAmount - selected.remainingAmount) / selected.totalAmount) * 100)}% remboursé
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
                            type="number" min="1" max={selected.remainingAmount}
                            placeholder={`Max ${formatCurrency(selected.remainingAmount)}`}
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
                        {montantVersement && Number(montantVersement) > 0 && Number(montantVersement) <= selected.remainingAmount && (
                          <p className="text-xs text-gray-500 mt-2">
                            Solde après versement : <strong>{formatCurrency(selected.remainingAmount - Number(montantVersement))}</strong>
                            {Number(montantVersement) >= selected.remainingAmount && ' → Crédit soldé ✅'}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Annulation — réservée au magasin d'inscription du client
                    (modèle "agence bancaire", migration 044), pas au magasin
                    où la vente a eu lieu : c'est une décision sur la
                    relation client, pas une transaction. Au-dessus du
                    seuil de gouvernance, la demande passe par le siège
                    (migration 045) — voir le bloc de validation en haut de
                    page. */}
                {!['PAID', 'WRITTEN_OFF', 'CANCELLED'].includes(selected.status) &&
                  canManageCustomerRecord(user?.storeIds, selectedCustomerStoreId) && (
                  <div className="mb-5 pt-4 border-t">
                    {selected.writeOffStatus === 'PENDING' ? (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800 flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                        Demande d&apos;annulation envoyée le {selected.writeOffRequestedAt ? formatDateTime(selected.writeOffRequestedAt) : ''} — en attente de validation du siège.
                      </div>
                    ) : (
                      <>
                        {selected.writeOffStatus === 'REJECTED' && (
                          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 mb-2">
                            Demande précédente refusée : {selected.writeOffRejectedReason}
                          </div>
                        )}
                        <Button
                          variant="outline" size="sm"
                          onClick={() => { setShowWriteOff(true); setWriteOffReason(''); setWriteOffError(null); }}
                          className="border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-red-600 hover:border-red-200"
                        >
                          <Ban className="h-4 w-4 mr-1.5" />Annuler ce crédit
                        </Button>
                        <p className="text-xs text-gray-400 mt-1.5">
                          Passe ce crédit en perte — action réservée au magasin d&apos;inscription du client.
                          {tenant?.writeOffApprovalThreshold != null && (
                            <> Au-dessus de {formatCurrency(tenant.writeOffApprovalThreshold)}, une validation du siège sera demandée.</>
                          )}
                        </p>
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
                            <p className="text-sm font-bold text-green-700">+{formatCurrency(v.amount)}</p>
                            <p className="text-xs text-gray-400">{formatDateTime(v.createdAt)} · {v.userName}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Solde après</p>
                            <p className="text-sm font-medium">{v.remainingAfter !== null ? formatCurrency(v.remainingAfter) : '—'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Piste d'audit — visible aux managers+ (policy audit_log_select),
                    jamais modifiable depuis le client (migration 045). */}
                {auditTrail.length > 0 && (
                  <div className="mt-5 pt-4 border-t">
                    <p className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                      <History className="h-4 w-4" />Journal d&apos;audit
                    </p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {auditTrail.map(entry => (
                        <div key={entry.id} className="bg-gray-50 rounded-lg px-3 py-2 text-xs">
                          <p className="font-medium text-gray-700">{AUDIT_ACTION_LABELS[entry.action] || entry.action}</p>
                          <p className="text-gray-400">{formatDateTime(entry.createdAt)} · {entry.actorName || '—'} ({entry.actorRole || '—'})</p>
                          {typeof entry.details?.reason === 'string' && entry.details.reason && (
                            <p className="text-gray-500 italic mt-0.5">« {entry.details.reason as string} »</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Refus d'une demande d'annulation — motif obligatoire, siège uniquement */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Refuser l&apos;annulation — {rejectTarget?.customerName || 'Client supprimé'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {decisionError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{decisionError}</div>
            )}
            <div className="space-y-2">
              <Label>Motif du refus *</Label>
              <Textarea
                rows={3}
                placeholder="ex: Client toujours joignable, relance à retenter d'abord..."
                value={rejectReason}
                onChange={e => { setRejectReason(e.target.value); setDecisionError(null); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={processingCreditId === rejectTarget?.id}>Annuler</Button>
            <Button onClick={handleReject} disabled={processingCreditId === rejectTarget?.id || !rejectReason.trim()} className="bg-gray-700 hover:bg-gray-800">
              {processingCreditId === rejectTarget?.id ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Traitement...</> : 'Confirmer le refus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showWriteOff} onOpenChange={(o) => { if (!o) setShowWriteOff(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Annuler ce crédit — {selected?.customerName || 'Client supprimé'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
              Solde de <strong>{selected ? formatCurrency(selected.remainingAmount) : ''}</strong> passé en perte —
              il ne sera plus réclamé et n&apos;apparaîtra plus dans les montants dus.
            </div>
            {selected && tenant && selected.remainingAmount > tenant.writeOffApprovalThreshold && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-700 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                Au-dessus du seuil de {formatCurrency(tenant.writeOffApprovalThreshold)} : ceci créera une demande, effective seulement après validation du siège.
              </div>
            )}
            {writeOffError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{writeOffError}</div>
            )}
            <div className="space-y-2">
              <Label>Motif *</Label>
              <Textarea
                rows={3}
                placeholder="ex: Client introuvable, créance jugée irrécouvrable..."
                value={writeOffReason}
                onChange={e => { setWriteOffReason(e.target.value); setWriteOffError(null); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWriteOff(false)} disabled={isWritingOff}>Annuler</Button>
            <Button onClick={handleWriteOff} disabled={isWritingOff || !writeOffReason.trim()} className="bg-red-600 hover:bg-red-700">
              {isWritingOff ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Traitement...</> : 'Confirmer l\'annulation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
