import { useState } from 'react';
import { useAuthStore } from '@/hooks/store';
import { Eye, EyeOff, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface UserForm {
  email: string; password: string; confirmPassword: string;
  firstName: string; lastName: string; phone: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER';
  storeIds: string[];
}
const EMPTY_FORM: UserForm = {
  email: '', password: '', confirmPassword: '',
  firstName: '', lastName: '', phone: '', role: 'MANAGER', storeIds: [],
};

interface CreateUserDialogProps {
  tenantId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (message: string) => void;
}

export function CreateUserDialog({ tenantId, open, onOpenChange, onCreated }: CreateUserDialogProps) {
  const { stores } = useAuthStore();
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const f = (field: keyof UserForm, value: string) => setForm(p => ({ ...p, [field]: value }));

  const handleOpenChange = (o: boolean) => {
    onOpenChange(o);
    if (o) { setForm(EMPTY_FORM); setFormError(null); }
  };

  const handleCreate = async () => {
    if (!tenantId) return;
    if (!form.firstName.trim() || !form.lastName.trim()) { setFormError('Prénom et nom obligatoires'); return; }
    if (!form.email.trim()) { setFormError('Email obligatoire'); return; }
    if (form.password.length < 6) { setFormError('Mot de passe : 6 caractères minimum'); return; }
    if (form.password !== form.confirmPassword) { setFormError('Les mots de passe ne correspondent pas'); return; }
    if (form.role !== 'ADMIN' && form.storeIds.length === 0) {
      setFormError('Sélectionnez au moins un magasin pour cet utilisateur'); return;
    }

    setIsSaving(true); setFormError(null);
    try {
      const res = await fetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la création');
      onOpenChange(false);
      setForm(EMPTY_FORM);
      onCreated(`Compte créé pour ${form.firstName} ${form.lastName}`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Erreur interne');
    } finally { setIsSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nouveau compte utilisateur</DialogTitle></DialogHeader>
        {formError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />{formError}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="cu-firstName">Prénom *</Label>
            <Input id="cu-firstName" value={form.firstName} onChange={e => f('firstName', e.target.value)} placeholder="Amadou" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-lastName">Nom *</Label>
            <Input id="cu-lastName" value={form.lastName} onChange={e => f('lastName', e.target.value)} placeholder="Coulibaly" />
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="cu-email">Email *</Label>
            <Input id="cu-email" type="email" value={form.email} onChange={e => f('email', e.target.value)} placeholder="utilisateur@email.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-phone">Téléphone</Label>
            <Input id="cu-phone" value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="+223 70 00 00 00" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-role">Rôle *</Label>
            <Select value={form.role} onValueChange={v => f('role', v)}>
              <SelectTrigger id="cu-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Administrateur</SelectItem>
                <SelectItem value="MANAGER">Responsable</SelectItem>
                <SelectItem value="CASHIER">Caissier</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Un Administrateur relève de la direction : accès à tous les
              magasins. Pour les autres rôles, l'affectation est obligatoire —
              sans elle, l'utilisateur verrait le stock, les ventes et la
              caisse de toutes les boutiques. */}
          {form.role === 'ADMIN' ? (
            <p className="text-xs text-gray-500">
              Un Administrateur a accès à tous les magasins.
            </p>
          ) : (
            <div>
              <Label>Magasins autorisés *</Label>
              <div className="mt-2 space-y-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-3">
                {stores.length === 0 && (
                  <p className="text-xs text-gray-500">Aucun magasin disponible.</p>
                )}
                {stores.map(store => (
                  <label key={store.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={form.storeIds.includes(store.id)}
                      onChange={e =>
                        setForm(f => ({
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
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="cu-password">Mot de passe *</Label>
            <div className="relative">
              <Input id="cu-password" type={showPassword ? 'text' : 'password'} value={form.password}
                onChange={e => f('password', e.target.value)} placeholder="6 caractères min." className="pr-10" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-confirmPassword">Confirmer *</Label>
            <Input id="cu-confirmPassword" type="password" value={form.confirmPassword}
              onChange={e => f('confirmPassword', e.target.value)} placeholder="••••••••" />
            {form.password && form.confirmPassword && form.password !== form.confirmPassword && (
              <p className="text-xs text-red-500">Les mots de passe ne correspondent pas</p>
            )}
          </div>
          <div className="col-span-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
            ℹ️ L'utilisateur recevra ses identifiants par email. Il pourra modifier son mot de passe depuis les paramètres.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Annuler</Button>
          <Button onClick={handleCreate} disabled={isSaving} className="bg-primary-600 hover:bg-primary-700">
            {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Création...</> : 'Créer le compte'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
