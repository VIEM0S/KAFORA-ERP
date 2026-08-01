'use client';

import { useEffect, useState } from 'react';
import { Building2, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils/helpers';

interface TenantRow {
  id: string;
  name: string;
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
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<TenantRow | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/tenants');
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Erreur serveur (${res.status})`);
      setTenants(data.tenants || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
          <Button variant="outline" onClick={load} disabled={isLoading}>
            <RefreshCw className="h-4 w-4 mr-2" /> Actualiser
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
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
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {[t.city, t.phone, t.email].filter(Boolean).join(' · ') || '—'}
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                          {t.userCount ?? '?'} utilisateur(s) · {t.storeCount ?? '?'} magasin(s) ·{' '}
                          {t.saleCount ?? '?'} vente(s)
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
                        <Button size="sm" className="mt-2" onClick={() => setPaying(t)}>
                          <Wallet className="h-4 w-4 mr-1" /> Enregistrer un paiement
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <PaymentDialog tenant={paying} onClose={() => setPaying(null)} onDone={load} />
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
          amount: amount ? Number(amount) : undefined,
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
              <Label>Montant reçu (FCFA)</Label>
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
