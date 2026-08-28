import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Résout l'identifiant de LA caisse d'un magasin, en la créant si elle
 * n'existe pas encore. L'app n'a jamais eu qu'une seule caisse par magasin
 * (contrainte unique (tenant_id, store_id) — voir migration 035) : le
 * client ne choisit jamais d'identifiant, contrairement à l'ancien état
 * RTDB qui vivait sous une clé synthétique `register_${storeId}`.
 */
export async function resolveCashRegisterId(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  storeId: string
): Promise<string> {
  const { data: existing } = await supabase
    .from('cash_registers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('cash_registers')
    .insert({ tenant_id: tenantId, store_id: storeId, name: 'Caisse principale' })
    .select('id')
    .single();
  if (error) {
    // Deux ouvertures concurrentes de la toute première caisse d'un magasin :
    // l'une des deux perd la course sur la contrainte unique — pas une vraie
    // erreur, l'autre a déjà créé la ligne qu'on cherchait.
    if (error.code === '23505') {
      const { data: retry } = await supabase
        .from('cash_registers').select('id')
        .eq('tenant_id', tenantId).eq('store_id', storeId).maybeSingle();
      if (retry) return retry.id;
    }
    throw error;
  }
  return created.id;
}
