import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Résout l'identifiant de la caisse PERSONNELLE d'un utilisateur dans un
 * magasin, en la créant si elle n'existe pas encore.
 *
 * Avant migration 047, l'app n'avait qu'une seule caisse par magasin
 * (contrainte unique (tenant_id, store_id)), partagée par tout le monde —
 * deux caissiers avec deux tiroirs physiques distincts ne pouvaient jamais
 * avoir chacun leur propre session, et un écart de caisse devenait
 * impossible à attribuer à l'un ou l'autre. Modèle retenu (validé
 * explicitement) : attribution automatique par personne, sans écran de
 * configuration — chaque utilisateur obtient sa propre caisse auto-créée à
 * son nom, la contrainte unique porte maintenant sur
 * (tenant_id, store_id, owner_user_id).
 *
 * Les caisses créées avant cette migration (owner_user_id NULL) restent en
 * base telles quelles — jamais réutilisées par ce code, jamais en
 * collision avec les nouvelles lignes par personne (Postgres traite NULL
 * comme distinct dans un index unique).
 */
export async function resolveCashRegisterId(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  storeId: string,
  ownerUserId: string,
  ownerName?: string | null
): Promise<string> {
  const { data: existing } = await supabase
    .from('cash_registers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('store_id', storeId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('cash_registers')
    .insert({
      tenant_id: tenantId, store_id: storeId, owner_user_id: ownerUserId,
      name: ownerName?.trim() ? `Caisse de ${ownerName.trim()}` : 'Ma caisse',
    })
    .select('id')
    .single();
  if (error) {
    // Deux ouvertures concurrentes de la toute première caisse de cette
    // personne dans ce magasin : l'une des deux perd la course sur la
    // contrainte unique — pas une vraie erreur, l'autre a déjà créé la
    // ligne qu'on cherchait.
    if (error.code === '23505') {
      const { data: retry } = await supabase
        .from('cash_registers').select('id')
        .eq('tenant_id', tenantId).eq('store_id', storeId).eq('owner_user_id', ownerUserId).maybeSingle();
      if (retry) return retry.id;
    }
    throw error;
  }
  return created.id;
}

/**
 * Recherche la caisse personnelle d'un utilisateur SANS la créer — utilisé
 * pour la clôture : si cette personne n'a jamais ouvert de caisse dans ce
 * magasin, il n'y a rien à fermer, pas la peine de créer une ligne vide
 * juste pour que close_cash_register() réponde NO_OPEN_SESSION dessus.
 */
export async function findCashRegisterId(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  storeId: string,
  ownerUserId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('cash_registers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('store_id', storeId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle();
  return data?.id ?? null;
}
