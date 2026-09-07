/**
 * Extrait un message lisible d'une erreur attrapée, quelle que soit sa forme.
 *
 * POURQUOI CE FICHIER EXISTE : `error instanceof Error ? error.message : X`
 * est le piège classique avec Supabase/PostgREST — une erreur renvoyée par
 * `.rpc()` ou `.from(...).select()` est un objet simple ({code, details,
 * hint, message}), PAS une instance de la classe `Error` native. Le test
 * `instanceof Error` échoue donc silencieusement pour ces erreurs-là, et le
 * message métier réel (ex. "FORBIDDEN: Vous ne pouvez pas valider votre
 * propre demande...") est perdu au profit d'un message générique — trouvé en
 * auditant app/api/credits/write-off/approve/route.ts (whoami/self-approval
 * check invisible à l'utilisateur, remplacé par "Erreur lors de la
 * validation"). Même piège présent dans 16 autres routes API à l'audit.
 */
export function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return undefined;
}
