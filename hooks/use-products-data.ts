import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts). Fix (héritage Firestore) : ce hook posait
// directement `onSnapshot` de 'firebase/firestore', sans passer par
// l'enveloppe lib/firebase/watch.ts — un des 3 écouteurs de l'app qui
// échouaient silencieusement (refus RLS ou coupure = écran vide, sans
// explication), signalé dans le plan de migration.
import { watch } from '@/lib/supabase/watch';
import { mapProduct, mapCategory } from '@/lib/supabase/mappers';
import type { Product, Category } from '@/lib/types';

export function useProductsData(tenantId: string | undefined) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;

    const unsubProducts = watch(
      'products',
      () => supabase.from('products').select('*').eq('tenant_id', tenantId).order('name', { ascending: true }),
      rows => {
        setProducts(rows.map(mapProduct));
        setIsLoading(false);
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );

    const unsubCats = watch(
      'categories',
      () => supabase.from('categories').select('*').eq('tenant_id', tenantId).eq('is_active', true).order('name', { ascending: true }),
      rows => setCategories(rows.map(mapCategory)),
      undefined,
      `tenant_id=eq.${tenantId}`
    );

    return () => { unsubProducts(); unsubCats(); };
  }, [tenantId]);

  return { products, categories, isLoading };
}
