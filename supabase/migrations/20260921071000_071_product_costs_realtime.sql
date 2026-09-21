-- product_costs : diffusion temps réel, pour que l'écran Produits se
-- rafraîchisse quand un prix d'achat change (les coûts vivent désormais hors
-- de la ligne products — voir migration 070).
alter publication supabase_realtime add table product_costs;

-- Valorisation des pertes (migration 069) : le coût d'achat se lit désormais
-- dans product_costs (repli sur le prix de vente si inconnu, comme avant).
create or replace function public.adjust_inventory(
  p_tenant_id uuid,
  p_store_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_mode text,
  p_amount int,
  p_has_min_quantity boolean,
  p_min_quantity int,
  p_reason text,
  p_caller_id uuid,
  p_caller_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inventory_id uuid;
  v_previous int;
  v_new int;
  v_unit_cost numeric;
  v_threshold numeric;
  v_loss numeric;
begin
  if p_mode not in ('add', 'remove', 'set') then
    raise exception 'INVALID_MODE: Type d''ajustement inconnu';
  end if;

  select id, quantity into v_inventory_id, v_previous
    from inventory
    where tenant_id = p_tenant_id and store_id = p_store_id and product_id = p_product_id
    for update;

  if not found then
    v_previous := 0;
  end if;

  v_new := case p_mode
    when 'add' then v_previous + greatest(0, p_amount)
    when 'remove' then greatest(0, v_previous - greatest(0, p_amount))
    else greatest(0, p_amount)
  end;

  if v_new < v_previous and coalesce(p_caller_role, '') not in ('OWNER', 'ADMIN') then
    select coalesce(pc.purchase_price, p.selling_price, 0) into v_unit_cost
      from products p left join product_costs pc on pc.product_id = p.id
      where p.id = p_product_id and p.tenant_id = p_tenant_id;
    select stock_loss_approval_threshold into v_threshold from tenants where id = p_tenant_id;
    v_loss := (v_previous - v_new) * coalesce(v_unit_cost, 0);
    if v_loss > coalesce(v_threshold, 0) then
      raise exception 'FORBIDDEN: Cette sortie de stock représente % FCFA, au-dessus du seuil de % FCFA. Faites un inventaire physique (validation du Propriétaire ou d''un Administrateur requise).',
        round(v_loss), round(coalesce(v_threshold, 0));
    end if;
  end if;

  if v_inventory_id is null then
    insert into inventory (tenant_id, store_id, product_id, quantity, min_quantity)
    values (p_tenant_id, p_store_id, p_product_id, v_new, case when p_has_min_quantity then p_min_quantity else null end)
    returning id into v_inventory_id;
  else
    update inventory set
      quantity = v_new,
      min_quantity = case when p_has_min_quantity then p_min_quantity else min_quantity end
      where id = v_inventory_id;
  end if;

  insert into inventory_movements (
    tenant_id, product_id, product_name, store_id, type, quantity,
    previous_quantity, new_quantity, reason, created_by
  ) values (
    p_tenant_id, p_product_id, p_product_name, p_store_id, 'ADJUSTMENT',
    v_new - v_previous, v_previous, v_new, coalesce(nullif(trim(p_reason), ''), 'Ajustement manuel'), p_caller_id
  );

  return jsonb_build_object('success', true, 'previousQuantity', v_previous, 'newQuantity', v_new, 'inventoryId', v_inventory_id);
end;
$function$;

create or replace function start_stocktake(p_store_id uuid, p_user_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_id uuid;
  v_count int;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  if v_tenant is null or not (can_write(v_tenant) and is_manager()) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission de faire un inventaire';
  end if;
  if not exists (select 1 from stores where id = p_store_id and tenant_id = v_tenant) then
    raise exception 'NOT_FOUND: Magasin introuvable';
  end if;
  if not can_access_store(p_store_id) then
    raise exception 'FORBIDDEN: Vous n''avez pas accès à ce magasin';
  end if;
  if exists (select 1 from stocktakes where store_id = p_store_id and status in ('IN_PROGRESS','PENDING_APPROVAL')) then
    raise exception 'INVALID_STATUS: Un inventaire est déjà en cours pour ce magasin';
  end if;

  insert into stocktakes (tenant_id, store_id, created_by, created_by_name)
  values (v_tenant, p_store_id, v_actor_id, p_user_name)
  returning id into v_id;

  insert into stocktake_lines (tenant_id, store_id, stocktake_id, product_id, product_name, sku, expected_qty, unit_cost)
  select v_tenant, p_store_id, v_id, p.id, p.name, p.sku, coalesce(i.quantity, 0),
         coalesce(pc.purchase_price, p.selling_price, 0)
    from products p
    left join inventory i on i.product_id = p.id and i.store_id = p_store_id
    left join product_costs pc on pc.product_id = p.id
   where p.tenant_id = v_tenant and p.is_active and p.track_inventory and not p.track_serial;
  get diagnostics v_count = row_count;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant, 'STOCKTAKE_STARTED', 'stocktake', v_id, v_actor_id, p_user_name, v_actor_role::user_role, p_store_id,
    jsonb_build_object('products', v_count));

  return jsonb_build_object('success', true, 'id', v_id, 'products', v_count);
end;
$$;
