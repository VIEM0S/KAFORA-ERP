/**
 * Unicité des SKU.
 *
 * Firestore n'a pas de contrainte d'unicité. On la reconstitue avec une
 * collection de réservation : `tenants/{tid}/product_skus/{clé}`, où la clé
 * dérive du SKU. Créer un produit et réserver son SKU se font dans un même
 * lot d'écriture ; si la réservation existe déjà, la règle Firestore refuse
 * la création et **tout le lot est annulé** — le produit n'est pas créé.
 *
 * C'est plus solide qu'une vérification « je regarde si le SKU existe, puis
 * j'écris » : entre les deux, quelqu'un d'autre a pu créer le même SKU. Ici,
 * c'est la base qui arbitre, pas le code.
 *
 * Pourquoi ça compte : deux produits avec le même SKU, c'est un scan
 * code-barres qui tombe sur le mauvais article, un inventaire faux, et des
 * marges calculées sur le mauvais prix d'achat.
 */

/**
 * Clé de document dérivée du SKU.
 *
 * - insensible à la casse et aux espaces : « abc-1 » et « ABC-1 » sont le
 *   même référencement pour un commerçant, il ne doit pas pouvoir créer les
 *   deux ;
 * - caractères interdits par Firestore dans un identifiant (« / » notamment)
 *   remplacés, sinon l'écriture échouerait sur un SKU pourtant valide.
 */
export function skuKey(sku: string): string {
  const cleaned = sku
    .trim()
    .toUpperCase()
    .replace(/[/\\.#$[\]]/g, '_');
  // Firestore rejette les identifiants encadrés de doubles underscores.
  return cleaned.replace(/^__+|__+$/g, '_');
}

/** Un SKU vide n'est pas réservé : le champ reste facultatif. */
export function hasSku(sku: string | null | undefined): boolean {
  return Boolean(sku && sku.trim());
}
