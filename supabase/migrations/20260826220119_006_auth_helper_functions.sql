-- Reproduit le contrat de custom claims Firebase { tenantId, role, storeIds }
-- porte par app_metadata du JWT Supabase Auth (jamais editable par le client).

create or replace function auth_tenant_id() returns uuid
language sql stable
as $$
  select nullif(auth.jwt()->'app_metadata'->>'tenant_id','')::uuid
$$;

create or replace function auth_role() returns text
language sql stable
as $$
  select auth.jwt()->'app_metadata'->>'role'
$$;

create or replace function auth_store_ids() returns uuid[]
language sql stable
as $$
  select case
    when auth.jwt()->'app_metadata'->'store_ids' is null
      or auth.jwt()->'app_metadata'->'store_ids' = 'null'::jsonb
    then null
    else array(select jsonb_array_elements_text(auth.jwt()->'app_metadata'->'store_ids'))::uuid[]
  end
$$;

-- null = acces a tous les magasins (equivalent storeIds:null cote Firebase).
create or replace function can_access_store(sid uuid) returns boolean
language sql stable
as $$
  select auth_store_ids() is null or sid = any(auth_store_ids())
$$;

create or replace function is_owner() returns boolean
language sql stable
as $$
  select auth_role() = 'OWNER'
$$;

create or replace function is_owner_or_admin() returns boolean
language sql stable
as $$
  select auth_role() in ('OWNER','ADMIN')
$$;

create or replace function is_regional_manager() returns boolean
language sql stable
as $$
  select auth_role() = 'REGIONAL_MANAGER'
$$;

create or replace function is_manager() returns boolean
language sql stable
as $$
  select auth_role() in ('OWNER','ADMIN','REGIONAL_MANAGER','MANAGER')
$$;

create or replace function belongs_to_tenant(tid uuid) returns boolean
language sql stable
as $$
  select auth.uid() is not null and auth_tenant_id() = tid
$$;

-- Permissif par defaut : abonnement introuvable ou champ absent => ecriture
-- autorisee (meme politique que subDocAllows() dans firestore.rules — cf.
-- lib/subscription/status.ts). La tolerance specifique au POS (3 jours de
-- plus) N'EST PAS ici : elle reste un controle applicatif explicite dans la
-- RPC de checkout, voir plan de migration.
create or replace function subscription_active(tid uuid) returns boolean
language sql stable
as $$
  select not exists (
    select 1 from subscriptions s
    where s.tenant_id = tid
      and (s.status in ('CANCELLED','EXPIRED')
           or (s.write_blocked_at is not null and now() >= s.write_blocked_at))
  )
$$;

create or replace function can_write(tid uuid) returns boolean
language sql stable
as $$
  select belongs_to_tenant(tid) and subscription_active(tid)
$$;
