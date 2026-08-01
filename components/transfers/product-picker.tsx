'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';

/**
 * Sélecteur de produit pour les transferts.
 *
 * La recherche est faite CÔTÉ SERVEUR, comme au POS : on ne charge jamais le
 * catalogue entier, qui peut compter des milliers de références.
 *
 * Elle interroge `nameLower` (champ dénormalisé en minuscules, car Firestore
 * est sensible à la casse) et le code-barres en correspondance exacte, pour
 * que la douchette fonctionne aussi ici.
 *
 * Le stock disponible dans le magasin source est affiché à côté de chaque
 * résultat : sans cette information, on prépare un transfert qui sera refusé
 * à l'expédition faute de quantité — l'erreur la plus frustrante possible.
 */

interface ProductHit {
  id: string;
  name: string;
  sku: string;
  available: number | null;
}

interface ProductPickerProps {
  tenantId: string | undefined;
  /** Magasin dont on veut connaître le stock disponible. */
  storeId: string | undefined;
  onPick: (p: { productId: string; productName: string; productSku: string }) => void;
  /** Identifiants déjà présents dans le transfert (pour les signaler). */
  alreadyPicked?: string[];
}

export function ProductPicker({ tenantId, storeId, onPick, alreadyPicked = [] }: ProductPickerProps) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const seq = useRef(0);

  const picked = useMemo(() => new Set(alreadyPicked), [alreadyPicked]);

  useEffect(() => {
    const t = term.trim();
    if (!tenantId || t.length < 2) {
      setHits([]);
      return;
    }

    const mine = ++seq.current;
    setIsSearching(true);

    // Débounce : une requête par pause de frappe, pas par caractère.
    const timer = setTimeout(async () => {
      try {
        const col = collection(db, tenantCol(tenantId, 'products'));
        const lower = t.toLowerCase();

        const [byName, byBarcode] = await Promise.all([
          getDocs(
            query(
              col,
              where('isActive', '==', true),
              where('nameLower', '>=', lower),
              where('nameLower', '<=', lower + '\uf8ff'),
              orderBy('nameLower'),
              limit(15)
            )
          ).catch(() => null),
          getDocs(query(col, where('barcode', '==', t), limit(5))).catch(() => null),
        ]);

        if (mine !== seq.current) return; // une frappe plus récente a pris le relais

        const merged = new Map<string, ProductHit>();
        for (const snap of [byBarcode, byName]) {
          snap?.docs.forEach(d => {
            const data = d.data();
            merged.set(d.id, {
              id: d.id,
              name: (data.name as string) || '',
              sku: (data.sku as string) || '',
              available: null,
            });
          });
        }

        const list = [...merged.values()];

        // Stock disponible dans le magasin source, pour les résultats affichés.
        if (storeId && list.length > 0) {
          const invSnaps = await Promise.all(
            list.map(p =>
              getDocs(
                query(
                  collection(db, tenantCol(tenantId, 'inventory')),
                  where('productId', '==', p.id),
                  where('storeId', '==', storeId),
                  limit(1)
                )
              ).catch(() => null)
            )
          );
          if (mine !== seq.current) return;
          list.forEach((p, i) => {
            const s = invSnaps[i];
            p.available = s && !s.empty ? (s.docs[0].data().quantity as number) || 0 : 0;
          });
        }

        if (mine !== seq.current) return;
        setHits(list);
      } finally {
        if (mine === seq.current) setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [tenantId, storeId, term]);

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          className="pl-9"
          placeholder="Rechercher un produit (nom ou code-barres)"
          value={term}
          onChange={e => setTerm(e.target.value)}
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
        )}
      </div>

      {term.trim().length >= 2 && (
        <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-gray-200 divide-y">
          {hits.length === 0 && !isSearching && (
            <p className="p-3 text-sm text-gray-500">Aucun produit trouvé.</p>
          )}
          {hits.map(p => {
            const already = picked.has(p.id);
            const outOfStock = p.available === 0;
            return (
              <button
                key={p.id}
                type="button"
                disabled={already}
                onClick={() => {
                  onPick({ productId: p.id, productName: p.name, productSku: p.sku });
                  setTerm('');
                  setHits([]);
                }}
                className={`w-full text-left p-3 flex items-center justify-between gap-3 hover:bg-gray-50 ${
                  already ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900 truncate">{p.name}</span>
                  {p.sku && <span className="block text-xs text-gray-500">{p.sku}</span>}
                </span>
                <span className="shrink-0 text-xs">
                  {already ? (
                    <span className="text-gray-500 flex items-center gap-1">
                      <Check className="h-3 w-3" /> ajouté
                    </span>
                  ) : p.available === null ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <span className={outOfStock ? 'text-red-600' : 'text-gray-600'}>
                      {p.available} en stock
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
