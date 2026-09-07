import { createClient } from '@supabase/supabase-js';

/**
 * Client service-role pour la préparation/nettoyage des données de test —
 * jamais utilisé pour piloter l'app elle-même (ça, c'est le rôle de Playwright
 * qui clique dans le vrai navigateur avec la vraie session E2E). Contourne
 * volontairement RLS : un test doit pouvoir poser un état de départ précis
 * (ex. "ce produit a exactement 10 en stock") sans dépendre d'un autre écran.
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes (voir .env).');
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export const TENANT_ID = process.env.E2E_TENANT_ID || '6ba35d5b-bc8c-49c8-88b8-e2f69d325c5a';
export const STORE_ID = process.env.E2E_STORE_ID || 'b1a0ea3b-b139-4fc8-bf16-be184a23f2a1';

/** Nom+téléphone uniques par run pour ne jamais entrer en collision entre exécutions. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
