-- Prix d'achat des produits : PHASE 2 (destructive — à appliquer APRÈS le
-- déploiement du code qui lit/écrit product_costs, voir migration 070).
--
-- Une fois appliquée :
--   * products n'a plus de colonne purchase_price : le coût d'achat n'existe
--     que dans product_costs, lisible des seuls Managers+ ;
--   * la synchronisation de compatibilité disparaît ;
--   * sale_items.purchase_price (coût de la ligne, figé à la vente) n'est plus
--     lisible côté client : un Caissier pouvait le lire via l'API. Le coût et
--     la marge restent consultables des Managers+ par sale_cost_summary. Les
--     RPC (security definer) et le service-role continuent d'y écrire/lire.

-- 1. Compatibilité transitoire (070) : plus nécessaire.
drop trigger if exists trg_sync_product_cost_compat on products;
drop function if exists sync_product_cost_compat();

-- 2. Historique des prix (068) : le prix de vente reste sur products, le prix
--    d'achat est maintenant suivi sur product_costs. (Le déclencheur de 068
--    dépend de la colonne : il doit être retiré avant sa suppression.)
drop trigger if exists trg_audit_product_price_change on products;

create or replace function audit_product_price_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_role user_role;
begin
  if auth.uid() is not null then
    select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
      into v_name from users where id = auth.uid();
  end if;
  select r into v_role from unnest(enum_range(null::user_role)) r where r::text = auth_role();

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, details)
  values (
    new.tenant_id, 'PRODUCT_PRICE_CHANGED', 'product', new.id, auth.uid(), v_name, v_role,
    jsonb_build_object(
      'name', new.name,
      'selling_price', jsonb_build_object('from', old.selling_price, 'to', new.selling_price)
    )
  );
  return new;
end;
$$;

create trigger trg_audit_product_price_change
  after update of selling_price on products
  for each row
  when (old.selling_price is distinct from new.selling_price)
  execute function audit_product_price_change();

create or replace function audit_product_cost_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_actor text;
  v_role user_role;
begin
  select name into v_name from products where id = new.product_id;
  if auth.uid() is not null then
    select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
      into v_actor from users where id = auth.uid();
  end if;
  select r into v_role from unnest(enum_range(null::user_role)) r where r::text = auth_role();

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, details)
  values (
    new.tenant_id, 'PRODUCT_PRICE_CHANGED', 'product', new.product_id, auth.uid(), v_actor, v_role,
    jsonb_build_object(
      'name', v_name,
      'purchase_price', jsonb_build_object('from', old.purchase_price, 'to', new.purchase_price)
    )
  );
  return new;
end;
$$;

-- Uniquement les CHANGEMENTS : la première saisie d'un coût (insert) n'est pas
-- tracée, sinon chaque création de produit remplirait le journal.
create trigger trg_audit_product_cost_change
  after update of purchase_price on product_costs
  for each row
  when (old.purchase_price is distinct from new.purchase_price)
  execute function audit_product_cost_change();

-- 3. Réception d'un bon de commande : plus de recopie vers products.purchase_price.
create or replace function public.receive_purchase_order(p_tenant_id uuid, p_po_id uuid, p_caller_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status purchase_order_status;
  v_store_id uuid;
  v_reference text;
  v_item record;
  v_qty_now numeric;
  v_remaining numeric;
  v_prev_qty numeric;
  v_new_qty numeric;
  v_current_cost numeric;
  v_weighted_cost numeric;
  v_all_received boolean := true;
  v_any_received boolean := false;
  v_line jsonb;
  v_expiry date;
  v_serial text;
begin
  select status, store_id, reference into v_status, v_store_id, v_reference
    from purchase_orders where id = p_po_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'NOT_FOUND: Bon de commande introuvable';
  end if;
  if v_status not in ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED') then
    raise exception 'INVALID_STATUS: Impossible de réceptionner un bon %', v_status;
  end if;

  for v_item in select id, product_id, product_name, quantity_ordered, quantity_received, unit_cost
    from purchase_order_items where purchase_order_id = p_po_id for update
  loop
    v_qty_now := 0;
    v_line := null;
    select l into v_line from jsonb_array_elements(p_lines) l
      where (l->>'product_id')::uuid = v_item.product_id;
    v_qty_now := greatest(0, floor(coalesce((v_line->>'quantity_received_now')::numeric, 0)));

    v_remaining := v_item.quantity_ordered - v_item.quantity_received;
    if v_qty_now > v_remaining then
      raise exception 'QUANTITY_EXCEEDS: Quantité reçue (%) supérieure au reste attendu (%) pour "%"',
        v_qty_now, v_remaining, v_item.product_name;
    end if;

    if v_qty_now > 0 then
      insert into inventory (tenant_id, product_id, store_id, quantity)
        values (p_tenant_id, v_item.product_id, v_store_id, v_qty_now)
        on conflict (tenant_id, product_id, store_id) do update set quantity = inventory.quantity + v_qty_now
        returning quantity into v_new_qty;
      v_prev_qty := v_new_qty - v_qty_now;

      insert into inventory_movements (
        tenant_id, product_id, product_name, store_id, type, quantity,
        previous_quantity, new_quantity, purchase_order_id, reason, created_by
      ) values (
        p_tenant_id, v_item.product_id, v_item.product_name, v_store_id, 'PURCHASE', v_qty_now,
        v_prev_qty, v_new_qty, p_po_id, format('Réception bon de commande %s', v_reference), p_caller_id
      );

      v_expiry := nullif(v_line->>'expiry_date', '')::date;
      if v_expiry is not null then
        insert into product_lots (tenant_id, product_id, store_id, quantity, expiry_date, purchase_order_id)
          values (p_tenant_id, v_item.product_id, v_store_id, v_qty_now, v_expiry, p_po_id);
      end if;
      if jsonb_typeof(v_line->'serials') = 'array' then
        for v_serial in select trim(both from s) from jsonb_array_elements_text(v_line->'serials') s
        loop
          if v_serial <> '' then
            insert into product_serials (tenant_id, product_id, store_id, serial_number, purchase_order_id)
              values (p_tenant_id, v_item.product_id, v_store_id, v_serial, p_po_id);
          end if;
        end loop;
      end if;

      -- Cout moyen pondere : aucun cout connu ou plus de stock -> le cout
      -- recu fait reference sans moyenne a calculer.
      select purchase_price into v_current_cost from product_costs where product_id = v_item.product_id;
      v_weighted_cost := case
        when v_current_cost is null or v_prev_qty <= 0 then v_item.unit_cost
        else round((v_prev_qty * v_current_cost + v_qty_now * v_item.unit_cost) / v_new_qty)
      end;
      insert into product_costs (product_id, tenant_id, purchase_price)
        values (v_item.product_id, p_tenant_id, v_weighted_cost)
        on conflict (product_id) do update set purchase_price = excluded.purchase_price;
    end if;

    update purchase_order_items set quantity_received = v_item.quantity_received + v_qty_now where id = v_item.id;

    if v_item.quantity_received + v_qty_now < v_item.quantity_ordered then
      v_all_received := false;
    end if;
    if v_item.quantity_received + v_qty_now > 0 then
      v_any_received := true;
    end if;
  end loop;

  update purchase_orders set
    status = case when v_all_received then 'RECEIVED' when v_any_received then 'PARTIALLY_RECEIVED' else status end,
    received_at = case when v_all_received then now() else received_at end
    where id = p_po_id;

  return jsonb_build_object('success', true);
end;
$function$;

-- 4. Suppression de la colonne.
alter table products drop column purchase_price;

-- 5. sale_items : coût de la ligne illisible côté client. Un revoke de colonne
--    seul est sans effet face à un grant de table (voir migration 045) : on
--    retire le SELECT de la table puis on le redonne colonne par colonne.
revoke select on sale_items from authenticated, anon;
grant select (id, tenant_id, sale_id, product_id, product_name, product_sku, category_id, quantity,
              unit_price, discount_percent, tax_rate, total, returned_quantity, serial_number, created_at)
  on sale_items to authenticated;
