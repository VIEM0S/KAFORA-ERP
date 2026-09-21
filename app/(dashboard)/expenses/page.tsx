'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus, Search, X, Wallet, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/hooks/store';
import { isManagerPlus, isOwnerOrAdmin } from '@/lib/auth/roles';
import { supabase } from '@/lib/supabase/client';
import { watch } from '@/lib/supabase/watch';
import { mapExpense } from '@/lib/supabase/mappers';
import { formatCurrency, formatDate } from '@/lib/utils/helpers';
import type { Expense, ExpenseCategory, ExpenseStatus } from '@/lib/types';

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'RENT', label: 'Loyer' },
  { value: 'SALARY', label: 'Salaires' },
  { value: 'UTILITIES', label: 'Électricité, eau, internet' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'SUPPLIES', label: 'Fournitures' },
  { value: 'MAINTENANCE', label: 'Entretien, réparations' },
  { value: 'TAXES', label: 'Impôts et taxes' },
  { value: 'MARKETING', label: 'Publicité, marketing' },
  { value: 'OTHER', label: 'Autre' },
];
const categoryLabel = (c: string) => CATEGORIES.find(x => x.value === c)?.label ?? c;

const STATUS_LABEL: Record<ExpenseStatus, string> = { APPROVED: 'Validée', PENDING: 'En attente', REJECTED: 'Refusée' };

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default function ExpensesPage() {
  const { tenant, user, currentStore, stores } = useAuthStore();
  const tenantId = tenant?.id;
  // Décisions d'affichage seulement — les vraies barrières sont create_expense()/decide_expense().
  const canCreate = isManagerPlus(user?.role);
  const canDecide = isOwnerOrAdmin(user?.role);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ExpenseStatus>('ALL');
  const [month, setMonth] = useState(currentMonth());

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ storeId: '', category: 'OTHER' as ExpenseCategory, amount: '', description: '', date: today() });
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<Expense | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'expenses',
      () => supabase.from('expenses').select('*').eq('tenant_id', tenantId).order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
      rows => { setExpenses(rows.map(mapExpense)); setIsLoading(false); },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId]);

  const storeName = (id: string | null) => stores.find(s => s.id === id)?.name ?? '—';
  const threshold = tenant?.expenseApprovalThreshold ?? 0;

  const inMonth = useMemo(() => expenses.filter(e => !month || e.expenseDate.startsWith(month)), [expenses, month]);
  const filtered = inMonth.filter(e =>
    (statusFilter === 'ALL' || e.status === statusFilter) &&
    (!search || e.description.toLowerCase().includes(search.toLowerCase()) || categoryLabel(e.category).toLowerCase().includes(search.toLowerCase()))
  );
  const approvedTotal = inMonth.filter(e => e.status === 'APPROVED').reduce((s, e) => s + e.amount, 0);
  const pendingAll = expenses.filter(e => e.status === 'PENDING');
  const pendingTotal = pendingAll.reduce((s, e) => s + e.amount, 0);

  const openCreate = () => {
    setForm({ storeId: currentStore?.id ?? stores[0]?.id ?? '', category: 'OTHER', amount: '', description: '', date: today() });
    setFormError(null); setShowCreate(true);
  };

  const handleCreate = async () => {
    const amount = Number(form.amount);
    if (!form.storeId) { setFormError('Choisissez un magasin'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('Le montant doit être supérieur à 0'); return; }
    if (!form.description.trim()) { setFormError('Le motif est obligatoire'); return; }
    setIsSaving(true); setFormError(null);
    try {
      const { ok, data } = await postJson('/api/expenses', {
        storeId: form.storeId, category: form.category, amount, description: form.description, expenseDate: form.date,
      });
      if (!ok) { setFormError((data.error as string) || 'Erreur lors de l\'enregistrement'); return; }
      setShowCreate(false);
      setNotice(data.status === 'PENDING'
        ? `Dépense enregistrée — au-dessus de ${formatCurrency(threshold)}, elle attend la validation du Propriétaire ou d'un Administrateur.`
        : 'Dépense enregistrée.');
      setTimeout(() => setNotice(null), 6000);
    } catch (e) { console.error(e); setFormError('Erreur lors de l\'enregistrement'); }
    finally { setIsSaving(false); }
  };

  const decide = async (expense: Expense, approve: boolean, note = '') => {
    setDecidingId(expense.id); setDecideError(null);
    try {
      const { ok, data } = await postJson('/api/expenses/decide', { expenseId: expense.id, approve, note });
      if (!ok) { setDecideError((data.error as string) || 'Erreur lors de la décision'); return false; }
      return true;
    } catch (e) { console.error(e); setDecideError('Erreur lors de la décision'); return false; }
    finally { setDecidingId(null); }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectNote.trim()) { setDecideError('Un motif est obligatoire pour refuser'); return; }
    if (await decide(rejectTarget, false, rejectNote)) { setRejectTarget(null); setRejectNote(''); }
  };

  const statusBadge = (s: ExpenseStatus) => {
    if (s === 'APPROVED') return <Badge className="bg-green-100 text-green-700 border-transparent hover:bg-green-100"><CheckCircle2 className="h-3 w-3 mr-1" />{STATUS_LABEL[s]}</Badge>;
    if (s === 'PENDING') return <Badge className="bg-amber-100 text-amber-700 border-transparent hover:bg-amber-100"><Clock className="h-3 w-3 mr-1" />{STATUS_LABEL[s]}</Badge>;
    return <Badge className="bg-red-100 text-red-700 border-transparent hover:bg-red-100"><XCircle className="h-3 w-3 mr-1" />{STATUS_LABEL[s]}</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dépenses</h1>
            <p className="text-sm text-gray-500 mt-1">Loyer, salaires, transport... pour connaître votre vrai bénéfice</p>
          </div>
          {canCreate && (
            <Button onClick={openCreate} className="bg-primary-600 hover:bg-primary-700 self-start sm:self-auto">
              <Plus className="h-4 w-4 mr-2" />Nouvelle dépense
            </Button>
          )}
        </div>

        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
        {decideError && !rejectTarget && <Alert variant="destructive"><AlertDescription>{decideError}</AlertDescription></Alert>}

        {canDecide && pendingAll.length > 0 && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              {pendingAll.length} dépense{pendingAll.length > 1 ? 's' : ''} en attente de votre validation ({formatCurrency(pendingTotal)}).
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card><CardContent className="p-4">
            <p className="text-sm text-gray-500">Dépenses validées{month ? ' (mois sélectionné)' : ''}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(approvedTotal)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-sm text-gray-500">En attente de validation</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{formatCurrency(pendingTotal)}</p>
            <p className="text-xs text-gray-400 mt-1">{pendingAll.length} dépense{pendingAll.length !== 1 ? 's' : ''}</p>
          </CardContent></Card>
        </div>

        <Card><CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Motif ou catégorie..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X className="h-4 w-4" /></button>}
            </div>
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="sm:w-44" aria-label="Mois" />
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as 'ALL' | ExpenseStatus)}>
              <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous les statuts</SelectItem>
                <SelectItem value="PENDING">En attente</SelectItem>
                <SelectItem value="APPROVED">Validées</SelectItem>
                <SelectItem value="REJECTED">Refusées</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent></Card>

        <Card><CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Wallet className="h-12 w-12 mb-4 opacity-30" />
              <p className="font-medium">Aucune dépense</p>
              {expenses.length === 0 && canCreate && <Button onClick={openCreate} variant="outline" className="mt-4"><Plus className="h-4 w-4 mr-2" />Enregistrer votre première dépense</Button>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Motif</TableHead>
                  {stores.length > 1 && <TableHead>Magasin</TableHead>}
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Statut</TableHead>
                  {canDecide && <TableHead className="w-44" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(e => (
                  <TableRow key={e.id} className="hover:bg-gray-50">
                    <TableCell className="text-sm whitespace-nowrap">{formatDate(e.expenseDate)}</TableCell>
                    <TableCell className="text-sm">{categoryLabel(e.category)}</TableCell>
                    <TableCell>
                      <p className="text-sm text-gray-900">{e.description}</p>
                      {e.createdByName && <p className="text-xs text-gray-400">Saisie par {e.createdByName}</p>}
                      {e.status !== 'PENDING' && e.decidedByName && (
                        <p className="text-xs text-gray-400">{e.status === 'APPROVED' ? 'Validée' : 'Refusée'} par {e.decidedByName}{e.decisionNote ? ` — ${e.decisionNote}` : ''}</p>
                      )}
                    </TableCell>
                    {stores.length > 1 && <TableCell className="text-sm">{storeName(e.storeId)}</TableCell>}
                    <TableCell className="text-right font-medium text-sm whitespace-nowrap">{formatCurrency(e.amount)}</TableCell>
                    <TableCell>{statusBadge(e.status)}</TableCell>
                    {canDecide && (
                      <TableCell>
                        {e.status === 'PENDING' && e.createdBy !== user?.id && (
                          <div className="flex gap-2">
                            <Button size="sm" disabled={decidingId === e.id} className="bg-green-600 hover:bg-green-700"
                              onClick={() => decide(e, true)}>Valider</Button>
                            <Button size="sm" variant="outline" disabled={decidingId === e.id}
                              onClick={() => { setRejectTarget(e); setRejectNote(''); setDecideError(null); }}>Refuser</Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>

      <Dialog open={showCreate} onOpenChange={o => { if (!o) setShowCreate(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nouvelle dépense</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
            <div className="space-y-2">
              <Label>Catégorie</Label>
              <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v as ExpenseCategory }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-amount">Montant (FCFA) *</Label>
              <Input id="expense-amount" type="number" min={1} value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="25000" />
              {threshold > 0 && !isOwnerOrAdmin(user?.role) && (
                <p className="text-xs text-gray-400">Au-dessus de {formatCurrency(threshold)}, une validation du Propriétaire ou d&apos;un Administrateur sera demandée.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-description">Motif *</Label>
              <Textarea id="expense-description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Ex. Loyer du mois de septembre" rows={2} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-date">Date</Label>
              <Input id="expense-date" type="date" max={today()} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            {stores.length > 1 && (
              <div className="space-y-2">
                <Label>Magasin</Label>
                <Select value={form.storeId} onValueChange={v => setForm(p => ({ ...p, storeId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={isSaving}>Annuler</Button>
            <Button onClick={handleCreate} disabled={isSaving} className="bg-primary-600 hover:bg-primary-700">
              {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={o => { if (!o) { setRejectTarget(null); setDecideError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Refuser cette dépense</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {rejectTarget && <p className="text-sm text-gray-600">{formatCurrency(rejectTarget.amount)} — {rejectTarget.description}</p>}
            {decideError && <Alert variant="destructive"><AlertDescription>{decideError}</AlertDescription></Alert>}
            <Label>Motif du refus *</Label>
            <Textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3} placeholder="Expliquez pourquoi cette dépense est refusée" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={!!decidingId}>Annuler</Button>
            <Button onClick={handleReject} disabled={!!decidingId} className="bg-red-600 hover:bg-red-700">Refuser</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
