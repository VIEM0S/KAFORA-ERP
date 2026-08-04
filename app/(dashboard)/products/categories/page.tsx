'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Tag, RefreshCw, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/hooks/store';
import { collection, query, orderBy, where, getDocs, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
// onSnapshot vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/firebase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { onSnapshot } from '@/lib/firebase/watch';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import type { Category } from '@/lib/types';

function slugify(str: string) {
  return str.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface CatForm { name: string; description: string; isActive: boolean; }
const EMPTY: CatForm = { name: '', description: '', isActive: true };

export default function CategoriesPage() {
  const { tenant } = useAuthStore();
  const tenantId = tenant?.id;

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState<CatForm>(EMPTY);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [linkedProductsCount, setLinkedProductsCount] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const q = query(
      collection(db, tenantCol(tenantId, 'categories')),
      orderBy('name', 'asc')
    );
    return onSnapshot(q, (snap) => {
      setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Category[]);
      setIsLoading(false);
    });
  }, [tenantId]);

  const filtered = categories.filter(
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => { setEditing(null); setForm(EMPTY); setFormError(null); setShowDialog(true); };
  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({ name: c.name, description: c.description || '', isActive: c.isActive });
    setFormError(null);
    setShowDialog(true);
  };
  const f = (field: keyof CatForm, value: string | boolean) =>
    setForm((p) => ({ ...p, [field]: value }));

  const handleSave = async () => {
    if (!tenantId) return;
    if (!form.name.trim()) { setFormError('Le nom est obligatoire'); return; }
    setIsSaving(true); setFormError(null);
    const payload = {
      tenantId,
      name: form.name.trim(),
      slug: slugify(form.name),
      description: form.description.trim() || null,
      isActive: form.isActive,
      parentId: null,
      updatedAt: serverTimestamp(),
    };
    try {
      if (editing) {
        await updateDoc(doc(db, tenantCol(tenantId, 'categories'), editing.id), payload);
      } else {
        await addDoc(collection(db, tenantCol(tenantId, 'categories')), {
          ...payload, createdAt: serverTimestamp(),
        });
      }
      setShowDialog(false);
    } catch (e) {
      setFormError('Erreur lors de la sauvegarde');
      console.error(e);
    } finally { setIsSaving(false); }
  };

  const handleDelete = async () => {
    if (!tenantId || !deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, tenantCol(tenantId, 'categories'), deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) { console.error(e); }
    finally { setIsDeleting(false); }
  };

  const toggleActive = async (c: Category) => {
    if (!tenantId) return;
    await updateDoc(doc(db, tenantCol(tenantId, 'categories'), c.id), {
      isActive: !c.isActive, updatedAt: serverTimestamp(),
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Catégories</h1>
            <p className="text-sm text-gray-500 mt-1">{categories.length} catégorie{categories.length !== 1 ? 's' : ''}</p>
          </div>
          <Button onClick={openAdd} className="bg-primary-600 hover:bg-primary-700">
            <Plus className="h-4 w-4 mr-2" />Nouvelle catégorie
          </Button>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="relative">
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Rechercher une catégorie..." value={search}
                onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Tag className="h-12 w-12 mb-4 opacity-30" />
                <p className="font-medium">Aucune catégorie trouvée</p>
                {categories.length === 0 && (
                  <Button onClick={openAdd} variant="outline" className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />Créer votre première catégorie
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-center">Statut</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id} className="hover:bg-gray-50">
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{c.slug}</code>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500 max-w-xs truncate">
                        {c.description || '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch checked={c.isActive} onCheckedChange={() => toggleActive(c)} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(c)}>
                              <Edit className="h-4 w-4 mr-2" />Modifier
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setDeleteTarget(c)} className="text-red-600 focus:text-red-600">
                              <Trash2 className="h-4 w-4 mr-2" />Supprimer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialog */}
      <Dialog open={showDialog} onOpenChange={(o) => { if (!o) setShowDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</DialogTitle>
          </DialogHeader>
          {formError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{formError}</div>
          )}
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nom *</Label>
              <Input placeholder="ex: Ciment & Béton" autoFocus value={form.name}
                onChange={(e) => f('name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Description optionnelle..." value={form.description}
                onChange={(e) => f('description', e.target.value)} rows={2} />
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm font-medium">Catégorie active</p>
                <p className="text-xs text-gray-500">Visible dans les produits et le POS</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => f('isActive', v)} />
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

      {/* Delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette catégorie ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> sera définitivement supprimée.
              Les produits associés ne seront pas supprimés.
            </AlertDialogDescription>
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
