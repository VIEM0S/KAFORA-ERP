/**
 * Cloisonnement du rôle REGIONAL_MANAGER.
 *
 * Contrairement à OWNER/ADMIN (portée tenant entière), un REGIONAL_MANAGER
 * ne gère que les utilisateurs de SES magasins — jamais l'ensemble du tenant,
 * jamais un compte ADMIN/OWNER/REGIONAL_MANAGER. Utilisé par
 * /api/users/create et /api/users/update.
 */

/** Rôles qu'un REGIONAL_MANAGER peut assigner ou modifier — jamais lui-même,
 *  jamais ADMIN/OWNER. */
export const REGIONAL_MANAGER_ASSIGNABLE_ROLES = ['MANAGER', 'CASHIER'] as const;

/**
 * `a` est-il entièrement contenu dans `b` ?
 *
 * Un tableau vide ou absent n'est JAMAIS un sous-ensemble valide ici : un
 * REGIONAL_MANAGER sans magasin assigné (storeIds null/vide) ne doit pouvoir
 * toucher aucun compte, pas "tous les comptes sans magasin" — ce serait
 * l'inverse de l'intention (cloisonner, pas ouvrir un cas par défaut permissif).
 */
export function isSubsetOf(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (!Array.isArray(a) || a.length === 0) return false;
  if (!Array.isArray(b) || b.length === 0) return false;
  return a.every(id => b.includes(id));
}
