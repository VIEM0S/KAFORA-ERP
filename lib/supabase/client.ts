import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

/**
 * Client navigateur — remplace lib/firebase/client.ts.
 *
 * La session est portee par les cookies geres automatiquement par
 * @supabase/ssr (pas de token a manipuler a la main comme avec Firebase).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}

// Instance partagee pour les composants clients qui n'ont pas besoin d'en
// recreer une a chaque rendu (meme usage que `db`/`auth` exportes par
// lib/firebase/client.ts aujourd'hui).
export const supabase = createClient();
