import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Product } from '@/lib/types';

interface DeleteProductDialogProps {
  tenantId: string | undefined;
  product: Product | null;
  onOpenChange: (open: boolean) => void;
}

export function DeleteProductDialog({ tenantId, product, onOpenChange }: DeleteProductDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!tenantId || !product) return;
    setIsDeleting(true);
    try {
      // Plus de réservation de SKU à libérer séparément (voir
      // product-form-dialog.tsx) : la contrainte unique Postgres se
      // désactive d'elle-même dès que la ligne produit disparaît.
      const { error } = await supabase.from('products').delete().eq('id', product.id);
      if (error) throw error;
      onOpenChange(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={!!product} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer ce produit ?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{product?.name}</strong> sera définitivement supprimé.
            Cette action est irréversible.
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
  );
}
