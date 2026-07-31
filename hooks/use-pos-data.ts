import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, query, where, orderBy, limit, startAfter, onSnapshot, getDocs,
  type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import type { Product, Customer } from '@/lib/types';

/**
 * Données du POS — chargement paginé.
 *
 * Avant : on chargeait TOUT le catalogue, TOUS les clients et TOUT
 * l'inventaire à chaque ouverture. Sur une boutique à 10 000 références, ça
 * représentait ~25 000 lectures Firestore par ouverture, et surtout plusieurs
 * dizaines de Mo à tenir en mémoire — un téléphone d'entrée de gamme fige
 * avant même d'afficher la grille.
 *
 * Maintenant : une page de produits à la fois, recherche exécutée côté
 * serveur, inventaire chargé uniquement pour les produits visibles.
 *
 * COMPROMIS HORS-LIGNE À CONNAÎTRE : la première page reste une écoute temps
 * réel, donc servie par le cache Firestore — le POS continue de fonctionner
 * sans réseau pour les produits déjà chargés. En revanche, rechercher un
 * produit jamais affiché ne renverra rien tant que la connexion n'est pas
 * revenue. C'est le prix à payer pour ne plus tout charger, et c'est le bon
 * arbitrage : aujourd'hui, au-delà de quelques milliers de références, la
 * caisse ne s'ouvre tout simplement plus.
 */

const PAGE_SIZE = 60;
/** Firestore limite les clauses `in` à 30 valeurs. */
const IN_CHUNK = 30;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const toProduct = (d: QueryDocumentSnapshot<DocumentData>) =>
  ({ id: d.id, ...d.data() }) as Product;

export function usePosData(tenantId: string | undefined, storeId: string | undefined) {
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');

  /** Curseur de pagination du mode navigation. */
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  /** Incrémenté à chaque recherche : permet d'ignorer une réponse obsolète
   *  qui arriverait après une plus récente (course entre deux frappes). */
  const searchSeq = useRef(0);

  const productsCol = tenantId ? tenantCol(tenantId, 'products') : null;

  /* ---------------------------------------------------------------- */
  /* Navigation : première page, en écoute temps réel (donc en cache)  */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!productsCol || search.trim()) return;

    setIsLoading(true);
    const unsub = onSnapshot(
      query(
        collection(db, productsCol),
        where('isActive', '==', true),
        orderBy('name'),
        limit(PAGE_SIZE)
      ),
      snap => {
        setProducts(snap.docs.map(toProduct));
        lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null;
        setHasMore(snap.docs.length === PAGE_SIZE);
        setIsLoading(false);
      },
      () => setIsLoading(false)
    );
    return () => unsub();
  }, [productsCol, search]);

  /** Page suivante (mode navigation uniquement). */
  const loadMore = useCallback(async () => {
    if (!productsCol || !lastDocRef.current || search.trim()) return;
    const snap = await getDocs(
      query(
        collection(db, productsCol),
        where('isActive', '==', true),
        orderBy('name'),
        startAfter(lastDocRef.current),
        limit(PAGE_SIZE)
      )
    );
    setProducts(prev => [...prev, ...snap.docs.map(toProduct)]);
    lastDocRef.current = snap.docs[snap.docs.length - 1] ?? lastDocRef.current;
    setHasMore(snap.docs.length === PAGE_SIZE);
  }, [productsCol, search]);

  /* ---------------------------------------------------------------- */
  /* Recherche : exécutée côté serveur                                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const term = search.trim();
    if (!productsCol || !term) return;

    const seq = ++searchSeq.current;
    setIsSearching(true);

    // Débounce : on ne part pas en requête à chaque frappe.
    const timer = setTimeout(async () => {
      try {
        const lower = term.toLowerCase();
        const col = collection(db, productsCol);

        // Deux recherches ciblées plutôt qu'un filtre en mémoire :
        //  - code-barres : correspondance exacte (cas du scanner)
        //  - nom : préfixe sur `nameLower`, car Firestore est sensible à la
        //    casse et « sucre » doit trouver « Sucre » (voir le script de
        //    rattrapage fourni pour remplir ce champ sur l'existant).
        const [byBarcode, byName] = await Promise.all([
          getDocs(query(col, where('barcode', '==', term), limit(5))).catch(() => null),
          getDocs(
            query(
              col,
              where('isActive', '==', true),
              where('nameLower', '>=', lower),
              where('nameLower', '<=', lower + '\uf8ff'),
              orderBy('nameLower'),
              limit(PAGE_SIZE)
            )
          ).catch(() => null),
        ]);

        if (seq !== searchSeq.current) return; // une recherche plus récente a pris le relais

        const merged = new Map<string, Product>();
        byBarcode?.docs.forEach(d => merged.set(d.id, toProduct(d)));
        byName?.docs.forEach(d => merged.set(d.id, toProduct(d)));

        // Repli : si `nameLower` n'est pas encore rempli, on retente sur le
        // nom brut pour ne pas laisser l'utilisateur devant une grille vide.
        if (merged.size === 0) {
          const fallback = await getDocs(
            query(
              col,
              where('isActive', '==', true),
              where('name', '>=', term),
              where('name', '<=', term + '\uf8ff'),
              orderBy('name'),
              limit(PAGE_SIZE)
            )
          ).catch(() => null);
          fallback?.docs.forEach(d => merged.set(d.id, toProduct(d)));
        }

        if (seq !== searchSeq.current) return;
        setProducts([...merged.values()]);
        setHasMore(false);
      } finally {
        if (seq === searchSeq.current) setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [productsCol, search]);

  /* ---------------------------------------------------------------- */
  /* Inventaire : uniquement pour les produits actuellement affichés   */
  /* ---------------------------------------------------------------- */
  const visibleIds = useMemo(() => products.map(p => p.id).join(','), [products]);

  useEffect(() => {
    const ids = visibleIds ? visibleIds.split(',') : [];
    if (!tenantId || !storeId || ids.length === 0) return;

    const unsubs = chunk(ids, IN_CHUNK).map(part =>
      onSnapshot(
        query(
          collection(db, tenantCol(tenantId, 'inventory')),
          where('storeId', '==', storeId),
          where('productId', 'in', part)
        ),
        snap => {
          setInventory(prev => {
            const next = { ...prev };
            snap.docs.forEach(d => {
              const data = d.data();
              next[data.productId] = data.quantity || 0;
            });
            return next;
          });
        }
      )
    );
    return () => unsubs.forEach(u => u());
  }, [tenantId, storeId, visibleIds]);

  /* ---------------------------------------------------------------- */
  /* Clients : recherchés à la demande, plus jamais préchargés          */
  /* ---------------------------------------------------------------- */
  const [customers, setCustomers] = useState<Customer[]>([]);

  const searchCustomers = useCallback(
    async (term: string) => {
      if (!tenantId) return;
      const col = collection(db, tenantCol(tenantId, 'customers'));
      const t = term.trim();

      // Sans terme : les derniers clients créés — c'est le cas courant en
      // boutique (on ressert un client récent).
      if (!t) {
        const snap = await getDocs(
          query(col, where('isActive', '==', true), orderBy('createdAt', 'desc'), limit(30))
        ).catch(() => null);
        setCustomers(snap ? snap.docs.map(d => ({ id: d.id, ...d.data() }) as Customer) : []);
        return;
      }

      // Un client n'a pas de champ `name` unique (firstName / lastName /
      // companyName). Firestore ne sait pas chercher sur trois champs à la
      // fois : on s'appuie sur `searchName`, un champ dénormalisé en
      // minuscules (voir le script de rattrapage), plus le téléphone en
      // correspondance exacte — en boutique, c'est souvent par le numéro
      // qu'on retrouve un client.
      const [byPhone, byName] = await Promise.all([
        getDocs(query(col, where('phone', '==', t), limit(5))).catch(() => null),
        getDocs(
          query(
            col,
            where('searchName', '>=', t.toLowerCase()),
            where('searchName', '<=', t.toLowerCase() + '\uf8ff'),
            orderBy('searchName'),
            limit(30)
          )
        ).catch(() => null),
      ]);

      const merged = new Map<string, Customer>();
      byPhone?.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() } as Customer));
      byName?.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() } as Customer));
      setCustomers([...merged.values()]);
    },
    [tenantId]
  );

  return {
    products,
    customers,
    inventory,
    isLoading,
    isSearching,
    hasMore,
    search,
    setSearch,
    loadMore,
    searchCustomers,
  };
}
