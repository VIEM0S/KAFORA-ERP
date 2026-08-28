-- Fixe le search_path (mutable = vecteur de detournement si un appelant
-- manipule search_path avant d'invoquer la fonction) sur toutes les
-- fonctions d'autorisation.
alter function auth_tenant_id() set search_path = public, auth;
alter function auth_role() set search_path = public, auth;
alter function auth_store_ids() set search_path = public, auth;
alter function can_access_store(uuid) set search_path = public, auth;
alter function is_owner() set search_path = public, auth;
alter function is_owner_or_admin() set search_path = public, auth;
alter function is_regional_manager() set search_path = public, auth;
alter function is_manager() set search_path = public, auth;
alter function belongs_to_tenant(uuid) set search_path = public, auth;
alter function subscription_active(uuid) set search_path = public, auth;
alter function can_write(uuid) set search_path = public, auth;

-- pg_trgm ne doit pas vivre dans le schema public.
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
