/**
 * Agrégation quotidienne des ventes — fonction planifiée Netlify.
 *
 * Portage Supabase (Phase 6 du plan de migration) : toute la logique
 * d'agrégation (revenu, coût réel, marge, top produits, répartitions par
 * paiement/magasin/catégorie) vit maintenant dans une RPC SQL,
 * aggregate_daily_stats() — voir supabase/migrations. Cette fonction
 * Netlify n'est plus qu'un déclencheur planifié qui l'appelle.
 *
 * Avant (Firestore) : trois requêtes par tenant (ventes, cost_summary,
 * sale_items via collectionGroup), agrégées à la main en JS, avec un budget
 * de 25s à surveiller pour rester sous la limite de 30s des fonctions
 * planifiées Netlify. La RPC Postgres traite TOUS les tenants d'une journée
 * en une seule requête ensembliste (GROUP BY) — plus de boucle, plus de
 * limite de temps à gérer ici.
 *
 * FUSEAU HORAIRE : le Mali est à UTC+0 toute l'année (pas d'heure d'été),
 * donc une journée UTC correspond exactement à une journée locale — géré
 * côté SQL (voir aggregate_daily_stats_for_day).
 */

import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: Request) {
  const started = Date.now();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Configuration Supabase manquante (URL ou clé de service)', { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Par défaut on traite la veille (journée complète). `?days=N` permet de
  // rattraper N journées à la main depuis le bouton "Run now" de Netlify.
  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get('days') || '1');
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 30) : 1;

  const { data, error } = await supabase.rpc('aggregate_daily_stats', { p_days: days });

  if (error) {
    const summary = `Échec de l'agrégation : ${error.message}`;
    console.error(summary);
    return new Response(summary, { status: 500 });
  }

  const result = data as unknown as { success: boolean; written: number; days: number };
  const summary = `${result.written} agrégat(s) écrit(s) sur ${result.days} jour(s), ${Date.now() - started} ms`;
  console.log(summary);
  return new Response(summary, { status: 200 });
}

export const config: Config = {
  // 02h00 UTC : la journée précédente est terminée partout au Mali, et le
  // trafic est nul — aucune vente en cours ne risque d'être comptée à moitié.
  schedule: '0 2 * * *',
};
