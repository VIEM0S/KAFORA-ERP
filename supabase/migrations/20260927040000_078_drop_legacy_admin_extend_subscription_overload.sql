-- create or replace function avec une signature à 11 paramètres (migration
-- 075) n'a PAS remplacé l'ancienne version à 9 paramètres (migration 059) —
-- en Postgres, un nombre de paramètres différent crée un nouveau surcharge
-- (overload) au lieu de remplacer l'existant. Confirmé après coup : les
-- deux versions coexistaient, ce qui rend tout appel de la RPC sans les 2
-- nouveaux paramètres nommés ambigu ("Could not choose the best candidate
-- function"). L'ancienne version est strictement obsolète (la nouvelle,
-- avec p_promo_code_id/p_catalog_price par défaut à null, couvre exactement
-- les mêmes appels) — supprimée pour ne garder qu'une seule définition.
drop function if exists admin_extend_subscription(
  uuid, integer, subscription_plan, numeric, text, text, uuid, integer, jsonb
);
