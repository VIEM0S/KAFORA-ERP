/**
 * Traduit une erreur Supabase (PostgREST ou Realtime) en message lisible par
 * un commerçant. Remplace lib/utils/firestore-errors.ts — même contrat
 * (`ReadableError`), pour que hooks/use-data-errors.ts n'ait rien à changer.
 *
 * POURQUOI CE FICHIER EXISTE ENCORE : les écoutes temps réel étaient posées
 * sans gestion d'erreur avant lib/firebase/watch.ts. En cas de refus RLS ou
 * de coupure, la page restait simplement VIDE — indiscernable d'une absence
 * réelle de données. Une page vide et une page en erreur doivent se
 * distinguer : la première signifie « il n'y a rien », la seconde « je n'ai
 * pas pu regarder ».
 */

export interface ReadableError {
  /** Message destiné au commerçant. */
  message: string;
  /** Piste technique, affichée en petit pour le support. */
  hint?: string;
}

export function describeSupabaseError(err: unknown): ReadableError {
  const code = (err as { code?: string })?.code || '';
  const raw = (err as { message?: string })?.message || '';

  // RLS refuse la ligne : code Postgres 42501 (insufficient_privilege), ou
  // PostgREST journalise parfois la policy dans le message plutôt que le
  // code selon la version.
  if (code === '42501' || /row-level security/i.test(raw)) {
    return {
      message: "Vous n'avez pas accès à ces données pour ce magasin.",
      hint: 'Vérifiez votre affectation de magasin, puis déconnectez-vous et reconnectez-vous pour rafraîchir vos droits.',
    };
  }

  // JWT expiré côté PostgREST.
  if (code === 'PGRST301' || /jwt expired/i.test(raw)) {
    return {
      message: 'Votre session a expiré. Reconnectez-vous.',
    };
  }

  // Échec réseau (fetch natif) ou canal Realtime interrompu.
  if (/failed to fetch/i.test(raw) || /channel_error|timed_out/i.test(code + raw)) {
    return {
      message: 'Connexion interrompue. Les données affichées peuvent être incomplètes.',
      hint: 'Vérifiez votre connexion internet ; la page se mettra à jour automatiquement au rétablissement.',
    };
  }

  return {
    message: 'Impossible de charger ces données pour le moment.',
    hint: raw || code || undefined,
  };
}
