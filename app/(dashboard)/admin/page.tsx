'use client';

import { useEffect, useState } from 'react';
import { Building2, Loader2, RefreshCw, Wallet, Users, Ban, Check, Megaphone, History as HistoryIcon, MessageSquare, CheckCircle2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils/helpers';
import { useAuthStore } from '@/hooks/store';
import { isSuperAdmin } from '@/lib/auth/roles';

interface PlatformStats {
  tenantCount: number; activeCount: number; suspendedCount: number;
  userCount: number; activeSubscriptions: number; trialCount: number;
  expiringSoon: number; mrrProjected: number; revenueCollectedThisMonth: number;
}

interface TenantRow {
  id: string;
  name: string;
  isActive: boolean;
  suspensionReason: string | null;
  termsAcceptance: { version: string; acceptedAt: string } | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  plan: string | null;
  status: string | null;
  state: 'ACTIVE' | 'GRACE' | 'EXPIRED';
  daysLeft: number | null;
  currentPeriodEnd: string | null;
  userCount: number | null;
  storeCount: number | null;
  saleCount: number | null;
  lastSaleAt: string | null;
}

const STATE_STYLE: Record<TenantRow['state'], string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  GRACE: 'bg-amber-100 text-amber-800',
  EXPIRED: 'bg-red-100 text-red-800',
};
const STATE_LABEL: Record<TenantRow['state'], string> = {
  ACTIVE: 'À jour',
  GRACE: 'Expiré — tolérance',
  EXPIRED: 'Expiré',
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function AdminConsolePage() {
  const { user } = useAuthStore();
  const isAllowed = isSuperAdmin(user?.role);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [suspending, setSuspending] = useState<TenantRow | null>(null);
  const [viewingUsers, setViewingUsers] = useState<TenantRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<TenantRow | null>(null);
  const [tab, setTab] = useState<'clients' | 'support'>('clients');
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<TenantRow | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/tenants');
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
      setTenants(data.tenants || []);
      setStats(data.stats || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setIsLoading(false);
    }
  };

  // Garde côté page, pas seulement côté API : sans ça, n'importe quel
  // utilisateur connecté (n'importe quel tenant, n'importe quel rôle) qui
  // navigue directement vers /admin voyait toute l'interface de la console
  // éditeur (suspendre/prolonger/réinitialiser un mot de passe client) en
  // permanence — les routes /api/admin/* renvoyaient bien 404 sans jamais
  // charger de vraie donnée, mais l'existence et les capacités de cette
  // console restaient visibles à n'importe qui. Le 404 de l'API dit
  // explicitement "ne pas confirmer que cette console existe" ; la page
  // doit refléter la même intention plutôt que juste bloquer les données.
  useEffect(() => { if (isAllowed) load(); }, [isAllowed]);

  if (!isAllowed) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24 text-gray-400">
          <p className="text-sm">Page introuvable</p>
        </div>
      </DashboardLayout>
    );
  }

  /** Action d'administration simple (réactivation), suivie d'un rechargement. */
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
      await load();
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
              <Building2 className="h-6 w-6" /> Clients Kafora
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Triés par urgence : les abonnements les plus proches du blocage en premier.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setBroadcastOpen(true)}>
              <Megaphone className="h-4 w-4 mr-2" /> Message aux clients
            </Button>
            <Button variant="outline" onClick={load} disabled={isLoading}>
              <RefreshCw className="h-4 w-4 mr-2" /> Actualiser
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Entreprises', value: stats.tenantCount, sub: `${stats.activeCount} active(s)` },
              { label: 'Utilisateurs', value: stats.userCount, sub: 'tous clients confondus' },
              { label: 'Abonnements actifs', value: stats.activeSubscriptions, sub: `${stats.trialCount} en essai` },
              {
                label: 'Revenu mensuel projeté',
                value: formatCurrency(stats.mrrProjected),
                // Distinction essentielle : c'est ce que les forfaits actifs
                // DEVRAIENT rapporter, pas ce qui a été encaissé.
                sub: 'sur la base des forfaits actifs',
              },
              {
                label: 'Encaissé ce mois-ci',
                value: formatCurrency(stats.revenueCollectedThisMonth),
                sub: 'paiements réellement enregistrés',
              },
            ].map(c => (
              <Card key={c.label}>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">{c.label}</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">{c.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {stats && (stats.expiringSoon > 0 || stats.suspendedCount > 0) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {stats.expiringSoon > 0 && (
              <span>{stats.expiringSoon} abonnement(s) expirent sous 7 jours. </span>
            )}
            {stats.suspendedCount > 0 && (
              <span>{stats.suspendedCount} entreprise(s) suspendue(s).</span>
            )}
          </div>
        )}

        <div className="flex gap-1 border-b border-gray-200">
          {([['clients', 'Clients'], ['support', 'Support']] as const).map(([id, label]) => (
            <button
              key={id} onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'support' && <SupportTicketsPanel />}

        {tab === 'clients' && (isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : tenants.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-gray-500">Aucun client.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {tenants.map(t => {
              const idle = daysSince(t.lastSaleAt);
              return (
                <Card key={t.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{t.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATE_STYLE[t.state]}`}>
                            {STATE_LABEL[t.state]}
                          </span>
                          {t.plan && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                              {t.plan}
                            </span>
                          )}
                          {!t.isActive && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                              Suspendue
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {[t.city, t.phone, t.email].filter(Boolean).join(' · ') || '—'}
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                          {t.userCount ?? '?'} utilisateur(s) · {t.storeCount ?? '?'} magasin(s) ·{' '}
                          {t.saleCount ?? '?'} vente(s)
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {t.termsAcceptance ? (
                            <>
                              CGV v{t.termsAcceptance.version} acceptées le{' '}
                              {new Date(t.termsAcceptance.acceptedAt).toLocaleDateString('fr-FR')}
                            </>
                          ) : (
                            // Comptes créés avant la mise en place de
                            // l'acceptation : à régulariser avant toute
                            // facturation.
                            <span className="text-amber-600">Conditions non acceptées</span>
                          )}
                        </p>
                        <p className="text-xs mt-1">
                          {idle === null ? (
                            <span className="text-red-600">Aucune vente enregistrée</span>
                          ) : idle > 14 ? (
                            <span className="text-red-600">
                              Dernière vente il y a {idle} jours — client probablement en train de décrocher
                            </span>
                          ) : (
                            <span className="text-gray-500">Dernière vente il y a {idle} jour(s)</span>
                          )}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        {t.daysLeft !== null && (
                          <p className={`text-sm font-medium ${t.daysLeft <= 7 ? 'text-red-600' : 'text-gray-700'}`}>
                            {t.daysLeft === 0 ? 'Bloqué' : `${t.daysLeft} j avant blocage`}
                          </p>
                        )}
                        {t.currentPeriodEnd && (
                          <p className="text-xs text-gray-400">
                            Échéance {new Date(t.currentPeriodEnd).toLocaleDateString('fr-FR')}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2 justify-end mt-2">
                          <Button size="sm" onClick={() => setPaying(t)}>
                            <Wallet className="h-4 w-4 mr-1" /> Paiement
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setViewingUsers(t)}>
                            <Users className="h-4 w-4 mr-1" /> Utilisateurs
                          </Button>
                          {t.isActive ? (
                            <Button size="sm" variant="outline" onClick={() => setSuspending(t)}>
                              <Ban className="h-4 w-4 mr-1" /> Suspendre
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => act('/api/admin/tenant-status', { tenantId: t.id, isActive: true }, t.id)}
                            >
                              <Check className="h-4 w-4 mr-1" /> Réactiver
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setHistoryTarget(t)}>
                            <HistoryIcon className="h-4 w-4 mr-1" /> Journal
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}
      </div>

      <PaymentDialog tenant={paying} onClose={() => setPaying(null)} onDone={load} />
      <SuspendDialog tenant={suspending} onClose={() => setSuspending(null)} onDone={load} />
      <UsersDialog tenant={viewingUsers} onClose={() => setViewingUsers(null)} />
      <BroadcastDialog open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
      <TenantHistoryDialog tenant={historyTarget} onClose={() => setHistoryTarget(null)} />
    </DashboardLayout>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function PaymentDialog({
  tenant, onClose, onDone,
}: { tenant: TenantRow | null; onClose: () => void; onDone: () => void }) {
  const [months, setMonths] = useState('1');
  const [plan, setPlan] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (tenant) {
      setMonths('1'); setPlan(tenant.plan || ''); setAmount('');
      setMethod(''); setNote(''); setErr(null);
    }
  }, [tenant]);

  const submit = async () => {
    if (!tenant) return;
    // Obligatoire : le tableau de bord affiche des revenus, un paiement sans
    // montant les fausserait. Une prolongation gracieuse se saisit à 0.
    if (amount === '' || Number(amount) < 0) {
      return setErr('Indiquez le montant reçu (0 pour une prolongation gracieuse)');
    }
    setErr(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant.id,
          months: Number(months),
          plan: plan || undefined,
          amount: Number(amount),
          method, note,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
      onClose();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={!!tenant} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Paiement — {tenant?.name}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            La période s&apos;ajoute à l&apos;échéance en cours si elle est future,
            sinon elle démarre aujourd&apos;hui. Payer en avance ne fait donc
            perdre aucun jour au client.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Durée (mois) *</Label>
              <Input type="number" min="1" max="24" value={months} onChange={e => setMonths(e.target.value)} />
            </div>
            <div>
              <Label>Forfait</Label>
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger><SelectValue placeholder="Inchangé" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="STARTER">Starter</SelectItem>
                  <SelectItem value="BUSINESS">Business</SelectItem>
                  <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Montant reçu (FCFA) *</Label>
              <Input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Moyen de paiement</Label>
              <Input placeholder="Orange Money, espèces…" value={method} onChange={e => setMethod(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Note (optionnel)</Label>
            <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Enregistrer et prolonger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function SuspendDialog({
  tenant, onClose, onDone,
}: { tenant: TenantRow | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (tenant) { setReason(''); setErr(null); } }, [tenant]);

  const submit = async () => {
    if (!tenant) return;
    if (!reason.trim()) return setErr('Indiquez le motif de la suspension');
    setErr(null); setIsSaving(true);
    try {
      const res = await fetch('/api/admin/tenant-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, isActive: false, reason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
      onClose(); onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally { setIsSaving(false); }
  };

  return (
    <Dialog open={!!tenant} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Suspendre — {tenant?.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Plus aucun utilisateur de cette entreprise ne pourra se connecter, et
            les sessions en cours seront fermées immédiatement. Ses données sont
            conservées et redeviendront accessibles à la réactivation.
          </div>
          <div>
            <Label>Motif *</Label>
            <Textarea
              rows={3} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Impayé depuis 2 mois, demande du client, usage abusif…"
            />
            <p className="mt-1 text-xs text-gray-500">
              Consigné dans le journal, côté Kafora et côté client.
            </p>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Confirmer la suspension
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

interface TenantUser {
  id: string; email: string | null; firstName: string; lastName: string;
  role: string | null; isActive: boolean; lastLoginAt: string | null;
  storeIds: number | null;
}

function UsersDialog({
  tenant, onClose,
}: { tenant: TenantRow | null; onClose: () => void }) {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    setUsers([]); setMsg(null); setErr(null); setIsLoading(true);
    fetch(`/api/admin/tenant-users?tenantId=${encodeURIComponent(tenant.id)}`)
      .then(async res => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
        setUsers(data.users || []);
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Erreur inconnue'))
      .finally(() => setIsLoading(false));
  }, [tenant]);

  const resetPassword = async (email: string) => {
    if (!tenant) return;
    setMsg(null); setErr(null); setResetLink(null);
    try {
      const res = await fetch('/api/admin/tenant-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
      // L'API renvoyait déjà le lien (data.link) mais l'écran ne l'affichait
      // jamais — "transmettez-le à l'utilisateur" sans jamais montrer quoi
      // transmettre. Trouvé lors d'un premier essai réel de la console.
      setMsg(`Lien généré pour ${email} :`);
      setResetLink(data?.link || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  return (
    <Dialog open={!!tenant} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Utilisateurs — {tenant?.name}</DialogTitle></DialogHeader>

        <p className="text-xs text-gray-500">
          Seules les informations de compte sont visibles. Les données
          commerciales du client (ventes, marges, clients) ne sont pas
          accessibles depuis ici, et cette consultation est consignée dans son
          journal d&apos;activité.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y rounded-lg border border-gray-200">
            {users.length === 0 && <p className="p-4 text-sm text-gray-500">Aucun utilisateur.</p>}
            {users.map(u => (
              <div key={u.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {u.firstName} {u.lastName}
                    {!u.isActive && <span className="ml-2 text-xs text-red-600">désactivé</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{u.email}</p>
                  <p className="text-xs text-gray-400">
                    {u.role}
                    {u.storeIds !== null && ` · ${u.storeIds} magasin(s)`}
                    {u.lastLoginAt && ` · dernière connexion ${new Date(u.lastLoginAt).toLocaleDateString('fr-FR')}`}
                  </p>
                </div>
                {u.email && (
                  <Button size="sm" variant="outline" onClick={() => resetPassword(u.email!)}>
                    Réinitialiser
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {msg && <p className="text-sm text-green-700">{msg}</p>}
        {resetLink && (
          <div className="flex items-center gap-2">
            <Input readOnly value={resetLink} className="text-xs" onFocus={e => e.target.select()} />
            <Button
              size="sm" variant="outline"
              onClick={() => { navigator.clipboard.writeText(resetLink); setMsg('Lien copié dans le presse-papiers.'); }}
            >
              Copier
            </Button>
          </div>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

const TICKET_TYPE_LABELS: Record<string, string> = { BUG: 'Bug', SUGGESTION: 'Suggestion', QUESTION: 'Question' };
const TICKET_STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-red-100 text-red-800', ANSWERED: 'bg-green-100 text-green-800', CLOSED: 'bg-gray-100 text-gray-600',
};
const TICKET_STATUS_LABEL: Record<string, string> = { OPEN: 'Ouvert', ANSWERED: 'Répondu', CLOSED: 'Clos' };

interface Ticket {
  id: string; tenantId: string; tenantName: string;
  userName: string | null; userEmail: string | null; userRole: string | null;
  type: string; message: string; pageUrl: string | null; status: string;
  createdAt: string; updatedAt: string;
}

/**
 * Boîte de réception des signalements clients — "Signaler un problème"
 * n'était qu'un email à sens unique avant ça, sans historique ni réponse
 * possible. Le fil de discussion se lit ici, la réponse déclenche une
 * vraie notification chez le client (voir /api/admin/tickets/reply).
 */
function SupportTicketsPanel() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'ANSWERED' | 'CLOSED'>('OPEN');
  const [selected, setSelected] = useState<Ticket | null>(null);

  const load = () => {
    setIsLoading(true); setError(null);
    fetch('/api/admin/tickets')
      .then(async res => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
        setTickets(data.tickets || []);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Erreur inconnue'))
      .finally(() => setIsLoading(false));
  };
  useEffect(load, []);

  const visible = tickets.filter(t => filter === 'ALL' || t.status === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        {(['OPEN', 'ANSWERED', 'CLOSED', 'ALL'] as const).map(f => (
          <button
            key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 text-gray-600 hover:border-primary-400'
            }`}
          >
            {f === 'ALL' ? 'Tous' : TICKET_STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : visible.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-gray-500">Aucun signalement.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {visible.map(t => (
            <Card key={t.id} className="cursor-pointer hover:border-primary-300" onClick={() => setSelected(t)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                        {TICKET_TYPE_LABELS[t.type] || t.type}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${TICKET_STATUS_STYLE[t.status]}`}>
                        {TICKET_STATUS_LABEL[t.status] || t.status}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{t.tenantName}</span>
                    </div>
                    <p className="text-sm text-gray-700 mt-1.5 line-clamp-2">{t.message}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {t.userName || 'Utilisateur'} ({t.userRole}) · {new Date(t.createdAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TicketDialog ticket={selected} onClose={() => setSelected(null)} onDone={load} />
    </div>
  );
}

interface TicketReply { id: string; authorType: string; authorName: string | null; message: string; createdAt: string; }

function TicketDialog({ ticket, onClose, onDone }: { ticket: Ticket | null; onClose: () => void; onDone: () => void }) {
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ticket) return;
    setReplies([]); setReply(''); setErr(null); setIsLoading(true);
    fetch(`/api/admin/tickets/${ticket.id}/replies`)
      .then(async res => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
        setReplies(data.replies || []);
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Erreur inconnue'))
      .finally(() => setIsLoading(false));
  }, [ticket]);

  const sendReply = async () => {
    if (!ticket || !reply.trim()) return;
    setIsSending(true); setErr(null);
    try {
      const res = await fetch('/api/admin/tickets/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.id, message: reply.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
      onClose(); onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally { setIsSending(false); }
  };

  const closeTicket = async () => {
    if (!ticket) return;
    setIsSending(true); setErr(null);
    try {
      const res = await fetch('/api/admin/tickets/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.id }),
      });
      if (!res.ok) { const data = await res.json().catch(() => null); throw new Error(data?.error || 'Erreur serveur'); }
      onClose(); onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally { setIsSending(false); }
  };

  return (
    <Dialog open={!!ticket} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> {ticket?.tenantName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
            <p className="text-xs text-gray-400 mb-1">
              {ticket?.userName || 'Utilisateur'} ({ticket?.userRole}) · {ticket && new Date(ticket.createdAt).toLocaleString('fr-FR')}
              {ticket?.pageUrl && ` · ${ticket.pageUrl}`}
            </p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{ticket?.message}</p>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
          ) : replies.map(r => (
            <div key={r.id} className={`rounded-lg p-3 border ${r.authorType === 'KAFORA' ? 'bg-primary-50 border-primary-200 ml-4' : 'bg-gray-50 border-gray-200'}`}>
              <p className="text-xs text-gray-400 mb-1">
                {r.authorName || (r.authorType === 'KAFORA' ? 'Kafora' : 'Client')} · {new Date(r.createdAt).toLocaleString('fr-FR')}
              </p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{r.message}</p>
            </div>
          ))}
        </div>

        {ticket?.status !== 'CLOSED' && (
          <div className="space-y-2 pt-2 border-t">
            <Textarea rows={3} placeholder="Votre réponse..." value={reply} onChange={e => setReply(e.target.value)} />
          </div>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          {ticket?.status !== 'CLOSED' && (
            <>
              <Button variant="outline" onClick={closeTicket} disabled={isSending}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Clore sans réponse
              </Button>
              <Button onClick={sendReply} disabled={isSending || !reply.trim()}>
                {isSending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Répondre
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Message groupé à tous les clients ou filtré par forfait — jusqu'ici il
 * n'existait aucun moyen d'annoncer quoi que ce soit à plusieurs clients
 * à la fois (voir /api/admin/broadcast).
 */
function BroadcastDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [plan, setPlan] = useState<'ALL' | 'STARTER' | 'BUSINESS' | 'ENTERPRISE'>('ALL');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setTitle(''); setMessage(''); setPlan('ALL'); setResult(null); setErr(null); };

  const submit = async () => {
    if (!title.trim() || !message.trim()) return setErr('Titre et message requis');
    setIsSending(true); setErr(null); setResult(null);
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), message: message.trim(), plan }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
      setResult(`Envoyé à ${data.sentTo} entreprise(s).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally { setIsSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" /> Message aux clients</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Destinataires</Label>
            <Select value={plan} onValueChange={v => setPlan(v as typeof plan)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Toutes les entreprises actives</SelectItem>
                <SelectItem value="STARTER">Forfait Starter uniquement</SelectItem>
                <SelectItem value="BUSINESS">Forfait Business uniquement</SelectItem>
                <SelectItem value="ENTERPRISE">Forfait Enterprise uniquement</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Titre *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex : Maintenance prévue ce week-end" />
          </div>
          <div>
            <Label>Message *</Label>
            <Textarea rows={4} value={message} onChange={e => setMessage(e.target.value)} />
          </div>
          {result && <p className="text-sm text-green-700">{result}</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Fermer</Button>
          <Button onClick={submit} disabled={isSending}>
            {isSending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Envoyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

interface HistoryEvent { kind: 'LOG' | 'PAYMENT'; action: string; detail: string | null; createdAt: string; }

const HISTORY_ACTION_LABELS: Record<string, string> = {
  TENANT_SUSPENDED: 'Suspension', TENANT_ACTIVATED: 'Réactivation',
  PASSWORD_RESET_LINK: 'Lien de réinitialisation généré', TICKET_REPLIED: 'Réponse à un signalement',
  BROADCAST_SENT: 'Message groupé', PAYMENT_RECORDED: 'Paiement enregistré',
};

/**
 * "Journal Kafora" d'un client — toutes les actions prises côté éditeur
 * sur son compte, jusqu'ici éparpillées sans aucun écran pour les
 * consulter (voir /api/admin/tenant-history). Le suivi demandé
 * explicitement côté SUPER_ADMIN.
 */
function TenantHistoryDialog({ tenant, onClose }: { tenant: TenantRow | null; onClose: () => void }) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    setEvents([]); setErr(null); setIsLoading(true);
    fetch(`/api/admin/tenant-history?tenantId=${encodeURIComponent(tenant.id)}`)
      .then(async res => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
        setEvents(data.events || []);
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Erreur inconnue'))
      .finally(() => setIsLoading(false));
  }, [tenant]);

  return (
    <Dialog open={!!tenant} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><HistoryIcon className="h-5 w-5" /> Journal — {tenant?.name}</DialogTitle></DialogHeader>
        <p className="text-xs text-gray-500">
          Actions prises côté Kafora sur ce compte (suspensions, paiements, réponses de support). Jamais les données commerciales du client.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : events.length === 0 ? (
          <p className="p-4 text-sm text-gray-500 text-center">Aucune action enregistrée.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto divide-y rounded-lg border border-gray-200">
            {events.map((e, i) => (
              <div key={i} className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">{HISTORY_ACTION_LABELS[e.action] || e.action}</span>
                  <span className="text-xs text-gray-400">{new Date(e.createdAt).toLocaleString('fr-FR')}</span>
                </div>
                {e.detail && <p className="text-xs text-gray-600 mt-1">{e.detail}</p>}
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
