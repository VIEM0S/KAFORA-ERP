-- Perf, trouvé par l'audit (get_advisors, catégorie performance) du 2026-09-07 :
-- 4 policies RLS appelaient auth.uid() en clair dans leur condition. Postgres
-- réévalue alors la fonction à CHAQUE ligne scannée au lieu d'une seule fois par
-- requête (elle n'est pas hissée en "InitPlan"). Sur des tables qui grossissent
-- (users, notifications, alerts), ça se traduit par un coût croissant à chaque
-- lecture. Fix mécanique et sans risque : envelopper dans (select auth.uid()) —
-- Postgres l'évalue alors une seule fois. Comportement identique, juste plus
-- rapide. Voir https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

alter policy users_update on users
  using (
    belongs_to_tenant(tenant_id) and (
      is_owner()
      or (is_owner_or_admin() and role <> 'ADMIN'::user_role)
      or (is_regional_manager() and role = any (array['MANAGER'::user_role, 'CASHIER'::user_role]) and store_ids <@ auth_store_ids())
      or (select auth.uid()) = id
    )
  )
  with check (belongs_to_tenant(tenant_id));

alter policy alerts_select on alerts
  using (
    belongs_to_tenant(tenant_id) and (
      target_user_id = (select auth.uid())
      or (target_user_id is null and target_role is not null and target_role::text = auth_role())
      or (target_user_id is null and target_role is null and is_manager())
    )
  );

alter policy notifications_select on notifications
  using (
    belongs_to_tenant(tenant_id) and (
      user_id = (select auth.uid())
      or is_owner_or_admin()
    )
  );

alter policy notifications_update on notifications
  using (belongs_to_tenant(tenant_id) and user_id = (select auth.uid()))
  with check (belongs_to_tenant(tenant_id) and user_id = (select auth.uid()));
