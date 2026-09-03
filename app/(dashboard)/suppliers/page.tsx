'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Search, Edit, Trash2, Truck, Phone, Mail,
  RefreshCw, X, ChevronDown, MapPin, Globe
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuthStore } from '@/hooks/store';
import { isManagerPlus } from '@/lib/auth/roles';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { mapSupplier } from '@/lib/supabase/mappers';
import type { Supplier } from '@/lib/types';

interface SupplierForm {
  name: string; contactName: string; email: string; phone: string;
  address: string; city: string; country: string; website: string;
  notes: string; isActive: boolean;
  paymentTerms: string; taxId: string;
}

const EMPTY: SupplierForm = {
  name: '', contactName: '', email: '', phone: '',
  address: '', city: 'Bamako', country: 'Mali', website: '',
  notes: '', isActive: true,
  paymentTerms: '', taxId: '',
};

export default function SuppliersPage() {
  const { tenant, user } = useAuthStore();
  // suppliers_write (RLS) exige is_manager() — décision d'affichage
  // seulement, la vraie barrière reste la policy.
  const canManage = isManagerPlus(user?.role);
  const tenantId = tenant?.id;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'suppliers',
      () => supabase.from('suppliers').select('*').eq('tenant_id', tenantId).order('name', { ascending: true }),
      rows => { setSuppliers(rows.map(mapSupplier)); setIsLoading(false); },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId]);

  const filtered = suppliers.filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.contactPerson || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.phone || '').includes(search)
  );

  const openAdd = () => { setEditing(null); setForm(EMPTY); setFormError(null); setShowDialog(true); };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name, contactName: s.contactPerson || '', email: s.email || '',
      phone: s.phone || '', address: s.address || '', city: s.city || 'Bamako',
      country: s.country || 'Mali', website: s.website || '',
      notes: s.notes || '', isActive: s.isActive,
      paymentTerms: typeof s.paymentTerms === 'number' ? String(s.paymentTerms) : '',
      taxId: s.taxId || '',
    });
    setFormError(null); setShowDialog(true);
  };

  const f = (field: keyof SupplierForm, value: string | boolean) =>
    setForm(p => ({ ...p, [field]: value }));

  const handleSave = async () => {
    if (!tenantId) return;
    if (!form.name.trim()) { setFormError('Le nom du fournisseur est obligatoire'); return; }
    let paymentTerms: number | null = null;
    if (form.paymentTerms.trim()) {
      const n = Number(form.paymentTerms);
      if (!Number.isInteger(n) || n < 0) {
        setFormError('Le délai de paiement doit être un nombre de jours entier, positif ou nul');
        return;
      }
      paymentTerms = n;
    }
    setIsSaving(true); setFormError(null);
    const payload = {
      tenant_id: tenantId, name: form.name.trim(),
      contact_person: form.contactName.trim() || null,
      email: form.email.trim() || null, phone: form.phone.trim() || null,
      address: form.address.trim() || null, city: form.city.trim() || null,
      country: form.country.trim() || null, website: form.website.trim() || null,
      notes: form.notes.trim() || null, is_active: form.isActive,
      payment_terms: paymentTerms, tax_id: form.taxId.trim() || null,
    };
    try {
      const { error } = editing
        ? await supabase.from('suppliers').update(payload).eq('id', editing.id)
        : await supabase.from('suppliers').insert(payload);
      if (error) throw error;
      setShowDialog(false);
    } catch (e) { setFormError('Erreur lors de la sauvegarde'); console.error(e); }
    finally { setIsSaving(false); }
  };

  const handleDelete = async () => {
    if (!tenantId || !deleteTarget) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('suppliers').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      setDeleteTarget(null);
    }
    catch (e) { console.error(e); } finally { setIsDeleting(false); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fournisseurs</h1>
            <p className="text-sm text-gray-500 mt-1">{suppliers.filter(s => s.isActive).length} fournisseur{suppliers.filter(s => s.isActive).length !== 1 ? 's' : ''} actif{suppliers.filter(s => s.isActive).length !== 1 ? 's' : ''}</p>
          </div>
          {canManage && (
            <Button onClick={openAdd} className="bg-primary-600 hover:bg-primary-700">
              <Plus className="h-4 w-4 mr-2" />Nouveau fournisseur
            </Button>
          )}
        </div>

        <Card><CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input placeholder="Nom, contact ou téléphone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X className="h-4 w-4" /></button>}
          </div>
        </CardContent></Card>

        <Card><CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Truck className="h-12 w-12 mb-4 opacity-30" />
              <p className="font-medium">Aucun fournisseur</p>
              {suppliers.length === 0 && canManage && <Button onClick={openAdd} variant="outline" className="mt-4"><Plus className="h-4 w-4 mr-2" />Ajouter votre premier fournisseur</Button>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fournisseur</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Localisation</TableHead>
                  <TableHead>Paiement</TableHead>
                  <TableHead className="text-center">Statut</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(s => (
                  <TableRow key={s.id} className="hover:bg-gray-50">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                          <Truck className="h-4 w-4 text-orange-600" />
                        </div>
                        <div>
                          <p className="font-medium text-sm text-gray-900">{s.name}</p>
                          {s.contactPerson && <p className="text-xs text-gray-400">{s.contactPerson}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        {s.phone && <div className="flex items-center gap-1 text-xs text-gray-600"><Phone className="h-3 w-3" />{s.phone}</div>}
                        {s.email && <div className="flex items-center gap-1 text-xs text-gray-500"><Mail className="h-3 w-3" />{s.email}</div>}
                        {s.website && <div className="flex items-center gap-1 text-xs text-gray-500"><Globe className="h-3 w-3" />{s.website}</div>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(s.city || s.country) && (
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <MapPin className="h-3.5 w-3.5 text-gray-400" />
                          {[s.city, s.country].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {typeof s.paymentTerms === 'number' ? (s.paymentTerms === 0 ? 'Comptant' : `${s.paymentTerms}j`) : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {s.isActive ? 'Actif' : 'Inactif'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronDown className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(s)}><Edit className="h-4 w-4 mr-2" />Modifier</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setDeleteTarget(s)} className="text-red-600 focus:text-red-600"><Trash2 className="h-4 w-4 mr-2" />Supprimer</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>

      <Dialog open={showDialog} onOpenChange={o => { if (!o) setShowDialog(false); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</DialogTitle></DialogHeader>
          {formError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{formError}</div>}
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-2">
              <Label>Nom du fournisseur *</Label>
              <Input value={form.name} onChange={e => f('name', e.target.value)} placeholder="SARL Matériaux Mali" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Nom du contact</Label>
              <Input value={form.contactName} onChange={e => f('contactName', e.target.value)} placeholder="Mamadou Traoré" />
            </div>
            <div className="space-y-2">
              <Label>Téléphone</Label>
              <Input value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="+223 70 00 00 00" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => f('email', e.target.value)} placeholder="contact@fournisseur.com" />
            </div>
            <div className="space-y-2">
              <Label>Site web</Label>
              <Input value={form.website} onChange={e => f('website', e.target.value)} placeholder="www.fournisseur.com" />
            </div>
            <div className="space-y-2">
              <Label>Ville</Label>
              <Input value={form.city} onChange={e => f('city', e.target.value)} placeholder="Bamako" />
            </div>
            <div className="space-y-2">
              <Label>Pays</Label>
              <Input value={form.country} onChange={e => f('country', e.target.value)} placeholder="Mali" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Adresse</Label>
              <Input value={form.address} onChange={e => f('address', e.target.value)} placeholder="Zone industrielle..." />
            </div>
            <div className="space-y-2">
              <Label>Délai de paiement (jours)</Label>
              <Input type="number" min={0} step={1} value={form.paymentTerms}
                onChange={e => f('paymentTerms', e.target.value)} placeholder="30" />
              <p className="text-xs text-gray-400">Ex. 30 = paiement à 30 jours. Laisser vide si payé comptant.</p>
            </div>
            <div className="space-y-2">
              <Label>Numéro fiscal (NIF)</Label>
              <Input value={form.taxId} onChange={e => f('taxId', e.target.value)} placeholder="NIF du fournisseur" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Délais de livraison, conditions particulières..." rows={2} />
            </div>
            <div className="col-span-2 flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div><p className="text-sm font-medium">Fournisseur actif</p><p className="text-xs text-gray-500">Apparaît dans les commandes et mouvements de stock</p></div>
              <Switch checked={form.isActive} onCheckedChange={v => f('isActive', v)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isSaving}>Annuler</Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-primary-600 hover:bg-primary-700">
              {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : editing ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce fournisseur ?</AlertDialogTitle>
            <AlertDialogDescription><strong>{deleteTarget?.name}</strong> sera définitivement supprimé.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-red-600 hover:bg-red-700">
              {isDeleting ? 'Suppression...' : 'Supprimer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
