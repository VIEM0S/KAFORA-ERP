-- Différenciation sectorielle (suite) : la réception d'un bon de commande
-- est un point d'entrée naturel pour capturer la date de péremption ou les
-- numéros de série d'un produit à suivi (voir migration 041 et
-- app/(dashboard)/purchase-orders/page.tsx). Reprend receive_purchase_order()
-- à l'identique pour les produits sans suivi particulier — seule une
-- branche supplémentaire est ajoutée après l'écriture du mouvement de stock
-- existant, aucune ligne existante n'est modifiée.
create or replace function receive_purchase_order(
  p_tenant_id uuid, p_po_id uuid, p_caller_id uuid,
  -- [{product_id, quantity_received_now, expiry_date?, serials?: string[]}]
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

  -- Chaque ligne du bon (verrouillee) : evite qu'une reception concurrente
  -- ne cumule sur une valeur deja obsolete.
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

      -- Ventilation additionnelle (lot ou séries), en plus du total
      -- inventory.quantity déjà à jour ci-dessus — voir migration 041.
      -- Simple ajout côté client dans p_lines : rien ne force ici la
      -- cohérence avec products.track_expiry/track_serial, l'UI de
      -- réception ne propose le champ que pour les produits concernés.
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
