-- CORRECTIF DE SÉCURITÉ CRITIQUE, trouvé lors d'un audit post-migration.
--
-- Chaque RPC transactionnelle (pos_checkout, close_cash_register, etc.)
-- avait bien un `revoke execute ... from public` à la fin de sa propre
-- migration — mais Postgres/Supabase leur avait AUSSI accordé EXECUTE
-- directement à `anon` et `authenticated`, séparément de PUBLIC. Revoke sur
-- PUBLIC ne retire jamais un droit accordé nommément à un rôle précis :
-- ces fonctions restaient donc appelables en direct via
-- /rest/v1/rpc/<nom_fonction>, y compris par un visiteur non connecté
-- (rôle anon, authentifié seulement avec la clé publique intégrée à
-- chaque page).
--
-- Gravité : ces fonctions sont SECURITY DEFINER (contournent RLS) et ne
-- vérifient PAS l'identité de l'appelant — pos_checkout par exemple fait
-- confiance à p_tenant_id/p_cashier_id tels quels. N'importe qui pouvait
-- donc, sans jamais se connecter, fabriquer des ventes, décrémenter du
-- stock réel, créer des crédits ou modifier des abonnements pour
-- N'IMPORTE QUEL tenant. Confirmé en direct : `select grantee from
-- information_schema.role_routine_grants where routine_name =
-- 'pos_checkout'` renvoyait bien anon ET authenticated.
--
-- Chacune de ces fonctions n'est appelée que depuis les routes API
-- Next.js via le client service-role (voir lib/supabase/server.ts) —
-- jamais depuis le navigateur — donc aucun rôle client n'a besoin d'y
-- accéder directement.
revoke execute on function admin_extend_subscription(
  uuid, integer, subscription_plan, numeric, text, text, uuid, integer, jsonb
) from anon, authenticated;

revoke execute on function aggregate_daily_stats(integer) from anon, authenticated;
revoke execute on function aggregate_daily_stats_for_day(date) from anon, authenticated;

revoke execute on function cancel_sale(uuid, uuid, uuid, text) from anon, authenticated;

revoke execute on function close_cash_register(
  uuid, uuid, uuid, uuid, text, numeric, text
) from anon, authenticated;

revoke execute on function create_purchase_order(
  uuid, uuid, uuid, purchase_order_status, text, timestamptz, uuid, text, jsonb
) from anon, authenticated;

revoke execute on function create_sale_return(
  uuid, uuid, uuid, text, text, refund_method, jsonb
) from anon, authenticated;

revoke execute on function decide_transfer(uuid, uuid, uuid, text, text) from anon, authenticated;

revoke execute on function open_cash_register(
  uuid, uuid, uuid, uuid, text, numeric
) from anon, authenticated;

revoke execute on function pos_checkout(
  uuid, uuid, uuid, uuid, text, text, payment_method, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, boolean, text, uuid, text, jsonb
) from anon, authenticated;

revoke execute on function receive_purchase_order(uuid, uuid, uuid, jsonb) from anon, authenticated;
revoke execute on function receive_transfer(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function ship_transfer(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function set_tenant_status(uuid, boolean, text, uuid) from anon, authenticated;

-- repay_credit est le SEUL cas voulu où une RPC transactionnelle est
-- appelée directement depuis le navigateur (voir migration 029) — elle
-- fait ses propres vérifications d'autorisation en interne
-- (can_write/is_manager/can_access_store, auth.uid() pour l'auteur réel).
-- On ne retire donc que anon (jamais un visiteur non connecté), on
-- garde authenticated tel que déjà accordé explicitement en 029.
revoke execute on function repay_credit(uuid, numeric, uuid, text) from anon;

-- Trouvé par le même audit (linter Supabase, niveau WARN) : cette fonction
-- de trigger n'avait pas de search_path fixe, donc théoriquement
-- détournable en changeant le search_path de la session — correctif
-- standard à coût nul pour toute fonction SECURITY DEFINER/trigger.
alter function set_updated_at() set search_path = public;
