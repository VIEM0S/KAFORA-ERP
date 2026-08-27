'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Store as StoreIcon, Edit, Trash2, MapPin,
  Phone, Mail, RefreshCw, X, ChevronDown, CheckCircle2, Warehouse
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { useAuthStore } from '@/hooks/store';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { mapStore } from '@/lib/supabase/mappers';
import { checkPlanLimitClient } from '@/lib/supabase/plan-limits-client';
import type { Store } from '@/lib/types';
import { isOwnerOrAdmin as isOwnerOrAdminRole } from '@/lib/auth/roles';

interface StoreForm {
  name: string; code: string; address: string; city: string;
  phone: string; email: string; isWarehouse: boolean; isActive: boolean;
}
const EMPTY: StoreForm = {
  name: '', code: '', address: '', city: 'Bamako',
  phone: '', email: '', isWarehouse: false, isActive: true,
};

export default function StoresPage() {
  const { tenant, currentStore, setCurrentStore, stores: authStores, setStores } = useAuthStore();
  const tenantId = tenant?.id;

  const [stores, setLocalStores] = useState<Store[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Store | null>(null);
  const [form, setForm] = useState<StoreForm>(EMPTY);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Store | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isOwnerOrAdmin = isOwnerOrAdminRole(useAuthStore.getState().user?.role);
  const isOwner = useAuthStore.getState().user?.role === 'OWNER';

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'stores',
      () => supabase.from('stores').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true }),
      rows => {
        const data = rows.map(mapStore);
        setLocalStores(data);
        setIsLoading(false);
        // Synchroniser avec le store global (pour le sélecteur de magasin dans le header)
        setStores(data.filter(s => s.isActive));
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId]);

  const f = (field: keyof StoreForm, value: string | boolean) => setForm(p => ({ ...p, [field]: value }));

  const openAdd = () => { setEditing(null); setForm(EMPTY); setFormError(null); setShowDialog(true); };
  const openEdit = (s: Store) => {
    setEditing(s);
    setForm({
      name: s.name, code: s.code || '', address: s.address || '',
      city: s.city || 'Bamako', phone: s.phone || '', email: s.email || '',
      isWarehouse: s.isWarehouse || false, isActive: s.isActive,
    });
    setFormError(null); setShowDialog(true);
  };

  const handleSave = async () => {
    if (!tenantId) return;
    if (!form.name.trim()) { setFormError('Le nom du magasin est obligatoire'); return; }
    setIsSaving(true); setFormError(null);

    if (!editing) {
      const limitCheck = await checkPlanLimitClient(tenantId, 'maxStores');
      if (!limitCheck.allowed) {
        setFormError(limitCheck.reason);
        setIsSaving(false);
        return;
      }
    }

    const payload = {
      tenant_id: tenantId, name: form.name.trim(),
      code: form.code.trim() || form.name.slice(0, 3).toUpperCase(),
      address: form.address.trim() || null, city: form.city.trim() || null,
      phone: form.phone.trim() || null, email: form.email.trim() || null,
      is_warehouse: form.isWarehouse, is_active: form.isActive,
    };
    try {
      const { error } = editing
        ? await supabase.from('stores').update(payload).eq('id', editing.id)
        : await supabase.from('stores').insert(payload);
      if (error) throw error;
      setShowDialog(false);
    } catch (e) { setFormError('Erreur lors de la sauvegarde'); console.error(e); }
    finally { setIsSaving(false); }
  };

  const handleDelete = async () => {
    if (!tenantId || !deleteTarget) return;
    if (stores.filter(s => s.isActive).length <= 1) {
      alert('Vous ne pouvez pas supprimer votre dernier magasin actif');
      setDeleteTarget(null);
      return;
    }
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('stores').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      setDeleteTarget(null);
    } catch (e) { console.error(e); } finally { setIsDeleting(false); }
  };

  const toggleActive = async (s: Store) => {
    if (!tenantId) return;
    if (s.isActive && stores.filter(x => x.isActive).length <= 1) {
      alert('Vous devez garder au moins un magasin actif');
      return;
    }
    await supabase.from('stores').update({ is_active: !s.isActive }).eq('id', s.id);
  };

  const selectStore = (s: Store) => {
    setCurrentStore(s);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Magasins</h1>
            <p className="text-sm text-gray-500 mt-1">{stores.filter(s => s.isActive).length} magasin{stores.filter(s => s.isActive).length !== 1 ? 's' : ''} actif{stores.filter(s => s.isActive).length !== 1 ? 's' : ''}</p>
          </div>
          {isOwnerOrAdmin && (
            <Button onClick={openAdd} className="bg-primary-600 hover:bg-primary-700">
              <Plus className="h-4 w-4 mr-2" />Nouveau magasin
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...
          </div>
        ) : stores.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center justify-center py-16 text-gray-400">
            <StoreIcon className="h-12 w-12 mb-4 opacity-30" />
            <p className="font-medium">Aucun magasin</p>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stores.map(s => {
              const isCurrent = currentStore?.id === s.id;
              return (
                <Card key={s.id} className={isCurrent ? 'border-primary-400 ring-1 ring-primary-400' : ''}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${s.isWarehouse ? 'bg-orange-100' : 'bg-primary-100'}`}>
                          {s.isWarehouse ? <Warehouse className="h-5 w-5 text-orange-600" /> : <StoreIcon className="h-5 w-5 text-primary-600" />}
                        </div>
                        <div>
                          <p className="font-bold text-gray-900">{s.name}</p>
                          <p className="text-xs text-gray-400">{s.code}</p>
                        </div>
                      </div>
                      {isOwnerOrAdmin && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7"><ChevronDown className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(s)}><Edit className="h-4 w-4 mr-2" />Modifier</DropdownMenuItem>
                            {isOwner && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setDeleteTarget(s)} className="text-red-600 focus:text-red-600"><Trash2 className="h-4 w-4 mr-2" />Supprimer</DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    <div className="space-y-1.5 mb-4 text-sm">
                      {(s.address || s.city) && (
                        <div className="flex items-center gap-1.5 text-gray-500">
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{[s.address, s.city].filter(Boolean).join(', ')}</span>
                        </div>
                      )}
                      {s.phone && <div className="flex items-center gap-1.5 text-gray-500"><Phone className="h-3.5 w-3.5" />{s.phone}</div>}
                      {s.email && <div className="flex items-center gap-1.5 text-gray-500"><Mail className="h-3.5 w-3.5" />{s.email}</div>}
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {s.isActive ? 'Actif' : 'Inactif'}
                        </span>
                        {s.isWarehouse && <span className="text-xs px-2 py-1 rounded-full font-medium bg-orange-100 text-orange-700">Entrepôt</span>}
                      </div>
                      {isCurrent ? (
                        <span className="flex items-center gap-1 text-xs text-primary-600 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />Sélectionné
                        </span>
                      ) : (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => selectStore(s)} disabled={!s.isActive}>
                          Sélectionner
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Dialog */}
      <Dialog open={showDialog} onOpenChange={o => { if (!o) setShowDialog(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Modifier le magasin' : 'Nouveau magasin'}</DialogTitle></DialogHeader>
          {formError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{formError}</div>}
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-2">
              <Label>Nom du magasin *</Label>
              <Input value={form.name} onChange={e => f('name', e.target.value)} placeholder="Magasin Central" />
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={form.code} onChange={e => f('code', e.target.value)} placeholder="MCT" maxLength={5} />
            </div>
            <div className="space-y-2">
              <Label>Téléphone</Label>
              <Input value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="+223 70 00 00 00" />
            </div>
            <div className="space-y-2">
              <Label>Ville</Label>
              <Input value={form.city} onChange={e => f('city', e.target.value)} placeholder="Bamako" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => f('email', e.target.value)} placeholder="magasin@entreprise.com" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Adresse</Label>
              <Input value={form.address} onChange={e => f('address', e.target.value)} placeholder="Rue 123, Quartier..." />
            </div>
            <div className="col-span-2 flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div><p className="text-sm font-medium">Magasin entrepôt</p><p className="text-xs text-gray-500">Stockage uniquement, pas de vente directe</p></div>
              <Switch checked={form.isWarehouse} onCheckedChange={v => f('isWarehouse', v)} />
            </div>
            <div className="col-span-2 flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div><p className="text-sm font-medium">Magasin actif</p><p className="text-xs text-gray-500">Visible et utilisable</p></div>
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
            <AlertDialogTitle>Supprimer ce magasin ?</AlertDialogTitle>
            <AlertDialogDescription><strong>{deleteTarget?.name}</strong> sera définitivement supprimé. Le stock et l&apos;historique associés ne seront pas supprimés.</AlertDialogDescription>
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
