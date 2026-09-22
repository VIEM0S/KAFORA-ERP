'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// /products/new n'est pas une page séparée — le formulaire est un dialog dans /products
// On redirige vers /products avec un paramètre pour ouvrir le dialog automatiquement
export default function ProductNewPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/products?new=1');
    // router : référence stable dans l'App Router — l'ajouter est sans
    // effet sur le comportement (toujours "monté une fois").
  }, [router]);
  return null;
}
