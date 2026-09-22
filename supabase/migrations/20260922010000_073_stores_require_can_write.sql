-- Un abonnement expiré ne bloquait pas la création/modification/suppression
-- de magasin — seule table où `stores_write`/`stores_update`/`stores_delete`
-- vérifiaient `belongs_to_tenant() and is_owner_or_admin()` SANS `can_write()`
-- (qui inclut `subscription_active()`), contrairement à toutes les autres
-- tables (products, customers, credits, invoices...).
--
-- Trouvé via un signalement client réel (DistriPlus Mali, abonnement expiré
-- depuis le 2026-09-11) : un 3ᵉ magasin a été créé le 2026-09-22, onze jours
-- après le blocage. Le contrôle côté client (checkPlanLimitClient) ne
-- vérifie que le quota du forfait, jamais le statut de l'abonnement — RLS
-- était donc la seule vraie barrière, et elle ne vérifiait pas non plus.

drop policy if exists stores_write on stores;
create policy stores_write on stores for insert
  with check (can_write(tenant_id) and is_owner_or_admin());

drop policy if exists stores_update on stores;
create policy stores_update on stores for update
  using (can_write(tenant_id) and is_owner_or_admin())
  with check (can_write(tenant_id) and is_owner_or_admin());

drop policy if exists stores_delete on stores;
create policy stores_delete on stores for delete
  using (can_write(tenant_id) and is_owner());
