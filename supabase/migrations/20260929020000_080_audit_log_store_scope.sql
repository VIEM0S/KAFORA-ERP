-- audit_log (gouvernance credits/depenses/inventaires, migration 045)
-- n'a jamais eu de filtrage par magasin sur sa policy SELECT, contrairement
-- a toutes les tables similaires (cash_sessions, purchase_orders,
-- sale_cost_summary, payments corrigees en migration 039 ; inventory_movements
-- en 046). Trouve lors de l'audit du 2026-09-29.
--
-- is_manager() est vrai pour OWNER, ADMIN, REGIONAL_MANAGER ET MANAGER — un
-- MANAGER cantonne a un seul magasin (auth_store_ids() non nul) pouvait donc
-- lire, via un appel direct au client Supabase (pas seulement l'ecran
-- app/(dashboard)/audit-log/page.tsx, qui lui est deja reserve aux
-- Owner/Admin cote UI), les entrees EXPENSE_*/STOCKTAKE_* de TOUS les
-- magasins de l'entreprise, alors que expenses/stocktakes elles-memes sont
-- correctement cloisonnees par magasin.
--
-- store_id is null reste autorise : les entrees CREDIT_* n'ont pas de
-- store_id (les credits sont tenant-wide par design, modele "agence
-- bancaire") et doivent rester visibles a tout Manager du tenant.
drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log for select
  using (belongs_to_tenant(tenant_id) and is_manager() and (store_id is null or can_access_store(store_id)));
