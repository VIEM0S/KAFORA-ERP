-- CRITIQUE — trouvé le 2026-09-21 en comparant Kafora à un autre projet du
-- même atelier (MANDE-SOLAIRE-DEYE-ERP) qui avait documenté exactement ce
-- défaut. Confirmé empiriquement en production sur une cible jetable
-- (tenant QA, client/crédit créés et supprimés pour le test) : un compte
-- authentifié SANS app_metadata (ex. une inscription publique jamais
-- rattachée à un tenant/rôle) passe les gates set_credit_limit/repay_credit/
-- write_off_credit sur N'IMPORTE QUEL tenant dont l'abonnement est actif.
--
-- Cause : is_owner()/is_owner_or_admin()/is_regional_manager()/is_manager()
-- comparent auth_role() (NULL si aucune revendication de rôle dans le JWT) à
-- une chaîne — en SQL, `NULL = 'X'` et `NULL in (...)` valent NULL, pas
-- false. `belongs_to_tenant()` a le même défaut (`auth_tenant_id() = tid`).
-- Ensuite, dans chaque RPC, `if not (can_write(tid) and is_manager()) then
-- raise exception` : quand l'expression vaut NULL, PL/pgSQL traite le IF
-- comme faux et ne lève JAMAIS l'exception — le refus est silencieusement
-- sauté. Toutes les RPC qui suivent ce motif (credits, ventes, achats,
-- transferts, caisse, ajustements de stock...) sont exposées de la même
-- façon, pas seulement les 3 testées.
--
-- Règle à retenir : un helper d'autorisation ne doit JAMAIS pouvoir
-- retourner NULL — toujours un booléen strict (coalesce à false).
-- Zéro impact sur un utilisateur légitime : ses revendications JWT
-- (role/tenant_id) ne sont jamais NULL, ces expressions étaient déjà
-- strictement vraies/fausses pour lui.

create or replace function belongs_to_tenant(tid uuid) returns boolean
language sql stable
as $$
  select coalesce(auth.uid() is not null and auth_tenant_id() = tid, false)
$$;

create or replace function is_owner() returns boolean
language sql stable
as $$
  select coalesce(auth_role() = 'OWNER', false)
$$;

create or replace function is_owner_or_admin() returns boolean
language sql stable
as $$
  select coalesce(auth_role() in ('OWNER','ADMIN'), false)
$$;

create or replace function is_regional_manager() returns boolean
language sql stable
as $$
  select coalesce(auth_role() = 'REGIONAL_MANAGER', false)
$$;

create or replace function is_manager() returns boolean
language sql stable
as $$
  select coalesce(auth_role() in ('OWNER','ADMIN','REGIONAL_MANAGER','MANAGER'), false)
$$;
