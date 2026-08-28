import { create } from 'zustand';
import { describeSupabaseError, type ReadableError } from '@/lib/utils/supabase-errors';

/**
 * Registre central des erreurs de chargement de données.
 *
 * POURQUOI : chaque écran posait ses écoutes Firestore sans gestion d'erreur.
 * En cas de refus d'accès, d'index manquant ou de coupure, la page affichait
 * simplement « 0 » ou une liste vide — indiscernable d'une absence réelle de
 * données. L'erreur n'existait que dans la console du navigateur.
 *
 * Chaque écoute déclare désormais son échec ici, sous une clé qui l'identifie.
 * La mise en page affiche un bandeau unique tant qu'au moins une erreur est
 * active : un seul point d'intégration au lieu de dix-sept.
 *
 * La clé sert aussi à effacer l'erreur dès que la même écoute redevient
 * fonctionnelle — sinon un incident réseau passager laisserait un
 * avertissement affiché indéfiniment.
 */

interface DataErrorState {
  errors: Record<string, ReadableError>;
  /** Enregistre l'échec d'une écoute. */
  reportError: (key: string, err: unknown) => void;
  /** Efface l'erreur d'une écoute qui refonctionne. */
  clearError: (key: string) => void;
}

export const useDataErrors = create<DataErrorState>((set) => ({
  errors: {},

  reportError: (key, err) =>
    set(state => {
      // Journalisé aussi : le message affiché reste volontairement simple,
      // la console garde le détail technique pour le support.
      console.error(`[${key}] échec de chargement`, err);
      return { errors: { ...state.errors, [key]: describeSupabaseError(err) } };
    }),

  clearError: (key) =>
    set(state => {
      if (!state.errors[key]) return state; // évite un rendu inutile
      const next = { ...state.errors };
      delete next[key];
      return { errors: next };
    }),
}));

/**
 * Fabrique les deux fonctions à passer à `onSnapshot` pour une écoute donnée.
 *
 * Usage :
 *   const [ok, ko] = snapshotHandlers('inventaire', snap => { ... });
 *   onSnapshot(q, ok, ko);
 *
 * Le succès efface automatiquement une éventuelle erreur précédente.
 */
export function snapshotHandlers<T>(
  key: string,
  onData: (snap: T) => void
): [(snap: T) => void, (err: unknown) => void] {
  const { reportError, clearError } = useDataErrors.getState();
  return [
    (snap: T) => {
      clearError(key);
      onData(snap);
    },
    (err: unknown) => reportError(key, err),
  ];
}
