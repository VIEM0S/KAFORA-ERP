import { supabase } from './client';
import { useDataErrors } from '@/hooks/use-data-errors';

/**
 * Écoute temps réel avec remontée automatique des erreurs.
 * Remplace lib/firebase/watch.ts — même rôle (un seul point d'intégration
 * avec hooks/use-data-errors.ts au lieu que chaque écran gère ses erreurs),
 * mais un contrat différent : l'API Realtime de Supabase livre des
 * ÉVÉNEMENTS de changement ligne par ligne (INSERT/UPDATE/DELETE), pas un
 * instantané complet du résultat de requête comme le faisait `onSnapshot`.
 *
 * Plutôt que de fusionner ces événements côté client (risque réel d'écran
 * désynchronisé si un événement est manqué pendant une coupure), `watch()`
 * REDEMANDE la requête complète à chaque changement détecté. Un aller-retour
 * de plus par changement est un coût négligeable à l'échelle actuelle de
 * l'application (nombre de commerçants modeste — même logique que la
 * décision prise pour `rate_limits`), et garantit que l'écran affiche
 * toujours exactement ce que la base contient, jamais un état reconstruit
 * à la main qui pourrait diverger.
 */

type Fetcher<T> = () => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>;

/** Libellés lisibles, mêmes clés que lib/firebase/watch.ts pour rester cohérent avec le bandeau existant. */
const LABELS: Record<string, string> = {
  sales: 'Ventes',
  sale_items: 'Ventes',
  products: 'Produits',
  inventory: 'Inventaire',
  inventory_movements: 'Mouvements de stock',
  customers: 'Clients',
  credits: 'Crédits',
  credit_payments: 'Crédits',
  suppliers: 'Fournisseurs',
  stores: 'Magasins',
  categories: 'Catégories',
  quotes: 'Devis',
  quote_items: 'Devis',
  purchase_orders: 'Bons de commande',
  transfers: 'Transferts',
  alerts: 'Alertes',
  daily_stats: 'Statistiques',
  cash_sessions: 'Sessions de caisse',
  cash_registers: 'Caisses',
  sale_returns: 'Retours',
  notifications: 'Notifications',
  invoices: 'Factures',
  users: 'Utilisateurs',
};

function labelOf(table: string): string {
  return LABELS[table] || table;
}

export type Unsubscribe = () => void;

/**
 * @param table Nom de la table Postgres écoutée — sert de canal Realtime et
 *   de clé pour hooks/use-data-errors.ts.
 * @param fetcher Exécute la requête complète (`.select().eq()...order()`) —
 *   rejouée à l'initial ET à chaque changement détecté.
 * @param onNext Reçoit le tableau de lignes à jour.
 * @param onError L'écran garde la main s'il veut afficher son propre message.
 * @param realtimeFilter Filtre Realtime Postgres (ex. `tenant_id=eq.<uuid>`).
 *   L'API Realtime de Supabase n'accepte qu'UNE seule comparaison — un filtre
 *   plus large que la vraie requête ne casse rien : `fetcher` réapplique de
 *   toute façon le filtre exact, ça ne fait que déclencher quelques
 *   rafraîchissements en plus pour des changements hors-périmètre.
 */
// Délais de nouvelle tentative après une coupure de canal (CHANNEL_ERROR /
// TIMED_OUT) — fréquentes en 4G/réseau mobile faible, pas seulement en cas
// de vraie panne. Croissant, plafonné à 30s : réessayer immédiatement en
// boucle sur un réseau durablement mauvais n'aiderait pas et gaspillerait
// de la batterie/donnée mobile.
const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

export function watch<T>(
  table: string,
  fetcher: Fetcher<T>,
  onNext: (rows: T[]) => void,
  onError?: (error: Error) => void,
  realtimeFilter?: string
): Unsubscribe {
  const key = labelOf(table);
  let closed = false;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  let hadError = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  useDataErrors.getState().registerWatcher(key);

  const runFetch = async () => {
    const { data, error } = await fetcher();
    if (closed) return;
    if (error) {
      useDataErrors.getState().reportError(key, error);
      onError?.(new Error(error.message));
      return;
    }
    useDataErrors.getState().clearError(key);
    onNext(data ?? []);
  };

  // Coalesce : plusieurs changements arrivant en rafale (ex. import en lot)
  // ne déclenchent qu'un seul rafraîchissement au lieu d'un par ligne.
  const scheduleRefetch = () => {
    if (refetchTimer) return;
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      runFetch();
    }, 150);
  };

  const channelConfig: {
    event: '*';
    schema: 'public';
    table: string;
    filter?: string;
  } = { event: '*', schema: 'public', table };
  if (realtimeFilter) channelConfig.filter = realtimeFilter;

  const openChannel = () => {
    if (closed) return;
    channel = supabase
      .channel(`watch:${table}:${realtimeFilter ?? 'all'}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', channelConfig, () => scheduleRefetch())
      .subscribe(status => {
        if (closed) return;

        if (status === 'SUBSCRIBED') {
          retryAttempt = 0;
          // Une reconnexion après coupure a pu manquer des changements
          // survenus entre-temps — on rattrape en rejouant la requête
          // complète plutôt que de faire confiance au dernier état affiché.
          if (hadError) { hadError = false; runFetch(); }
          useDataErrors.getState().clearError(key);
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          hadError = true;
          const err = new Error('Connexion temps réel interrompue');
          useDataErrors.getState().reportError(key, err);
          onError?.(err);

          // Nouvelle tentative avec délai croissant plutôt que d'abandonner
          // définitivement après un seul raté — courant en 4G/réseau
          // mobile faible, sans être une vraie panne durable.
          if (channel) { supabase.removeChannel(channel); channel = null; }
          const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
          retryAttempt++;
          retryTimer = setTimeout(openChannel, delay);
        }
      });
  };

  runFetch();
  openChannel();

  return () => {
    closed = true;
    if (refetchTimer) clearTimeout(refetchTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (channel) supabase.removeChannel(channel);
    useDataErrors.getState().unregisterWatcher(key);
  };
}
