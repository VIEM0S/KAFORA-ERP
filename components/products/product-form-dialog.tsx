import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils/helpers';
import { collection, doc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { skuKey, hasSku } from '@/lib/products/sku';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { checkPlanLimitClient } from '@/lib/firebase/plan-limits-client';
import type { Product, Category } from '@/lib/types';

const UNITS = [
  { value: 'piece', label: 'Pièce' },
  { value: 'sac', label: 'Sac' },
  { value: 'kg', label: 'Kilogramme' },
  { value: 'm', label: 'Mètre' },
  { value: 'm2', label: 'Mètre carré' },
  { value: 'm3', label: 'Mètre cube' },
  { value: 'litre', label: 'Litre' },
  { value: 'barre', label: 'Barre' },
  { value: 'carton', label: 'Carton' },
  { value: 'boite', label: 'Boîte' },
  { value: 'rouleau', label: 'Rouleau' },
];

interface ProductForm {
  sku: string; barcode: string; name: string; description: string;
  categoryId: string; unit: string;
  purchasePrice: string; sellingPrice: string; taxRate: string; alertThreshold: string;
  isActive: boolean; trackInventory: boolean;
}
const EMPTY_FORM: ProductForm = {
  sku: '', barcode: '', name: '', description: '',
  categoryId: '', unit: 'piece',
  purchasePrice: '', sellingPrice: '',
  taxRate: '0', alertThreshold: '10',
  isActive: true, trackInventory: true,
};

interface ProductFormDialogProps {
  tenantId: string | undefined;
  open: boolean;
  editingProduct: Product | null;
  categories: Category[];
  onOpenChange: (open: boolean) => void;
}

export function ProductFormDialog({ tenantId, open, editingProduct, categories, onOpenChange }: ProductFormDialogProps) {
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Recharge le formulaire à chaque ouverture (création ou édition)
  useEffect(() => {
    if (!open) return;
    if (editingProduct) {
      setForm({
        sku: editingProduct.sku,
        barcode: editingProduct.barcode || '',
        name: editingProduct.name,
        description: editingProduct.description || '',
        categoryId: editingProduct.categoryId || '',
        unit: editingProduct.unit,
        purchasePrice: editingProduct.purchasePrice == null ? '' : String(editingProduct.purchasePrice),
        sellingPrice: String(editingProduct.sellingPrice),
        taxRate: String(editingProduct.taxRate),
        alertThreshold: String(editingProduct.alertThreshold),
        isActive: editingProduct.isActive,
        trackInventory: editingProduct.trackInventory,
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setFormError(null);
  }, [open, editingProduct]);

  const f = (field: keyof ProductForm, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!tenantId) return;
    if (!form.name.trim() || !form.sku.trim()) {
      setFormError('Nom et SKU sont obligatoires');
      return;
    }
    // Prix d'achat FACULTATIF, mais recommandé.
    //
    // L'exiger poussait à saisir 0 quand on ne le connaissait pas — et 0
    // signifie « ça ne m'a rien coûté », donc 100 % de marge. Le rapport de
    // rentabilité devenait faux sans que personne ne s'en aperçoive.
    // Une valeur absente est honnête : elle est exclue des calculs de marge,
    // qui signalent alors être incomplets.
    if (form.purchasePrice && Number(form.purchasePrice) < 0) {
      setFormError('Le prix d\'achat ne peut pas être négatif');
      return;
    }
    if (!form.sellingPrice || Number(form.sellingPrice) <= 0) {
      setFormError('Le prix de vente doit être supérieur à 0');
      return;
    }

    setIsSaving(true);
    setFormError(null);

    if (!editingProduct) {
      const limitCheck = await checkPlanLimitClient(tenantId, 'maxProducts');
      if (!limitCheck.allowed) {
        setFormError(limitCheck.reason);
        setIsSaving(false);
        return;
      }
    }

    const payload = {
      tenantId,
      sku: form.sku.trim().toUpperCase(),
      barcode: form.barcode.trim() || null,
      name: form.name.trim(),
      // Champ dénormalisé en minuscules : Firestore est sensible à la casse
      // et ne sait pas faire de recherche insensible. C'est ce champ que le
      // POS interroge en préfixe pour que « sucre » trouve « Sucre ».
      nameLower: form.name.trim().toLowerCase(),
      description: form.description.trim() || null,
      categoryId: form.categoryId || null,
      unit: form.unit,
      // null (et non 0) quand le prix n'est pas renseigné : c'est ce qui
      // permet aux rapports de distinguer « gratuit » de « inconnu ».
      purchasePrice: form.purchasePrice.trim() === '' ? null : Number(form.purchasePrice),
      sellingPrice: Number(form.sellingPrice),
      taxRate: Number(form.taxRate) || 0,
      alertThreshold: Number(form.alertThreshold) || 10,
      isActive: form.isActive,
      trackInventory: form.trackInventory,
      imageData: null,
      updatedAt: serverTimestamp(),
    };

    try {
      // Produit + réservation du SKU dans un MÊME lot : si le SKU est déjà
      // pris, la règle Firestore refuse la réservation et l'ensemble du lot
      // est annulé. Le produit n'est donc jamais créé en doublon, même si
      // deux personnes enregistrent le même SKU au même instant.
      const batch = writeBatch(db);
      const skusCol = tenantCol(tenantId, 'product_skus');
      const newSku = form.sku.trim();

      if (editingProduct) {
        const productRef = doc(db, tenantCol(tenantId, 'products'), editingProduct.id);
        batch.update(productRef, payload);

        // SKU modifié : on libère l'ancienne réservation et on prend la
        // nouvelle. Sans la libération, l'ancien SKU resterait bloqué à vie.
        const oldSku = editingProduct.sku?.trim() || '';
        if (skuKey(oldSku) !== skuKey(newSku)) {
          if (hasSku(oldSku)) {
            batch.delete(doc(db, skusCol, skuKey(oldSku)));
          }
          if (hasSku(newSku)) {
            batch.set(doc(db, skusCol, skuKey(newSku)), {
              sku: newSku,
              productId: editingProduct.id,
              createdAt: serverTimestamp(),
            });
          }
        }
      } else {
        const productRef = doc(collection(db, tenantCol(tenantId, 'products')));
        batch.set(productRef, { ...payload, createdAt: serverTimestamp() });
        if (hasSku(newSku)) {
          batch.set(doc(db, skusCol, skuKey(newSku)), {
            sku: newSku,
            productId: productRef.id,
            createdAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();
      onOpenChange(false);
    } catch (err) {
      // L'échec le plus probable est un SKU déjà utilisé : on le dit
      // explicitement plutôt que d'afficher une erreur générique qui
      // laisserait l'utilisateur retenter indéfiniment la même saisie.
      const msg = err instanceof Error ? err.message : '';
      setFormError(
        msg.includes('permission') || msg.includes('PERMISSION')
          ? `La référence « ${form.sku.trim()} » est déjà utilisée par un autre produit.`
          : 'Erreur lors de la sauvegarde. Réessayez.'
      );
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingProduct ? 'Modifier le produit' : 'Nouveau produit'}</DialogTitle>
        </DialogHeader>

        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-2">
            <Label>SKU / Référence *</Label>
            <Input placeholder="ex: CM-PT-50" autoFocus value={form.sku} onChange={(e) => f('sku', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Code-barres</Label>
            <Input placeholder="ex: 1234567890123" value={form.barcode} onChange={(e) => f('barcode', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Nom du produit *</Label>
            <Input placeholder="Nom du produit" value={form.name} onChange={(e) => f('name', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Description</Label>
            <Textarea placeholder="Description du produit..." value={form.description} onChange={(e) => f('description', e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Catégorie</Label>
            <Select value={form.categoryId} onValueChange={(v) => f('categoryId', v)}>
              <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sans catégorie</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Unité</Label>
            <Select value={form.unit} onValueChange={(v) => f('unit', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Prix d'achat (FCFA)</Label>
            <Input type="number" placeholder="Optionnel" value={form.purchasePrice} onChange={(e) => f('purchasePrice', e.target.value)} min="0" />
            {!form.purchasePrice.trim() && (
              <p className="text-xs text-amber-600">
                Recommandé : sans lui, ce produit n&apos;apparaîtra ni dans vos
                marges ni dans la valeur de votre stock.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Prix de vente (FCFA) *</Label>
            <Input type="number" placeholder="0" value={form.sellingPrice} onChange={(e) => f('sellingPrice', e.target.value)} min="0" />
          </div>
          {form.purchasePrice && form.sellingPrice && Number(form.purchasePrice) > 0 && (
            <div className="col-span-2 bg-green-50 rounded-lg px-4 py-2 text-sm text-green-700">
              Marge : {Math.round(((Number(form.sellingPrice) - Number(form.purchasePrice)) / Number(form.purchasePrice)) * 100)}%
              · Bénéfice : {formatCurrency(Number(form.sellingPrice) - Number(form.purchasePrice))} / unité
            </div>
          )}
          <div className="space-y-2">
            <Label>TVA (%)</Label>
            <Input type="number" placeholder="0" value={form.taxRate} onChange={(e) => f('taxRate', e.target.value)} min="0" max="100" />
          </div>
          <div className="space-y-2">
            <Label>Seuil d'alerte stock</Label>
            <Input type="number" placeholder="10" value={form.alertThreshold} onChange={(e) => f('alertThreshold', e.target.value)} min="0" />
          </div>
          <div className="col-span-2 flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium">Produit actif</p>
              <p className="text-xs text-gray-500">Visible dans le POS et les ventes</p>
            </div>
            <Switch checked={form.isActive} onCheckedChange={(v) => f('isActive', v)} />
          </div>
          <div className="col-span-2 flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium">Suivi de stock</p>
              <p className="text-xs text-gray-500">Décrémenter le stock lors des ventes</p>
            </div>
            <Switch checked={form.trackInventory} onCheckedChange={(v) => f('trackInventory', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Annuler</Button>
          <Button onClick={handleSave} disabled={isSaving} className="bg-primary-600 hover:bg-primary-700">
            {isSaving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : editingProduct ? 'Enregistrer' : 'Créer le produit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
