import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from './database.types';

/**
 * Client serveur "scope requete" — remplace la lecture manuelle du cookie
 * `__session` + adminAuth.verifySessionCookie() de proxy.ts/chaque route.
 *
 * getUser() fait une VRAIE verification cryptographique aupres du serveur
 * Supabase Auth (contrairement a getSession(), qui fait confiance au cookie
 * sans aller verifier) — a utiliser partout, jamais getSession() cote serveur.
 * Respecte les politiques RLS : les requetes passees par ce client ne voient
 * que ce que l'utilisateur authentifie a le droit de voir.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Appele depuis un Server Component (lecture seule) : proxy.ts
            // se charge deja de rafraichir la session sur chaque requete,
            // cet appel peut donc echouer sans consequence ici.
          }
        },
      },
    }
  );
}

/**
 * Client service-role — remplace adminDb/adminAuth de lib/firebase/admin.ts.
 *
 * Contourne RLS et Firebase Auth Admin SDK equivalent (creation de comptes,
 * app_metadata, etc.) : reserve aux operations serveur qui doivent agir avec
 * des privileges eleves (inscription, checkout, actions du super-admin...),
 * jamais expose au client. Ne PAS utiliser pour de simples lectures/ecritures
 * qui doivent respecter les droits de l'utilisateur courant — dans ce cas,
 * utiliser createServerSupabaseClient().
 */
export function createServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY manquant dans .env');
  }
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
