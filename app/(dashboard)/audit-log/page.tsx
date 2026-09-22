'use client';

import { useState, useEffect } from 'react';
import { ShieldCheck, Search, X, RefreshCw } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/hooks/store';
import { isOwnerOrAdmin } from '@/lib/auth/roles';
import { supabase } from '@/lib/supabase/client';
import { watch } from '@/lib/supabase/watch';
import { mapAuditLog } from '@/lib/supabase/mappers';
import { formatCurrency, formatDateTime } from '@/lib/utils/helpers';
import type { AuditLogEntry } from '@/lib/types';

// Piste d'audit immuable (audit_log, migrations 045/067/068/073) : lecture
// seule. entity_type est du texte libre (pas un enum) — étendre la
// couverture (comptes, ventes...) n'a demandé aucune migration, seulement de
// brancher writeGovernanceLog() dans les routes concernées.
type Category = 'credit' | 'customer' | 'expense' | 'product' | 'user' | 'sale' | 'stocktake';

const CATEGORY_LABEL: Record<Category, string> = {
  credit: 'Crédits', customer: 'Clients', expense: 'Dépenses', product: 'Prix des produits',
  user: 'Comptes', sale: 'Ventes', stocktake: 'Inventaires',
};

const ACTION_LABEL: Record<string, string> = {
  CREDIT_WRITE_OFF_REQUESTED: "Demande d'annulation de crédit",
  CREDIT_WRITTEN_OFF: 'Crédit annulé',
  CREDIT_WRITE_OFF_APPROVED: 'Annulation de crédit validée',
  CREDIT_WRITE_OFF_REJECTED: 'Annulation de crédit refusée',
  CREDIT_LIMIT_CHANGED: 'Limite de crédit modifiée',
  EXPENSE_RECORDED: 'Dépense enregistrée',
  EXPENSE_REQUESTED: 'Dépense soumise à validation',
  EXPENSE_APPROVED: 'Dépense validée',
  EXPENSE_REJECTED: 'Dépense refusée',
  PRODUCT_PRICE_CHANGED: 'Prix modifié',
  STOCKTAKE_STARTED: 'Inventaire démarré',
  STOCKTAKE_SUBMITTED: 'Inventaire soumis à validation',
  STOCKTAKE_COMPLETED: 'Inventaire terminé',
  STOCKTAKE_APPROVED: 'Inventaire validé',
  STOCKTAKE_REJECTED: 'Inventaire refusé',
  STOCKTAKE_CANCELLED: 'Inventaire annulé',
  ROLE_CHANGED: 'Rôle modifié',
  USER_DEACTIVATED: 'Compte désactivé',
  USER_REACTIVATED: 'Compte réactivé',
  USER_DELETED: 'Compte supprimé',
  USER_RESTORED: 'Compte restauré',
  SALE_CANCELLED: 'Vente annulée',
};

const num = (v: unknown): number | null =>
  typeof v === 'number' ? v : v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
const money = (v: unknown) => {
  const n = num(v);
  return n === null ? '—' : formatCurrency(n);
};

/** Phrase lisible à partir des détails structurés d'une entrée. */
function summarize(e: AuditLogEntry): string {
  const d = e.details as Record<string, unknown>;
  const reason = typeof d.reason === 'string' && d.reason ? ` — ${d.reason}` : '';
  switch (e.action) {
    case 'PRODUCT_PRICE_CHANGED': {
      const parts: string[] = [];
      const sp = d.selling_price as { from?: unknown; to?: unknown } | undefined;
      const pp = d.purchase_price as { from?: unknown; to?: unknown } | undefined;
      if (sp && num(sp.from) !== num(sp.to)) parts.push(`prix de vente ${money(sp.from)} → ${money(sp.to)}`);
      if (pp && num(pp.from) !== num(pp.to)) parts.push(`prix d'achat ${money(pp.from)} → ${money(pp.to)}`);
      return `${String(d.name ?? 'Produit')} : ${parts.join(', ')}`;
    }
    case 'CREDIT_LIMIT_CHANGED':
      return `${money(d.previous_limit)} → ${money(d.new_limit)}${reason}`;
    case 'EXPENSE_RECORDED':
    case 'EXPENSE_REQUESTED':
    case 'EXPENSE_APPROVED':
    case 'EXPENSE_REJECTED': {
      const note = typeof d.note === 'string' && d.note ? ` — ${d.note}` : '';
      return `${money(d.amount)} · ${String(d.description ?? '')}${note}`;
    }
    case 'ROLE_CHANGED':
      return `${String(d.targetName ?? '')} : ${String(d.from ?? '?')} → ${String(d.to ?? '?')}`;
    case 'USER_DEACTIVATED':
    case 'USER_REACTIVATED':
    case 'USER_DELETED':
    case 'USER_RESTORED':
      return `${String(d.targetName ?? '')}${d.targetRole ? ` (${String(d.targetRole)})` : ''}`;
    case 'SALE_CANCELLED':
      return `${String(d.reference ?? '')} · ${money(d.total)}${reason}`;
    case 'STOCKTAKE_STARTED':
      return `${String(d.products ?? '?')} produit(s) à compter`;
    case 'STOCKTAKE_SUBMITTED':
    case 'STOCKTAKE_COMPLETED':
      return `écart estimé ${money(d.loss_value)}${d.threshold != null ? ` (seuil ${money(d.threshold)})` : ''}`;
    case 'STOCKTAKE_APPROVED':
    case 'STOCKTAKE_REJECTED':
      return `écart ${money(d.loss_value)}${reason}`;
    default:
      return d.amount != null ? `${money(d.amount)}${reason}` : reason.replace(/^ — /, '');
  }
}

function actionBadge(action: string) {
  const danger = /REJECTED|WRITTEN_OFF|WRITE_OFF_REQUESTED|DEACTIVATED|DELETED|CANCELLED/.test(action);
  const warn = /REQUESTED|PRICE_CHANGED|LIMIT_CHANGED|SUBMITTED|CHANGED/.test(action);
  const cls = danger
    ? 'bg-red-100 text-red-700 hover:bg-red-100'
    : warn
      ? 'bg-amber-100 text-amber-700 hover:bg-amber-100'
      : 'bg-green-100 text-green-700 hover:bg-green-100';
  return <Badge className={`${cls} border-transparent`}>{ACTION_LABEL[action] ?? action}</Badge>;
}

export default function AuditLogPage() {
  const { tenant, user } = useAuthStore();
  const tenantId = tenant?.id;
  // Décision d'affichage — la lecture d'audit_log reste bornée par sa policy RLS.
  const allowed = isOwnerOrAdmin(user?.role);

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'ALL' | Category>('ALL');

  useEffect(() => {
    if (!tenantId || !allowed) return;
    return watch(
      'audit_log',
      () => supabase.from('audit_log').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(300),
      rows => { setEntries(rows.map(mapAuditLog)); setIsLoading(false); },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, allowed]);

  if (!allowed) {
    return (
      <DashboardLayout>
        <Alert variant="destructive"><AlertDescription>Le journal d&apos;audit est réservé au Propriétaire et aux Administrateurs.</AlertDescription></Alert>
      </DashboardLayout>
    );
  }

  const filtered = entries.filter(e => {
    if (category !== 'ALL' && e.entityType !== category) return false;
    if (!search) return true;
    const hay = `${ACTION_LABEL[e.action] ?? e.action} ${e.actorName ?? ''} ${summarize(e)}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal d&apos;audit</h1>
          <p className="text-sm text-gray-500 mt-1">Qui a fait quoi, et quand : annulations de crédit, dépenses, changements de prix. Ce journal ne peut être ni modifié ni effacé.</p>
        </div>

        <Card><CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Personne, produit, motif..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X className="h-4 w-4" /></button>}
            </div>
            <Select value={category} onValueChange={v => setCategory(v as 'ALL' | Category)}>
              <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Toutes les catégories</SelectItem>
                {(Object.keys(CATEGORY_LABEL) as Category[]).map(c => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent></Card>

        <Card><CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <ShieldCheck className="h-12 w-12 mb-4 opacity-30" />
              <p className="font-medium">Aucune entrée</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Personne</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Détail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(e => (
                  <TableRow key={e.id} className="hover:bg-gray-50">
                    <TableCell className="text-sm whitespace-nowrap">{formatDateTime(e.createdAt)}</TableCell>
                    <TableCell className="text-sm">{e.actorName || '—'}</TableCell>
                    <TableCell>{actionBadge(e.action)}</TableCell>
                    <TableCell className="text-sm text-gray-700">{summarize(e)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
