-- L'ecran Inventaire (handleAdjust) faisait DEUX appels reseau separes pour
-- une entree de stock a peremption/numero de serie : adjust_inventory()
-- (incremente inventory.quantity, atomique) PUIS un insert client direct
-- dans product_lots/product_serials. Si la connexion tombait entre les deux,
-- inventory.quantity etait deja incremente mais aucun lot/numero de serie
-- n'etait cree -- stock invisible aux alertes de peremption (produit a
-- peremption) ou invendable en caisse, le picker de serie n'ayant rien a
-- proposer (produit a numero de serie), jusqu'a reconciliation manuelle.
-- Trouve lors de l'audit de resilience du 2026-09-29.
--
-- Correction : le lot/les numeros de serie sont desormais crees dans la
-- MEME transaction que l'incrementation de inventory.quantity -- meme
-- discipline que mark_lot_expired (migration 079) et receive_purchase_order.
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
  p_caller_role text,
  p_expiry_date date default null,
  p_serials jsonb default null
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

  -- Ventilation additionnelle (lot ou numeros de serie), uniquement pour une
  -- ENTREE de stock -- une sortie/un recomptage ne sait pas quel lot/exemplaire
  -- precis retirer (role de la vente POS pour la serie, de "Marquer perime"
  -- pour un lot).
  if p_mode = 'add' then
    if p_expiry_date is not null then
      insert into product_lots (tenant_id, product_id, store_id, quantity, expiry_date, notes)
        values (p_tenant_id, p_product_id, p_store_id, greatest(0, p_amount), p_expiry_date, nullif(trim(p_reason), ''));
    end if;
    if p_serials is not null and jsonb_typeof(p_serials) = 'array' then
      insert into product_serials (tenant_id, product_id, store_id, serial_number)
      select p_tenant_id, p_product_id, p_store_id, trim(both from s)
      from jsonb_array_elements_text(p_serials) s
      where trim(both from s) <> '';
    end if;
  end if;

  return jsonb_build_object('success', true, 'previousQuantity', v_previous, 'newQuantity', v_new, 'inventoryId', v_inventory_id);
end;
$function$;

revoke execute on function public.adjust_inventory(uuid, uuid, uuid, text, text, int, boolean, int, text, uuid, text, date, jsonb) from public;

-- L'ancienne signature (11 parametres, sans p_expiry_date/p_serials) doit
-- disparaitre : sinon PostgREST hesite entre les deux surcharges des qu'un
-- appel omet les nouveaux parametres optionnels (meme probleme deja
-- rencontre et corrige en migration 072 pour une precedente surcharge).
drop function if exists public.adjust_inventory(uuid, uuid, uuid, text, text, int, boolean, int, text, uuid, text);
