-- ─── tenants ────────────────────────────────────────────────────────────────
alter table tenants enable row level security;
create policy tenants_select on tenants for select using (belongs_to_tenant(id));
create policy tenants_update on tenants for update
  using (belongs_to_tenant(id) and is_owner_or_admin())
  with check (belongs_to_tenant(id) and is_owner_or_admin());
-- insert/delete : service-role uniquement (inscription, resiliation), pas de policy = refuse.

-- ─── super_admins / super_admin_logs : aucun acces client ─────────────────
alter table super_admins enable row level security;
alter table super_admin_logs enable row level security;
-- Aucune politique = deny-all pour authenticated/anon, comme
-- `allow read, write: if false` aujourd'hui. Acces uniquement via service-role.

-- ─── users ──────────────────────────────────────────────────────────────────
alter table users enable row level security;
create policy users_select on users for select using (belongs_to_tenant(tenant_id));
-- Garde-fou RLS (l'application reste la vraie barriere pour create/update,
-- car creer un utilisateur exige aussi un appel service-role a
-- supabase.auth.admin.createUser() — voir plan de migration §RLS).
create policy users_update on users for update
  using (
    belongs_to_tenant(tenant_id) and (
      is_owner()
      or (is_owner_or_admin() and role <> 'ADMIN')
      or (is_regional_manager() and role in ('MANAGER','CASHIER') and store_ids <@ auth_store_ids())
      or auth.uid() = id
    )
  )
  with check (belongs_to_tenant(tenant_id));

-- ─── user_deletion_requests ────────────────────────────────────────────────
alter table user_deletion_requests enable row level security;
create policy user_deletion_requests_select on user_deletion_requests for select
  using (belongs_to_tenant(tenant_id) and is_owner_or_admin());
-- write : service-role uniquement (flux a double verification).

-- ─── subscriptions / subscription_payments / referrals ────────────────────
alter table subscriptions enable row level security;
create policy subscriptions_select on subscriptions for select using (belongs_to_tenant(tenant_id));

alter table subscription_payments enable row level security;
create policy subscription_payments_select on subscription_payments for select
  using (belongs_to_tenant(tenant_id) and is_owner_or_admin());

alter table referrals enable row level security;
create policy referrals_select on referrals for select
  using (belongs_to_tenant(referrer_tenant_id) or belongs_to_tenant(referred_tenant_id));

-- ─── stores ─────────────────────────────────────────────────────────────────
alter table stores enable row level security;
create policy stores_select on stores for select using (belongs_to_tenant(tenant_id));
create policy stores_write on stores for insert with check (belongs_to_tenant(tenant_id) and is_owner_or_admin());
create policy stores_update on stores for update
  using (belongs_to_tenant(tenant_id) and is_owner_or_admin())
  with check (belongs_to_tenant(tenant_id) and is_owner_or_admin());
create policy stores_delete on stores for delete using (belongs_to_tenant(tenant_id) and is_owner());

-- ─── categories / products / customers / suppliers ────────────────────────
alter table categories enable row level security;
create policy categories_select on categories for select using (belongs_to_tenant(tenant_id));
create policy categories_write on categories for all
  using (can_write(tenant_id) and is_manager())
  with check (can_write(tenant_id) and is_manager());

alter table products enable row level security;
create policy products_select on products for select using (belongs_to_tenant(tenant_id));
create policy products_write on products for all
  using (can_write(tenant_id) and is_manager())
  with check (can_write(tenant_id) and is_manager());

alter table customers enable row level security;
create policy customers_select on customers for select using (belongs_to_tenant(tenant_id));
create policy customers_write on customers for all
  using (can_write(tenant_id) and is_manager())
  with check (can_write(tenant_id) and is_manager());

alter table suppliers enable row level security;
create policy suppliers_select on suppliers for select using (belongs_to_tenant(tenant_id));
create policy suppliers_write on suppliers for all
  using (can_write(tenant_id) and is_manager())
  with check (can_write(tenant_id) and is_manager());

-- ─── inventory / inventory_movements ───────────────────────────────────────
alter table inventory enable row level security;
create policy inventory_select on inventory for select
  using (belongs_to_tenant(tenant_id) and can_access_store(store_id));
create policy inventory_write on inventory for all
  using (can_write(tenant_id) and is_manager() and can_access_store(store_id))
  with check (can_write(tenant_id) and is_manager() and can_access_store(store_id));

alter table inventory_movements enable row level security;
create policy inventory_movements_select on inventory_movements for select
  using (belongs_to_tenant(tenant_id) and can_access_store(store_id));
create policy inventory_movements_insert on inventory_movements for insert
  with check (belongs_to_tenant(tenant_id) and can_access_store(store_id));

-- ─── transactions haute confiance : lecture seule cote client ─────────────
-- (ecritures deja revoquees au niveau GRANT — pas de policy insert/update/delete)
alter table sales enable row level security;
create policy sales_select on sales for select
  using (belongs_to_tenant(tenant_id) and can_access_store(store_id));

alter table sale_items enable row level security;
create policy sale_items_select on sale_items for select using (belongs_to_tenant(tenant_id));

alter table payments enable row level security;
create policy payments_select on payments for select using (belongs_to_tenant(tenant_id));

alter table sale_cost_summary enable row level security;
create policy sale_cost_summary_select on sale_cost_summary for select
  using (belongs_to_tenant(tenant_id) and is_manager());

alter table sale_returns enable row level security;
create policy sale_returns_select on sale_returns for select
  using (belongs_to_tenant(tenant_id) and can_access_store(store_id));

alter table sale_return_items enable row level security;
create policy sale_return_items_select on sale_return_items for select
  using (exists (select 1 from sale_returns r where r.id = sale_return_id and belongs_to_tenant(r.tenant_id)));

alter table purchase_orders enable row level security;
create policy purchase_orders_select on purchase_orders for select using (belongs_to_tenant(tenant_id));

alter table purchase_order_items enable row level security;
create policy purchase_order_items_select on purchase_order_items for select
  using (exists (select 1 from purchase_orders p where p.id = purchase_order_id and belongs_to_tenant(p.tenant_id)));

alter table transfers enable row level security;
create policy transfers_select on transfers for select
  using (belongs_to_tenant(tenant_id) and (can_access_store(from_store_id) or can_access_store(to_store_id)));

alter table transfer_lines enable row level security;
create policy transfer_lines_select on transfer_lines for select
  using (exists (select 1 from transfers t where t.id = transfer_id and belongs_to_tenant(t.tenant_id)));

alter table cash_sessions enable row level security;
create policy cash_sessions_select on cash_sessions for select using (belongs_to_tenant(tenant_id));

-- ─── credits / credit_payments ──────────────────────────────────────────────
alter table credits enable row level security;
create policy credits_select on credits for select using (belongs_to_tenant(tenant_id));
create policy credits_write on credits for insert with check (can_write(tenant_id) and is_manager());
create policy credits_update on credits for update
  using (can_write(tenant_id) and is_manager())
  with check (can_write(tenant_id) and is_manager());

alter table credit_payments enable row level security;
create policy credit_payments_select on credit_payments for select using (belongs_to_tenant(tenant_id));
create policy credit_payments_insert on credit_payments for insert
  with check (can_write(tenant_id) and is_manager());

-- ─── quotes / quote_items ───────────────────────────────────────────────────
alter table quotes enable row level security;
create policy quotes_select on quotes for select using (belongs_to_tenant(tenant_id));
create policy quotes_insert on quotes for insert with check (can_write(tenant_id) and is_manager());
create policy quotes_update on quotes for update
  using (can_write(tenant_id) and is_manager())
  with check (can_write(tenant_id) and is_manager());
create policy quotes_delete on quotes for delete using (belongs_to_tenant(tenant_id) and is_owner_or_admin());

alter table quote_items enable row level security;
create policy quote_items_select on quote_items for select using (belongs_to_tenant(tenant_id));
create policy quote_items_write on quote_items for all
  using (can_write(tenant_id) and is_manager())
  with check (can_write(tenant_id) and is_manager());

-- ─── cash_registers ─────────────────────────────────────────────────────────
alter table cash_registers enable row level security;
create policy cash_registers_select on cash_registers for select
  using (belongs_to_tenant(tenant_id) and can_access_store(store_id));
create policy cash_registers_write on cash_registers for all
  using (can_write(tenant_id) and is_manager() and can_access_store(store_id))
  with check (can_write(tenant_id) and is_manager() and can_access_store(store_id));

-- ─── invoices ───────────────────────────────────────────────────────────────
alter table invoices enable row level security;
create policy invoices_select on invoices for select using (belongs_to_tenant(tenant_id));
create policy invoices_insert on invoices for insert with check (can_write(tenant_id) and is_manager());
create policy invoices_update on invoices for update
  using (can_write(tenant_id) and is_manager())
  with check (can_write(tenant_id) and is_manager());
create policy invoices_delete on invoices for delete using (belongs_to_tenant(tenant_id) and is_owner_or_admin());

-- ─── daily_stats : lecture seule (ecrit par un job planifie via service-role) ─
alter table daily_stats enable row level security;
create policy daily_stats_select on daily_stats for select
  using (belongs_to_tenant(tenant_id) and is_manager());

-- ─── alerts ─────────────────────────────────────────────────────────────────
alter table alerts enable row level security;
create policy alerts_select on alerts for select using (belongs_to_tenant(tenant_id));
create policy alerts_update on alerts for update
  using (can_write(tenant_id) and is_manager())
  with check (can_write(tenant_id) and is_manager());

-- ─── notifications ──────────────────────────────────────────────────────────
alter table notifications enable row level security;
create policy notifications_select on notifications for select
  using (belongs_to_tenant(tenant_id) and (user_id = auth.uid() or is_owner_or_admin()));
create policy notifications_insert on notifications for insert with check (belongs_to_tenant(tenant_id));
create policy notifications_update on notifications for update
  using (belongs_to_tenant(tenant_id) and user_id = auth.uid())
  with check (belongs_to_tenant(tenant_id) and user_id = auth.uid());

-- ─── audit_logs / error_logs ────────────────────────────────────────────────
alter table audit_logs enable row level security;
create policy audit_logs_select on audit_logs for select
  using (belongs_to_tenant(tenant_id) and is_owner_or_admin());

alter table error_logs enable row level security;
create policy error_logs_select on error_logs for select
  using (belongs_to_tenant(tenant_id) and is_owner_or_admin());
create policy error_logs_insert on error_logs for insert with check (belongs_to_tenant(tenant_id));

-- ─── rate_limits / sync_dedup : deja verrouilles au niveau GRANT ───────────
alter table rate_limits enable row level security;
alter table sync_dedup enable row level security;
