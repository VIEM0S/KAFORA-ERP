-- Ajustement manuel de stock (app/(dashboard)/inventory/page.tsx et
-- inventory/alerts/page.tsx) : le code client lisait la quantité depuis
-- l'état React (mis à jour par le flux temps réel, potentiellement en
-- retard), calculait la nouvelle quantité ABSOLUE lui-même, puis
-- l'écrivait telle quelle (`update inventory set quantity = newQty`) sans
-- verrou de ligne ni recalcul serveur — contrairement à pos_checkout()/
-- cancel_sale()/create_sale_return(), qui font tous ce calcul dans une RPC
-- avec `for update`. Une vente concurrente entre l'ouverture du dialogue et
-- l'enregistrement de l'ajustement pouvait ainsi être silencieusement
-- écrasée (lost update), avec un inventory_movements.previous_quantity qui
-- ne correspondait déjà plus à la réalité au moment de l'écriture.
--
-- Cette RPC déplace tout le calcul côté serveur, sous verrou de ligne :
-- 'add'/'remove' sont des deltas relatifs à la quantité RÉELLE au moment du
-- verrou (jamais à une valeur mise en cache côté client), 'set' reste une
-- valeur absolue (recomptage physique volontaire).
--
-- Le contrôle de permission vit dans /api/inventory/adjust/route.ts
-- (isManagerPlus + accès magasin), PAS ici : cette fonction est appelée
-- via le client service-role (comme close_cash_register/cancel_sale/
-- ship_transfer), sous lequel auth.jwt() est vide — un contrôle
-- is_manager()/auth_role() ici échouerait TOUJOURS, y compris pour un
-- appel légitime (erreur trouvée et corrigée avant tout commit, en
-- vérifiant en direct : un Owner recevait FORBIDDEN sur un ajustement
-- normal). L'EXECUTE reste révoqué à anon/authenticated ci-dessous :
-- seule la route API, via service_role, peut atteindre cette fonction.
create or replace function public.adjust_inventory(
  p_tenant_id uuid,
  p_store_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_mode text, -- 'add' | 'remove' | 'set'
  p_amount int, -- delta pour add/remove, valeur absolue pour set
  p_has_min_quantity boolean,
  p_min_quantity int,
  p_reason text,
  p_caller_id uuid
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

revoke execute on function public.adjust_inventory(uuid, uuid, uuid, text, text, int, boolean, int, text, uuid) from anon, authenticated;
