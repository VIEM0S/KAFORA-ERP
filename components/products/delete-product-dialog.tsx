import { useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { skuKey, hasSku } from '@/lib/products/sku';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
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
      // On libère la réservation du SKU en même temps que le produit :
      // sinon la référence resterait bloquée et le commerçant ne pourrait
      // plus la réutiliser pour un nouvel article.
      const batch = writeBatch(db);
      batch.delete(doc(db, tenantCol(tenantId, 'products'), product.id));
      if (hasSku(product.sku)) {
        batch.delete(doc(db, tenantCol(tenantId, 'product_skus'), skuKey(product.sku)));
      }
      await batch.commit();
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
