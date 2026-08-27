create table purchase_order_counters (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  value int not null default 0
);
revoke all on purchase_order_counters from anon, authenticated;

-- Cree un bon de commande fournisseur (DRAFT ou SENT). N'impacte JAMAIS le
-- stock — le stock ne bouge qu'a la reception, voir receive_purchase_order().
create or replace function create_purchase_order(
  p_tenant_id uuid, p_supplier_id uuid, p_store_id uuid,
  p_status purchase_order_status, p_notes text, p_expected_date timestamptz,
  p_created_by uuid, p_created_by_name text,
  -- [{product_id, product_name, product_sku, quantity_ordered, unit_cost}]
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
  v_reference text;
  v_po_id uuid;
  v_item jsonb;
  v_subtotal numeric := 0;
  v_qty numeric;
  v_cost numeric;
begin
  insert into purchase_order_counters (tenant_id, value) values (p_tenant_id, 1)
    on conflict (tenant_id) do update set value = purchase_order_counters.value + 1
    returning value into v_seq;
  v_reference := 'BC-' || extract(year from now())::int || '-' || lpad(v_seq::text, 4, '0');

  select coalesce(sum(greatest(1, floor((v->>'quantity_ordered')::numeric)) * greatest(0, (v->>'unit_cost')::numeric)), 0)
    into v_subtotal
    from jsonb_array_elements(p_items) v;

  insert into purchase_orders (
    tenant_id, reference, supplier_id, store_id, status, subtotal, notes,
    expected_date, created_by, created_by_name
  ) values (
    p_tenant_id, v_reference, p_supplier_id, p_store_id, p_status, v_subtotal, p_notes,
    p_expected_date, p_created_by, p_created_by_name
  ) returning id into v_po_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, floor((v_item->>'quantity_ordered')::numeric));
    v_cost := greatest(0, (v_item->>'unit_cost')::numeric);
    insert into purchase_order_items (
      purchase_order_id, product_id, product_name, product_sku,
      quantity_ordered, quantity_received, unit_cost, total
    ) values (
      v_po_id, (v_item->>'product_id')::uuid, v_item->>'product_name', v_item->>'product_sku',
      v_qty, 0, v_cost, v_qty * v_cost
    );
  end loop;

  return jsonb_build_object('success', true, 'id', v_po_id, 'reference', v_reference);
end;
$$;

revoke execute on function create_purchase_order(
  uuid, uuid, uuid, purchase_order_status, text, timestamptz, uuid, text, jsonb
) from public;

-- Receptionne tout ou partie d'un bon de commande : incremente le stock,
-- cree un mouvement PURCHASE par produit, met a jour le cout moyen pondere
-- (CUMP — methode de valorisation OHADA ; "dernier cout" en surevaluerait
-- le stock des qu'un rearprovisionnement change de prix), marque les lignes
-- recues et fait progresser le statut du bon.
create or replace function receive_purchase_order(
  p_tenant_id uuid, p_po_id uuid, p_caller_id uuid,
  -- [{product_id, quantity_received_now}]
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
begin
  select status, store_id, reference into v_status, v_store_id, v_reference
    from purchase_orders where id = p_po_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'NOT_FOUND: Bon de commande introuvable';
  end if;
  if v_status not in ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED') then
    raise exception 'INVALID_STATUS: Impossible de réceptionner un bon %', v_status;
  end if;

  -- Chaque ligne du bon (verrouillee) : evite qu'une reception concurrente
  -- ne cumule sur une valeur deja obsolete.
  for v_item in select id, product_id, product_name, quantity_ordered, quantity_received, unit_cost
    from purchase_order_items where purchase_order_id = p_po_id for update
  loop
    v_qty_now := 0;
    select coalesce((l->>'quantity_received_now')::numeric, 0) into v_qty_now
      from jsonb_array_elements(p_lines) l where (l->>'product_id')::uuid = v_item.product_id;
    v_qty_now := greatest(0, floor(coalesce(v_qty_now, 0)));

    v_remaining := v_item.quantity_ordered - v_item.quantity_received;
    if v_qty_now > v_remaining then
      raise exception 'QUANTITY_EXCEEDS: Quantité reçue (%) supérieure au reste attendu (%) pour "%"',
        v_qty_now, v_remaining, v_item.product_name;
    end if;

    if v_qty_now > 0 then
      -- Stock : incremente ou cree la ligne d'inventaire.
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

      -- Cout moyen pondere : aucun cout connu ou plus de stock -> le cout
      -- recu fait reference sans moyenne a calculer.
      select purchase_price into v_current_cost from products where id = v_item.product_id;
      v_weighted_cost := case
        when v_current_cost is null or v_prev_qty <= 0 then v_item.unit_cost
        else round((v_prev_qty * v_current_cost + v_qty_now * v_item.unit_cost) / v_new_qty)
      end;
      update products set purchase_price = v_weighted_cost where id = v_item.product_id;
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
$$;

revoke execute on function receive_purchase_order(uuid, uuid, uuid, jsonb) from public;
