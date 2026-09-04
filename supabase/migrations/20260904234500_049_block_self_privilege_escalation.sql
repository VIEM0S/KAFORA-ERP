-- CRITIQUE : users_update (migration 007) autorise `auth.uid() = id` (un
-- utilisateur peut modifier SA PROPRE ligne, pensé pour les changements de
-- profil comme nom/téléphone) mais son WITH CHECK ne revérifie que
-- belongs_to_tenant(tenant_id) — aucune colonne n'est protégée pour cette
-- branche. Prouvé en direct par simulation de rôle : un CASHIER authentifié
-- peut, avec le client Supabase déjà présent dans le navigateur (sans
-- passer par aucune route API), faire
--   update users set role = 'OWNER', store_ids = null where id = auth.uid()
-- et ça passe RLS. Au prochain /api/auth/login, cette ligne devient le JWT
-- (role/store_ids resynchronisés depuis la table, migration 006/route de
-- login) — l'utilisateur devient Owner de son tenant, ce qui rend caduque
-- absolument toute vérification de rôle serveur auditée par ailleurs cette
-- session (write-off, caisse, gestion des utilisateurs...).
--
-- Correctif : un trigger BEFORE UPDATE, pas seulement une policy RLS — un
-- trigger s'applique aussi si une future policy est mal réécrite, et reste
-- la protection même si RLS est un jour désactivée par erreur sur cette
-- table. La route API légitime (/api/users/update) écrit via le client
-- service-role (RLS bypassée par Postgres, mais PAS les triggers) après
-- avoir déjà validé les permissions en TypeScript — on l'exempte donc
-- explicitement en tête de fonction, sinon ses propres écritures légitimes
-- seraient bloquées faute de JWT/rôle applicatif dans ce contexte.
create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if (new.role is distinct from old.role
      or new.store_ids is distinct from old.store_ids
      or new.is_active is distinct from old.is_active
      or new.deleted_at is distinct from old.deleted_at
      or new.tenant_id is distinct from old.tenant_id)
     and not (
       is_owner()
       or (is_owner_or_admin() and old.role <> 'ADMIN' and new.role <> 'ADMIN')
       or (is_regional_manager() and old.role in ('MANAGER','CASHIER') and new.role in ('MANAGER','CASHIER')
           and old.store_ids <@ auth_store_ids() and new.store_ids <@ auth_store_ids())
     )
  then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission de modifier le rôle, les magasins ou le statut de ce compte';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_prevent_self_privilege_escalation on public.users;
create trigger trg_prevent_self_privilege_escalation
  before update on public.users
  for each row
  execute function public.prevent_self_privilege_escalation();
