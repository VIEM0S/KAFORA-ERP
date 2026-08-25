import { useState, useEffect } from 'react';
import { useAuthStore } from '@/hooks/store';
import { Eye, EyeOff, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import type { UserProfile } from './types';

interface EditForm {
  uid: string; email: string; firstName: string; lastName: string;
  phone: string; role: 'ADMIN' | 'REGIONAL_MANAGER' | 'MANAGER' | 'CASHIER';
  newPassword: string; confirmNewPassword: string;
  workStart: string; workEnd: string;
  storeIds: string[];
}
const EMPTY_EDIT_FORM: EditForm = {
  uid: '', email: '', firstName: '', lastName: '',
  phone: '', role: 'MANAGER', newPassword: '', confirmNewPassword: '',
  workStart: '', workEnd: '', storeIds: [],
};

interface EditUserDialogProps {
  tenantId: string | undefined;
  user: UserProfile | null;
  onOpenChange: (open: boolean) => void;
}

export function EditUserDialog({ tenantId, user, onOpenChange }: EditUserDialogProps) {
  const { toast } = useToast();
  const { stores, user: currentUser } = useAuthStore();
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);

  // Même cloisonnement qu'à la création (voir create-user-dialog.tsx) : un
  // responsable régional ne voit que ses propres magasins, et ne peut
  // promouvoir personne au-delà de Manager.
  const isRegionalManager = currentUser?.role === 'REGIONAL_MANAGER';
  const assignableStores = isRegionalManager
    ? stores.filter(s => (currentUser?.storeIds || []).includes(s.id))
    : stores;
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Recharge le formulaire à chaque fois qu'un nouvel utilisateur est ouvert en édition.
  useEffect(() => {
    if (!user) return;
    setEditForm({
      uid: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone || '',
      role: (user.role === 'OWNER' ? 'ADMIN' : user.role) as EditForm['role'],
      newPassword: '',
      confirmNewPassword: '',
      workStart: user.workingHours?.start || '',
      workEnd: user.workingHours?.end || '',
      // Compte créé avant le cloisonnement : storeIds absent = accès global.
      // On pré-coche alors tous les magasins plutôt que rien, pour ne pas
      // faire croire à une restriction déjà en place.
      storeIds: Array.isArray(user.storeIds) ? user.storeIds : stores.map(st => st.id),
    });
    setEditError(null);
    setShowEditPassword(false);
  }, [user]);

  const ef = (field: keyof EditForm, value: string) => setEditForm(p => ({ ...p, [field]: value }));

  const handleUpdate = async () => {
    if (!tenantId) return;
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) { setEditError('Prénom et nom obligatoires'); return; }
    if (!editForm.email.trim()) { setEditError('Email obligatoire'); return; }
    if (editForm.newPassword && editForm.newPassword.length < 8) { setEditError('Nouveau mot de passe : 8 caractères minimum'); return; }
    if (editForm.role !== 'ADMIN' && editForm.storeIds.length === 0) {
      setEditError('Sélectionnez au moins un magasin pour cet utilisateur'); return;
    }
    if (editForm.newPassword && editForm.newPassword !== editForm.confirmNewPassword) { setEditError('Les mots de passe ne correspondent pas'); return; }

    setIsEditSaving(true); setEditError(null);
    try {
      const res = await fetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          uid: editForm.uid,
          email: editForm.email,
          firstName: editForm.firstName,
          lastName: editForm.lastName,
          phone: editForm.phone,
          role: editForm.role,
          storeIds: editForm.role === 'ADMIN' ? null : editForm.storeIds,
          newPassword: editForm.newPassword || undefined,
          workingHours: (editForm.workStart && editForm.workEnd)
            ? { start: editForm.workStart, end: editForm.workEnd } : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la modification');
      onOpenChange(false);
      toast({ title: 'Utilisateur modifié', description: `${editForm.firstName} ${editForm.lastName} a été mis à jour.` });
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Erreur interne');
    } finally { setIsEditSaving(false); }
  };

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifier l&apos;utilisateur</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          {editError && (
            <div className="col-span-2 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />{editError}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="eu-firstName">Prénom *</Label>
            <Input id="eu-firstName" value={editForm.firstName} onChange={e => ef('firstName', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-lastName">Nom *</Label>
            <Input id="eu-lastName" value={editForm.lastName} onChange={e => ef('lastName', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-email">Email *</Label>
            <Input id="eu-email" type="email" value={editForm.email} onChange={e => ef('email', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-phone">Téléphone</Label>
            <Input id="eu-phone" value={editForm.phone} onChange={e => ef('phone', e.target.value)} placeholder="+223 ..." />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="eu-role">Rôle</Label>
            <Select value={editForm.role} onValueChange={v => ef('role', v)}>
              <SelectTrigger id="eu-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {!isRegionalManager && <SelectItem value="ADMIN">Administrateur</SelectItem>}
                {!isRegionalManager && <SelectItem value="REGIONAL_MANAGER">Responsable régional</SelectItem>}
                <SelectItem value="MANAGER">Responsable</SelectItem>
                <SelectItem value="CASHIER">Caissier</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">Ex. : promouvoir un Caissier en Responsable, ou l&apos;inverse.</p>
          </div>

          <div className="col-span-2">
            {editForm.role === 'ADMIN' ? (
              <p className="text-xs text-gray-500">
                Un Administrateur a accès à tous les magasins.
              </p>
            ) : (
              <>
                <Label>Magasins autorisés *</Label>
                <div className="mt-2 space-y-2 max-h-36 overflow-y-auto rounded-lg border border-gray-200 p-3">
                  {assignableStores.length === 0 && (
                    <p className="text-xs text-gray-500">Aucun magasin disponible.</p>
                  )}
                  {assignableStores.map(store => (
                    <label key={store.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={editForm.storeIds.includes(store.id)}
                        onChange={e =>
                          setEditForm(f => ({
                            ...f,
                            storeIds: e.target.checked
                              ? [...f.storeIds, store.id]
                              : f.storeIds.filter(id => id !== store.id),
                          }))
                        }
                      />
                      {store.name}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Cet utilisateur ne verra que les données des magasins cochés.
                </p>
              </>
            )}
          </div>
          <div className="col-span-2 border-t pt-3 mt-1">
            <p className="text-sm font-medium text-gray-700 mb-1">Horaires habituels (optionnel)</p>
            <p className="text-xs text-gray-400 mb-2">Affiche juste un avertissement dans le POS hors de ces heures — ne bloque jamais l&apos;accès. Laisser vide pour un poste sans horaire fixe (ex. boutique ouverte en continu).</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-workStart">Début</Label>
            <Input id="eu-workStart" type="time" value={editForm.workStart} onChange={e => ef('workStart', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-workEnd">Fin</Label>
            <Input id="eu-workEnd" type="time" value={editForm.workEnd} onChange={e => ef('workEnd', e.target.value)} />
          </div>
          <div className="col-span-2 border-t pt-3 mt-1">
            <p className="text-sm font-medium text-gray-700 mb-2">Réinitialiser le mot de passe (optionnel)</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-newPassword">Nouveau mot de passe</Label>
            <div className="relative">
              <Input id="eu-newPassword" type={showEditPassword ? 'text' : 'password'} value={editForm.newPassword}
                onChange={e => ef('newPassword', e.target.value)} placeholder="Laisser vide pour ne pas changer" />
              <button type="button" onClick={() => setShowEditPassword(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-confirmNewPassword">Confirmer</Label>
            <Input id="eu-confirmNewPassword" type="password" value={editForm.confirmNewPassword}
              onChange={e => ef('confirmNewPassword', e.target.value)} placeholder="••••••••" />
            {editForm.newPassword && editForm.confirmNewPassword && editForm.newPassword !== editForm.confirmNewPassword && (
              <p className="text-xs text-red-500">Les mots de passe ne correspondent pas</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isEditSaving}>Annuler</Button>
          <Button onClick={handleUpdate} disabled={isEditSaving} className="bg-primary-600 hover:bg-primary-700">
            {isEditSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
