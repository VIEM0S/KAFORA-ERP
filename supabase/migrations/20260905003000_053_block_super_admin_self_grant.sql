-- CRITIQUE, trouvé en revérifiant le trigger de la migration 049
-- (prevent_self_privilege_escalation) contre TOUTES les valeurs possibles
-- de user_role, pas seulement le cas Caissier→Owner déjà testé.
--
-- SUPER_ADMIN est une valeur valide de l'enum user_role, mais n'est censée
-- vivre QUE dans la table super_admins séparée (voir app/api/auth/login/
-- route.ts : un utilisateur avec une ligne dans public.users ne prend
-- JAMAIS la branche SUPER_ADMIN, qui n'existe que pour un compte SANS
-- ligne dans public.users). Aucun code applicatif n'écrit jamais
-- role = 'SUPER_ADMIN' dans public.users.
--
-- Or la policy users_update (migration 007), branche is_owner(), autorise
-- un Owner à modifier N'IMPORTE QUELLE ligne de son tenant (y compris la
-- sienne) SANS aucune restriction sur la valeur cible de `role` — et le
-- trigger de la migration 049 corrige seulement le cas où l'appelant
-- s'auto-modifie SANS être déjà l'un des rôles habilités, jamais la
-- valeur cible elle-même. Confirmé en direct :
--   update users set role = 'SUPER_ADMIN' where id = <un Owner>
-- passait RLS ET le trigger 049 (is_owner() est vrai, donc la garde
-- passe). Au prochain /api/auth/login, ce compte devient un vrai
-- SUPER_ADMIN dans son JWT : accès à /api/admin/tenant-users (liste des
-- utilisateurs de N'IMPORTE QUEL tenant + génération de liens de
-- réinitialisation de mot de passe pour N'IMPORTE QUEL compte client),
-- /api/admin/tenants, /api/admin/tenant-status, /api/admin/subscription.
-- Un simple Propriétaire d'un tenant payant — pas un rôle bas de gamme,
-- le compte que possède déjà chaque client — pouvait donc prendre le
-- contrôle de la plateforme entière. Plus grave que la faille Caissier→
-- Owner de la migration 049, dont elle partage la cause racine (aucune
-- des branches "légitimes" du trigger ne limite la valeur CIBLE de role).
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

  -- Aucun chemin authentifié ne doit jamais pouvoir accorder SUPER_ADMIN
  -- (rôle plateforme, hors du modèle tenant) — sans exception, avant même
  -- de regarder qui appelle.
  if new.role = 'SUPER_ADMIN' and (old.role is distinct from new.role) then
    raise exception 'FORBIDDEN: Ce rôle ne peut pas être attribué depuis cette table';
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
