'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Search, Edit, Trash2, User, Building2, Eye,
  Phone, Mail, CreditCard, RefreshCw, X, ChevronDown, ShieldCheck
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils/helpers';
import { useAuthStore } from '@/hooks/store';
import { canManageCustomerRecord } from '@/lib/auth/roles';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { mapCustomer } from '@/lib/supabase/mappers';
import type { Customer, CustomerType } from '@/lib/types';

interface CustomerForm {
  code: string; firstName: string; lastName: string; companyName: string;
  email: string; phone: string; address: string; city: string;
  customerType: CustomerType; creditLimit: string; notes: string; isActive: boolean;
}
const EMPTY: CustomerForm = {
  code: '', firstName: '', lastName: '', companyName: '', email: '',
  phone: '', address: '', city: 'Bamako', customerType: 'INDIVIDUAL',
  creditLimit: '0', notes: '', isActive: true,
};

function genCode(customers: Customer[]) {
  const max = customers.reduce((m, c) => {
    const n = parseInt(c.code.replace(/\D/g, '')) || 0;
    return n > m ? n : m;
  }, 0);
  return `CLI-${String(max + 1).padStart(3, '0')}`;
}

export default function CustomersPage() {
  const { tenant, user, currentStore, stores } = useAuthStore();
  const router = useRouter();
  const tenantId = tenant?.id;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Limite de crédit — action distincte du formulaire générique depuis la
  // migration 045 (gouvernance : colonne protégée, chaque changement tracé).
  const [limitTarget, setLimitTarget] = useState<Customer | null>(null);
  const [newLimit, setNewLimit] = useState('');
  const [limitReason, setLimitReason] = useState('');
  const [isSavingLimit, setIsSavingLimit] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);

  const handleSaveCreditLimit = async () => {
    if (!limitTarget) return;
    if (newLimit === '' || Number(newLimit) < 0) { setLimitError('Limite invalide.'); return; }
    if (!limitReason.trim()) { setLimitError('Le motif est obligatoire.'); return; }
    setIsSavingLimit(true);
    setLimitError(null);
    try {
      const res = await fetch('/api/customers/credit-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: limitTarget.id, newLimit: Number(newLimit), reason: limitReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la mise à jour');
      setLimitTarget(null);
    } catch (e) {
      setLimitError(e instanceof Error ? e.message : 'Erreur lors de la mise à jour');
    } finally {
      setIsSavingLimit(false);
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'customers',
      () => supabase.from('customers').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      rows => { setCustomers(rows.map(mapCustomer)); setIsLoading(false); },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId]);

  const filtered = customers.filter((c) => {
    const name = `${c.firstName || ''} ${c.lastName || ''} ${c.companyName || ''}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || (c.phone || '').includes(search) || (c.code || '').toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === 'all' || c.customerType === filterType;
    const matchStatus = filterStatus === 'all' || (filterStatus === 'active' && c.isActive) || (filterStatus === 'inactive' && !c.isActive);
    return matchSearch && matchType && matchStatus;
  });

  const totalCreditUsed = customers.reduce((s, c) => s + (c.creditUsed || 0), 0);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY, code: genCode(customers) });
    setFormError(null); setShowDialog(true);
  };
  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      code: c.code, firstName: c.firstName || '', lastName: c.lastName || '',
      companyName: c.companyName || '', email: c.email || '', phone: c.phone || '',
      address: c.address || '', city: c.city || 'Bamako',
      customerType: c.customerType, creditLimit: String(c.creditLimit || 0),
      notes: c.notes || '', isActive: c.isActive,
    });
    setFormError(null); setShowDialog(true);
  };
  const f = (field: keyof CustomerForm, value: string | boolean) =>
    setForm((p) => ({ ...p, [field]: value }));

  const handleSave = async () => {
    if (!tenantId) return;
    if (!form.phone.trim() && !form.email.trim()) {
      setFormError('Au moins un téléphone ou email est obligatoire'); return;
    }
    if (form.customerType === 'BUSINESS' && !form.companyName.trim()) {
      setFormError('Le nom de l\'entreprise est obligatoire pour une entreprise'); return;
    }
    if (form.customerType === 'INDIVIDUAL' && !form.firstName.trim()) {
      setFormError('Le prénom est obligatoire'); return;
    }
    setIsSaving(true); setFormError(null);
    // search_name (recherche multi-champ insensible à la casse) est une
    // colonne GÉNÉRÉE côté Postgres (generated always as ... stored) — plus
    // besoin de la calculer côté client comme avec Firestore, et l'écrire
    // serait d'ailleurs refusé par la base.
    // credit_limit n'est PAS dans ce payload : la colonne est protégée
    // depuis la migration 045 (revoke update (credit_limit) — même un
    // Owner ne peut plus la changer par un update direct), seule
    // set_credit_limit() le peut, pour que chaque changement soit tracé
    // dans audit_log. Envoyer credit_limit ici ferait échouer TOUT
    // l'update (violation de privilège colonne), pas seulement ce champ —
    // voir handleSaveCreditLimit pour la limite d'un client existant.
    const payload = {
      tenant_id: tenantId, code: form.code.trim() || genCode(customers),
      first_name: form.customerType === 'INDIVIDUAL' ? form.firstName.trim() : null,
      last_name: form.customerType === 'INDIVIDUAL' ? form.lastName.trim() || null : null,
      company_name: form.customerType === 'BUSINESS' ? form.companyName.trim() : null,
      email: form.email.trim() || null, phone: form.phone.trim() || null,
      address: form.address.trim() || null, city: form.city.trim() || null,
      customer_type: form.customerType,
      notes: form.notes.trim() || null, is_active: form.isActive,
    };
    try {
      const { error } = editing
        ? await supabase.from('customers').update(payload).eq('id', editing.id)
        // Magasin d'inscription (modèle "agence bancaire", migration 044) :
        // figé à la création, jamais réécrit après coup — pas de "transfert"
        // de client entre magasins dans cette passe. null si créé depuis le
        // siège (currentStore absent), ouvert à tous comme un client existant.
        // credit_limit à la création n'est PAS une "modification" au sens
        // gouvernance — c'est une décision d'onboarding normale, seuls les
        // CHANGEMENTS ultérieurs passent par set_credit_limit()/audit_log.
        : await supabase.from('customers').insert({
            ...payload, credit_limit: Number(form.creditLimit) || 0, credit_used: 0,
            registered_store_id: currentStore?.id ?? null,
          });
      if (error) throw error;
      setShowDialog(false);
    } catch (e) { setFormError('Erreur lors de la sauvegarde'); console.error(e); }
    finally { setIsSaving(false); }
  };

  // `stores` (useAuthStore) ne contient que les magasins accessibles à
  // l'utilisateur courant — un Responsable cantonné au Magasin A n'y voit
  // pas le Magasin B. Un id introuvable ne veut donc PAS dire "supprimé" :
  // le plus souvent c'est juste un magasin auquel ce compte n'a pas accès
  // (cas normal et attendu). Étiquette neutre plutôt que "supprimé", qui
  // laisserait croire à une perte de données.
  const storeName = (id: string | null) => id ? (stores.find(s => s.id === id)?.name ?? 'Autre magasin') : 'Siège';
  const canManage = (c: Customer) => canManageCustomerRecord(user?.storeIds, c.registeredStoreId);

  const handleDelete = async () => {
    if (!tenantId || !deleteTarget) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('customers').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      setDeleteTarget(null);
    }
    catch (e) { console.error(e); } finally { setIsDeleting(false); }
  };

  const displayName = (c: Customer) =>
    c.customerType === 'BUSINESS' ? c.companyName : `${c.firstName || ''} ${c.lastName || ''}`.trim();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
            <p className="text-sm text-gray-500 mt-1">
              {customers.filter(c => c.isActive).length} client{customers.filter(c => c.isActive).length !== 1 ? 's' : ''} actifs
              {totalCreditUsed > 0 && <span className="ml-2">· {formatCurrency(totalCreditUsed)} en crédit en cours</span>}
            </p>
          </div>
          <Button onClick={openAdd} className="bg-primary-600 hover:bg-primary-700">
            <Plus className="h-4 w-4 mr-2" />Nouveau client
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total clients', value: customers.length, icon: User, color: 'text-blue-600' },
            { label: 'Particuliers', value: customers.filter(c => c.customerType === 'INDIVIDUAL').length, icon: User, color: 'text-green-600' },
            { label: 'Entreprises', value: customers.filter(c => c.customerType === 'BUSINESS').length, icon: Building2, color: 'text-purple-600' },
            { label: 'Crédit total', value: formatCurrency(totalCreditUsed), icon: CreditCard, color: 'text-amber-600' },
          ].map((s, i) => (
            <Card key={i}><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <s.icon className={`h-8 w-8 ${s.color} opacity-80`} />
                <div><p className="text-xs text-gray-500">{s.label}</p><p className="text-xl font-bold text-gray-900">{s.value}</p></div>
              </div>
            </CardContent></Card>
          ))}
        </div>

        {/* Filtres */}
        <Card><CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Nom, téléphone, code client..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>}
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous types</SelectItem>
                <SelectItem value="INDIVIDUAL">Particuliers</SelectItem>
                <SelectItem value="BUSINESS">Entreprises</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="active">Actifs</SelectItem>
                <SelectItem value="inactive">Inactifs</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent></Card>

        {/* Table */}
        <Card><CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <User className="h-12 w-12 mb-4 opacity-30" />
              <p className="font-medium">Aucun client trouvé</p>
              {customers.length === 0 && <Button onClick={openAdd} variant="outline" className="mt-4"><Plus className="h-4 w-4 mr-2" />Ajouter votre premier client</Button>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Type</TableHead>
                  {/* Modèle "agence bancaire" (migration 044) : le magasin
                      où la fiche a été créée. Sans cette colonne, un
                      Responsable qui ne voit soudain plus "Modifier" sur
                      certains clients n'aurait aucune explication visible. */}
                  <TableHead>Magasin d&apos;inscription</TableHead>
                  <TableHead className="text-right">Limite crédit</TableHead>
                  <TableHead className="text-right">Crédit utilisé</TableHead>
                  <TableHead className="text-center">Statut</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const creditPct = c.creditLimit > 0 ? (c.creditUsed / c.creditLimit) * 100 : 0;
                  return (
                    <TableRow key={c.id} className="hover:bg-gray-50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${c.customerType === 'BUSINESS' ? 'bg-purple-500' : 'bg-blue-500'}`}>
                            {c.customerType === 'BUSINESS' ? (c.companyName?.[0] || 'E') : (c.firstName?.[0] || 'C')}
                          </div>
                          <div>
                            <p className="font-medium text-sm text-gray-900">{displayName(c)}</p>
                            <p className="text-xs text-gray-400">{c.code}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {c.phone && <div className="flex items-center gap-1 text-xs text-gray-600"><Phone className="h-3 w-3" />{c.phone}</div>}
                          {c.email && <div className="flex items-center gap-1 text-xs text-gray-500"><Mail className="h-3 w-3" />{c.email}</div>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.customerType === 'BUSINESS' ? 'secondary' : 'outline'} className="text-xs">
                          {c.customerType === 'BUSINESS' ? 'Entreprise' : 'Particulier'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.registeredStoreId ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                          {storeName(c.registeredStoreId)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(c.creditLimit)}</TableCell>
                      <TableCell className="text-right">
                        <div>
                          <p className={`text-sm font-medium ${creditPct > 80 ? 'text-red-600' : creditPct > 50 ? 'text-amber-600' : 'text-gray-700'}`}>{formatCurrency(c.creditUsed)}</p>
                          {c.creditLimit > 0 && <div className="w-16 h-1 bg-gray-200 rounded-full mt-1 ml-auto"><div className={`h-1 rounded-full ${creditPct > 80 ? 'bg-red-500' : creditPct > 50 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(creditPct, 100)}%` }} /></div>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {c.isActive ? 'Actif' : 'Inactif'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronDown className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/customers/${c.id}`)}><Eye className="h-4 w-4 mr-2" />Voir le détail</DropdownMenuItem>
                            {/* Modifier/Supprimer réservés au magasin d'inscription du
                                client (ou au siège) — voir canManageCustomerRecord.
                                Masqués plutôt que désactivés : cohérent avec le reste
                                de l'app (ex. Transferts dans sidebar-nav.tsx). La
                                vraie barrière reste la policy RLS customers_update/
                                delete, ceci n'est qu'un confort d'affichage. */}
                            {canManage(c) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => openEdit(c)}><Edit className="h-4 w-4 mr-2" />Modifier</DropdownMenuItem>
                                {/* Action distincte de "Modifier" depuis la migration 045 :
                                    chaque changement de limite doit être tracé séparément
                                    (audit_log), colonne credit_limit protégée côté base. */}
                                <DropdownMenuItem onClick={() => { setLimitTarget(c); setNewLimit(String(c.creditLimit)); setLimitReason(''); setLimitError(null); }}>
                                  <ShieldCheck className="h-4 w-4 mr-2" />Modifier la limite de crédit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setDeleteTarget(c)} className="text-red-600 focus:text-red-600"><Trash2 className="h-4 w-4 mr-2" />Supprimer</DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>

      {/* Dialog */}
      <Dialog open={showDialog} onOpenChange={(o) => { if (!o) setShowDialog(false); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Modifier le client' : 'Nouveau client'}</DialogTitle></DialogHeader>
          {formError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{formError}</div>}
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-2">
              <Label>Code client</Label>
              <Input value={form.code} onChange={(e) => f('code', e.target.value)} placeholder="CLI-001" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select value={form.customerType} onValueChange={(v) => f('customerType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INDIVIDUAL">Particulier</SelectItem>
                  <SelectItem value="BUSINESS">Entreprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.customerType === 'BUSINESS' ? (
              <div className="col-span-2 space-y-2">
                <Label>Nom de l&apos;entreprise *</Label>
                <Input value={form.companyName} onChange={(e) => f('companyName', e.target.value)} placeholder="SARL Construction..." />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Prénom *</Label>
                  <Input value={form.firstName} onChange={(e) => f('firstName', e.target.value)} placeholder="Amadou" />
                </div>
                <div className="space-y-2">
                  <Label>Nom</Label>
                  <Input value={form.lastName} onChange={(e) => f('lastName', e.target.value)} placeholder="Diallo" />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Téléphone</Label>
              <Input value={form.phone} onChange={(e) => f('phone', e.target.value)} placeholder="+223 70 00 00 00" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => f('email', e.target.value)} placeholder="client@email.com" />
            </div>
            <div className="space-y-2">
              <Label>Ville</Label>
              <Input value={form.city} onChange={(e) => f('city', e.target.value)} placeholder="Bamako" />
            </div>
            <div className="space-y-2">
              <Label>Adresse</Label>
              <Input value={form.address} onChange={(e) => f('address', e.target.value)} placeholder="Badalabougou..." />
            </div>
            {/* Uniquement à la création : limite initiale, décision
                d'onboarding normale. Pour un client existant, changer la
                limite est tracé séparément (gouvernance, migration 045) —
                voir "Modifier la limite de crédit" dans le menu de la liste,
                pas ce formulaire. */}
            {!editing && (
              <div className="col-span-2 space-y-2">
                <Label>Limite de crédit initiale (FCFA)</Label>
                {/* 0 est la valeur par défaut ET signifie « aucun crédit
                    autorisé ». Sans cette précision, un commerçant crée ses
                    clients, tente une vente à crédit, et se la voit refuser
                    sans comprendre pourquoi. */}
                <p className="text-xs text-gray-500">
                  0 = aucune vente à crédit possible pour ce client.
                </p>
                <Input type="number" min="0" value={form.creditLimit} onChange={(e) => f('creditLimit', e.target.value)} placeholder="0" />
              </div>
            )}
            <div className="col-span-2 space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => f('notes', e.target.value)} placeholder="Notes sur le client..." rows={2} />
            </div>
            <div className="col-span-2 flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div><p className="text-sm font-medium">Client actif</p><p className="text-xs text-gray-500">Visible dans le POS</p></div>
              <Switch checked={form.isActive} onCheckedChange={(v) => f('isActive', v)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isSaving}>Annuler</Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-primary-600 hover:bg-primary-700">
              {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : editing ? 'Enregistrer' : 'Créer le client'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce client ?</AlertDialogTitle>
            <AlertDialogDescription><strong>{deleteTarget ? displayName(deleteTarget) : ''}</strong> sera définitivement supprimé.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-red-600 hover:bg-red-700">
              {isDeleting ? 'Suppression...' : 'Supprimer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Limite de crédit — action à part, tracée dans audit_log
          (migration 045). Une hausse notifie le siège. */}
      <Dialog open={!!limitTarget} onOpenChange={(o) => { if (!o) setLimitTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Limite de crédit — {limitTarget ? displayName(limitTarget) : ''}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
              Limite actuelle : <strong>{limitTarget ? formatCurrency(limitTarget.creditLimit) : ''}</strong>
              {limitTarget && limitTarget.creditUsed > 0 && <> · déjà utilisé : {formatCurrency(limitTarget.creditUsed)}</>}
            </div>
            {limitError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{limitError}</div>
            )}
            <div className="space-y-2">
              <Label>Nouvelle limite (FCFA) *</Label>
              <Input type="number" min="0" value={newLimit} onChange={e => { setNewLimit(e.target.value); setLimitError(null); }} />
            </div>
            <div className="space-y-2">
              <Label>Motif *</Label>
              <Textarea
                rows={2}
                placeholder="ex: Historique de paiement fiable, augmentation demandée..."
                value={limitReason}
                onChange={e => { setLimitReason(e.target.value); setLimitError(null); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLimitTarget(null)} disabled={isSavingLimit}>Annuler</Button>
            <Button onClick={handleSaveCreditLimit} disabled={isSavingLimit || !limitReason.trim()} className="bg-primary-600 hover:bg-primary-700">
              {isSavingLimit ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
