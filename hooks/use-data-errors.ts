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
  // Plusieurs écoutes peuvent partager la même clé lisible (ex. "Crédits"
  // pour credits ET credit_payments, ou une écoute globale dans le header
  // en plus de celle d'une page précise) — voir registerWatcher plus bas.
  activeWatchers: Record<string, number>;
  /** Enregistre l'échec d'une écoute. */
  reportError: (key: string, err: unknown) => void;
  /** Efface l'erreur d'une écoute qui refonctionne. */
  clearError: (key: string) => void;
  /** Une écoute démarre — voir lib/supabase/watch.ts. */
  registerWatcher: (key: string) => void;
  /**
   * Une écoute s'arrête (page quittée). Efface l'erreur SEULEMENT si plus
   * aucune autre écoute active ne partage cette clé — sinon quitter une
   * page effacerait à tort l'erreur d'une écoute globale (le badge du
   * header par exemple) encore bien réelle sur une autre.
   */
  unregisterWatcher: (key: string) => void;
}

export const useDataErrors = create<DataErrorState>((set) => ({
  errors: {},
  activeWatchers: {},

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

  registerWatcher: (key) =>
    set(state => ({ activeWatchers: { ...state.activeWatchers, [key]: (state.activeWatchers[key] ?? 0) + 1 } })),

  unregisterWatcher: (key) =>
    set(state => {
      const count = (state.activeWatchers[key] ?? 1) - 1;
      const activeWatchers = { ...state.activeWatchers };
      if (count > 0) activeWatchers[key] = count; else delete activeWatchers[key];
      if (count > 0 || !state.errors[key]) return { activeWatchers };
      const errors = { ...state.errors };
      delete errors[key];
      return { activeWatchers, errors };
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
