/**
 * Vérifications de rôle côté interface.
 *
 * Ces helpers existent pour une raison précise : les contrôles étaient
 * écrits en dur un peu partout sous la forme
 * `['OWNER', 'ADMIN', 'MANAGER'].includes(role)`, et SUPER_ADMIN — le rôle
 * éditeur — n'apparaissait dans AUCUNE de ces listes. Résultat : se
 * promouvoir faisait perdre l'accès au tableau de bord, à la caisse, à la
 * gestion des utilisateurs, avec des redirections inexplicables.
 *
 * SUPER_ADMIN est traité comme couvrant tous les autres rôles, ce qui est
 * cohérent avec ROLE_PERMISSIONS (toutes ses permissions sont à true).
 *
 * Ce sont des helpers d'AFFICHAGE. Ils décident de ce que l'utilisateur voit,
 * jamais de ce qu'il a le droit de faire : l'autorisation réelle est
 * contrôlée côté serveur (routes API) et dans firestore.rules.
 */

export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

/** Propriétaire ou administrateur — gestion des utilisateurs, magasins, réglages. */
export function isOwnerOrAdmin(role: string | null | undefined): boolean {
  return isSuperAdmin(role) || ['OWNER', 'ADMIN'].includes(role || '');
}

/** Responsable et au-dessus — chiffres, rapports, historiques. */
export function isManagerPlus(role: string | null | undefined): boolean {
  return isSuperAdmin(role) || ['OWNER', 'ADMIN', 'MANAGER'].includes(role || '');
}
