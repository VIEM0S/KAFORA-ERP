/**
 * Traduit une erreur Firestore en message lisible par un commerçant.
 *
 * POURQUOI : les écoutes temps réel étaient posées sans gestion d'erreur. En
 * cas de refus ou d'index manquant, la page restait simplement VIDE — « 0
 * vente », « Aucun résultat » — alors que les données existaient. L'erreur
 * n'apparaissait que dans la console du navigateur, que personne n'ouvre.
 *
 * Une page vide et une page en erreur doivent se distinguer : la première
 * signifie « il n'y a rien », la seconde « je n'ai pas pu regarder ». Les
 * confondre fait chercher un problème de données là où il n'y en a pas.
 */

export interface ReadableError {
  /** Message destiné au commerçant. */
  message: string;
  /** Piste technique, affichée en petit pour le support. */
  hint?: string;
}

export function describeFirestoreError(err: unknown): ReadableError {
  const code = (err as { code?: string })?.code || '';
  const raw = (err as { message?: string })?.message || '';

  if (code.includes('permission-denied')) {
    return {
      message: "Vous n'avez pas accès à ces données pour ce magasin.",
      hint: 'Vérifiez votre affectation de magasin, puis déconnectez-vous et reconnectez-vous pour rafraîchir vos droits.',
    };
  }

  if (code.includes('failed-precondition')) {
    return {
      message: 'Cette liste ne peut pas être affichée : une configuration de base de données est manquante.',
      // Firestore joint un lien de création d'index dans le message brut :
      // il est bien plus utile au support que le code d'erreur.
      hint: raw.includes('http') ? raw : 'Index Firestore manquant.',
    };
  }

  if (code.includes('unavailable') || code.includes('deadline-exceeded')) {
    return {
      message: 'Connexion interrompue. Les données affichées peuvent être incomplètes.',
      hint: 'Vérifiez votre connexion internet ; la page se mettra à jour automatiquement au rétablissement.',
    };
  }

  if (code.includes('unauthenticated')) {
    return {
      message: 'Votre session a expiré. Reconnectez-vous.',
    };
  }

  return {
    message: "Impossible de charger ces données pour le moment.",
    hint: raw || code || undefined,
  };
}
