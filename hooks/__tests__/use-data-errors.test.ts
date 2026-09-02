import { describe, it, expect, beforeEach } from 'vitest';
import { useDataErrors } from '../use-data-errors';

describe('useDataErrors', () => {
  beforeEach(() => {
    // Store partagé entre tests — repart à zéro à chaque fois.
    useDataErrors.setState({ errors: {}, activeWatchers: {} });
  });

  it('enregistre puis efface une erreur', () => {
    useDataErrors.getState().reportError('Crédits', new Error('boom'));
    expect(useDataErrors.getState().errors['Crédits']).toBeDefined();
    useDataErrors.getState().clearError('Crédits');
    expect(useDataErrors.getState().errors['Crédits']).toBeUndefined();
  });

  it(
    "ne supprime PAS l'erreur au démontage d'une écoute si une autre écoute " +
      'active partage la même clé (ex. header global + page Crédits)',
    () => {
      const { registerWatcher, unregisterWatcher, reportError } = useDataErrors.getState();
      registerWatcher('Crédits'); // écoute globale du header
      registerWatcher('Crédits'); // écoute de la page Crédits
      reportError('Crédits', new Error('Connexion temps réel interrompue'));

      // La page Crédits est quittée : son écoute se démonte, mais celle du
      // header reste active — l'erreur doit rester visible.
      unregisterWatcher('Crédits');
      expect(useDataErrors.getState().errors['Crédits']).toBeDefined();

      // Le header se démonte aussi (ex. déconnexion) : plus aucune écoute
      // active pour cette clé, l'erreur peut enfin disparaître.
      unregisterWatcher('Crédits');
      expect(useDataErrors.getState().errors['Crédits']).toBeUndefined();
    }
  );

  it("n'efface rien au démontage si aucune erreur n'était active pour cette clé", () => {
    const { registerWatcher, unregisterWatcher } = useDataErrors.getState();
    registerWatcher('Produits');
    unregisterWatcher('Produits');
    expect(useDataErrors.getState().errors['Produits']).toBeUndefined();
    expect(useDataErrors.getState().activeWatchers['Produits']).toBeUndefined();
  });
});
