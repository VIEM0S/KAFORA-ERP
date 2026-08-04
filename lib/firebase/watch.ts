import {
  onSnapshot as firestoreOnSnapshot,
  type DocumentSnapshot,
  type DocumentData,
  type Query,
  type QuerySnapshot,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore';
import { useDataErrors } from '@/hooks/use-data-errors';

/**
 * `onSnapshot` avec remontée automatique des erreurs.
 *
 * POURQUOI CE MODULE : quarante écoutes Firestore étaient posées sans
 * gestionnaire d'erreur. En cas de refus d'accès, d'index manquant ou de
 * coupure réseau, l'écoute mourait en silence : la page restait vide et le
 * commerçant concluait à une absence de données là où il y avait un problème
 * technique. C'est exactement ce qui a masqué un index non déployé pendant
 * des jours — l'écran annonçait « 0 vente » alors que neuf ventes existaient.
 *
 * Plutôt que d'ajouter un gestionnaire à chacun des quarante appels — long et
 * risqué —, les écrans importent `onSnapshot` D'ICI au lieu de
 * `firebase/firestore`. Une seule ligne change par fichier, et tout échec
 * remonte au bandeau global de la mise en page.
 *
 * Un gestionnaire d'erreur explicite reste prioritaire : les écrans qui en
 * ont déjà un (ventes, factures) gardent leur affichage local.
 */

/** Déduit un libellé lisible depuis la référence écoutée. */
function labelOf(ref: unknown): string {
  try {
    const direct = (ref as { path?: string }).path;
    if (typeof direct === 'string' && direct) return lastSegment(direct);

    // Les objets Query n'exposent pas `path` publiquement ; on tente la
    // structure interne, sans jamais laisser une erreur remonter d'ici.
    const segments = (ref as { _query?: { path?: { segments?: string[] } } })
      ._query?.path?.segments;
    if (Array.isArray(segments) && segments.length > 0) {
      return lastSegment(segments.join('/'));
    }
  } catch {
    // ignoré volontairement
  }
  return 'Données';
}

/** Dernier segment du chemin, en libellé lisible. */
function lastSegment(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const name = parts[parts.length - 1] || 'Données';
  const LIBELLES: Record<string, string> = {
    sales: 'Ventes',
    products: 'Produits',
    inventory: 'Inventaire',
    inventory_movements: 'Mouvements de stock',
    customers: 'Clients',
    credits: 'Crédits',
    suppliers: 'Fournisseurs',
    stores: 'Magasins',
    categories: 'Catégories',
    quotes: 'Devis',
    purchase_orders: 'Bons de commande',
    transfers: 'Transferts',
    alerts: 'Alertes',
    daily_stats: 'Statistiques',
    cash_sessions: 'Sessions de caisse',
    sale_returns: 'Retours',
  };
  return LIBELLES[name] || name;
}

/**
 * Signature volontairement permissive : `onSnapshot` accepte aussi bien une
 * requête qu'une référence de document, et les types Firestore ne se
 * combinent pas simplement en surcharge. Le typage est donc assoupli ICI,
 * dans un module unique et court, plutôt que dans chaque écran.
 */
export function onSnapshot(
  reference: Query<DocumentData> | DocumentReference<DocumentData>,
  onNext: (snapshot: QuerySnapshot<DocumentData> & DocumentSnapshot<DocumentData>) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const key = labelOf(reference);

  const handleNext = (snap: unknown) => {
    // Une écoute qui refonctionne efface son erreur : sinon une coupure
    // passagère laisserait un avertissement affiché indéfiniment.
    useDataErrors.getState().clearError(key);
    (onNext as unknown as (s: unknown) => void)(snap);
  };

  const handleError = (err: Error) => {
    useDataErrors.getState().reportError(key, err);
    // L'écran garde la main s'il veut afficher son propre message.
    onError?.(err);
  };

  return firestoreOnSnapshot(
    reference as Query<DocumentData>,
    handleNext as (s: QuerySnapshot<DocumentData>) => void,
    handleError
  );
}
