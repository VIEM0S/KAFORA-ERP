-- receive_purchase_order() lisait product_costs.purchase_price sans
-- verrouiller la ligne avant de calculer le nouveau cout moyen pondere
-- (CUMP). product_costs est cle par product_id SEUL (cout unique par
-- produit, partage entre tous les magasins), alors que inventory est cle
-- par (tenant, product, store) -- deux receptions simultanees du MEME
-- produit dans DEUX magasins differents ne se bloquent donc jamais l'une
-- l'autre sur inventory, mais lisent la meme ligne product_costs non
-- verrouillee : la seconde ecriture peut silencieusement ecraser le calcul
-- de la premiere, corrompant le CUMP sans aucune erreur visible (impact
-- differe sur les marges/COGS). Trouve lors de l'audit de concurrence du
-- 2026-09-29.
--
-- Correction : insert-si-absent (garantit qu'une ligne existe a verrouiller
-- pour un produit jamais encore coute) puis select ... for update avant de
-- calculer/ecrire le nouveau cout -- meme discipline que partout ailleurs
-- dans ce fichier (inventory, purchase_order_items, purchase_orders sont
-- deja tous verrouilles ainsi).
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

      -- Cout moyen pondere : garantit une ligne verrouillable meme pour un
      -- produit jamais encore coute (do nothing si elle existe deja), puis
      -- verrouille avant de lire -- deux receptions simultanees du meme
      -- produit dans deux magasins differents ne peuvent plus s'ecraser
      -- l'une l'autre silencieusement (voir commentaire d'en-tete).
      insert into product_costs (product_id, tenant_id, purchase_price)
        values (v_item.product_id, p_tenant_id, v_item.unit_cost)
        on conflict (product_id) do nothing;
      select purchase_price into v_current_cost from product_costs where product_id = v_item.product_id for update;
      v_weighted_cost := case
        when v_prev_qty <= 0 then v_item.unit_cost
        else round((v_prev_qty * v_current_cost + v_qty_now * v_item.unit_cost) / v_new_qty)
      end;
      update product_costs set purchase_price = v_weighted_cost where product_id = v_item.product_id;
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
