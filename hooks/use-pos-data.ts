import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { mapProduct, mapCustomer } from '@/lib/supabase/mappers';
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
 * serveur (ILIKE, accéléré par les index trigram idx_products_name_trgm /
 * idx_customers_search_trgm — voir supabase/migrations), inventaire chargé
 * uniquement pour les produits visibles.
 */

const PAGE_SIZE = 60;

export function usePosData(tenantId: string | undefined, storeId: string | undefined) {
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');

  /** Décalage de pagination du mode navigation (remplace le curseur
   *  startAfter(lastDoc) de Firestore — Postgres pagine par offset/limite). */
  const offsetRef = useRef(0);
  /** Incrémenté à chaque recherche : permet d'ignorer une réponse obsolète
   *  qui arriverait après une plus récente (course entre deux frappes). */
  const searchSeq = useRef(0);

  /* ---------------------------------------------------------------- */
  /* Navigation : première page, en écoute temps réel                  */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!tenantId || search.trim()) return;

    setIsLoading(true);
    return watch(
      'products',
      () => supabase.from('products').select('*').eq('tenant_id', tenantId).eq('is_active', true)
        .order('name').range(0, PAGE_SIZE - 1),
      rows => {
        const mapped = rows.map(mapProduct);
        setProducts(mapped);
        offsetRef.current = mapped.length;
        setHasMore(mapped.length === PAGE_SIZE);
        setIsLoading(false);
      },
      () => setIsLoading(false),
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, search]);

  /** Page suivante (mode navigation uniquement). */
  const loadMore = useCallback(async () => {
    if (!tenantId || search.trim()) return;
    const from = offsetRef.current;
    const { data } = await supabase.from('products').select('*').eq('tenant_id', tenantId).eq('is_active', true)
      .order('name').range(from, from + PAGE_SIZE - 1);
    const mapped = (data ?? []).map(mapProduct);
    setProducts(prev => [...prev, ...mapped]);
    offsetRef.current = from + mapped.length;
    setHasMore(mapped.length === PAGE_SIZE);
  }, [tenantId, search]);

  /* ---------------------------------------------------------------- */
  /* Recherche : exécutée côté serveur                                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const term = search.trim();
    if (!tenantId || !term) return;

    const seq = ++searchSeq.current;
    setIsSearching(true);

    // Débounce : on ne part pas en requête à chaque frappe.
    const timer = setTimeout(async () => {
      try {
        // Deux recherches ciblées plutôt qu'un filtre en mémoire :
        //  - code-barres : correspondance exacte (cas du scanner)
        //  - nom : ILIKE substring (accéléré par l'index trigram
        //    idx_products_name_trgm), insensible à la casse nativement —
        //    plus besoin du champ dénormalisé nameLower ni du repli sur
        //    préfixe qu'imposait Firestore.
        const [byBarcode, byName] = await Promise.all([
          supabase.from('products').select('*').eq('tenant_id', tenantId).eq('barcode', term).limit(5),
          supabase.from('products').select('*').eq('tenant_id', tenantId).eq('is_active', true)
            .ilike('name', `%${term}%`).order('name').limit(PAGE_SIZE),
        ]);

        if (seq !== searchSeq.current) return; // une recherche plus récente a pris le relais

        const merged = new Map<string, Product>();
        (byBarcode.data ?? []).forEach(r => merged.set(r.id, mapProduct(r)));
        (byName.data ?? []).forEach(r => merged.set(r.id, mapProduct(r)));

        setProducts([...merged.values()]);
        setHasMore(false);
      } finally {
        if (seq === searchSeq.current) setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [tenantId, search]);

  /* ---------------------------------------------------------------- */
  /* Inventaire : uniquement pour les produits actuellement affichés   */
  /* ---------------------------------------------------------------- */
  const visibleIds = useMemo(() => products.map(p => p.id).join(','), [products]);

  useEffect(() => {
    const ids = visibleIds ? visibleIds.split(',') : [];
    if (!tenantId || !storeId || ids.length === 0) return;

    // Une seule requête : Postgres n'a pas la limite Firestore de 30 valeurs
    // pour une clause `in`, plus besoin de découper en lots.
    return watch(
      'inventory',
      () => supabase.from('inventory').select('product_id, quantity').eq('tenant_id', tenantId).eq('store_id', storeId).in('product_id', ids),
      rows => {
        setInventory(prev => {
          const next = { ...prev };
          rows.forEach(r => { next[r.product_id] = r.quantity || 0; });
          return next;
        });
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, storeId, visibleIds]);

  /* ---------------------------------------------------------------- */
  /* Clients : recherchés à la demande, plus jamais préchargés          */
  /* ---------------------------------------------------------------- */
  const [customers, setCustomers] = useState<Customer[]>([]);

  const searchCustomers = useCallback(
    async (term: string) => {
      if (!tenantId) return;
      const t = term.trim();

      // Sans terme : les derniers clients créés — c'est le cas courant en
      // boutique (on ressert un client récent).
      if (!t) {
        const { data } = await supabase.from('customers').select('*').eq('tenant_id', tenantId).eq('is_active', true)
          .order('created_at', { ascending: false }).limit(30);
        setCustomers((data ?? []).map(mapCustomer));
        return;
      }

      // Un client n'a pas de champ `name` unique (firstName / lastName /
      // companyName). `search_name` est une colonne GÉNÉRÉE côté Postgres
      // (les trois champs concaténés en minuscules), interrogée par ILIKE
      // (accéléré par idx_customers_search_trgm) — plus besoin du champ
      // dénormalisé calculé côté client qu'imposait Firestore. Le téléphone
      // reste en correspondance exacte — en boutique, c'est souvent par le
      // numéro qu'on retrouve un client.
      const [byPhone, byName] = await Promise.all([
        supabase.from('customers').select('*').eq('tenant_id', tenantId).eq('phone', t).limit(5),
        supabase.from('customers').select('*').eq('tenant_id', tenantId)
          .ilike('search_name', `%${t.toLowerCase()}%`).order('search_name').limit(30),
      ]);

      const merged = new Map<string, Customer>();
      (byPhone.data ?? []).forEach(r => merged.set(r.id, mapCustomer(r)));
      (byName.data ?? []).forEach(r => merged.set(r.id, mapCustomer(r)));
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
