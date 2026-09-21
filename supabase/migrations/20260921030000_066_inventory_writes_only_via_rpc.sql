-- Le stock ne doit JAMAIS pouvoir changer sans laisser une ligne dans le
-- journal des mouvements.
--
-- Trouvé le 2026-09-21 (comparaison avec MANDE-SOLAIRE-DEYE-ERP) et confirmé
-- en production sur le tenant QA : un compte MANAGER pouvait faire
-- `update inventory set quantity = ...` directement via PostgREST — accepté,
-- AUCUNE ligne créée dans inventory_movements. Symétriquement, la politique
-- inventory_movements_insert lui permettait de FABRIQUER des lignes de journal
-- sans toucher au stock. Le journal n'était donc fiable dans aucun des deux
-- sens.
--
-- Toutes les RPC qui touchent au stock (pos_checkout, cancel_sale,
-- create_sale_return, transferts, réception de bons de commande,
-- adjust_inventory) sont SECURITY DEFINER et écrivent déjà le stock ET son
-- mouvement ensemble, dans la même transaction. Elles n'ont pas besoin de
-- ces politiques (le propriétaire de la fonction contourne RLS). Un
-- déclencheur qui écrirait le mouvement aurait créé des doublons avec elles :
-- on retire donc plutôt l'écriture directe, ce qui garantit le journal par
-- construction.
--
-- Le seul écrivain direct côté client était l'import en masse de produits
-- (products/import) : il passe maintenant par import_initial_stock() ci-dessous.
-- La lecture (SELECT, temps réel) ne change pas.

drop policy if exists inventory_write on inventory;
drop policy if exists inventory_movements_insert on inventory_movements;
revoke insert, update, delete on inventory from authenticated, anon;
revoke insert, update, delete on inventory_movements from authenticated, anon;

create or replace function import_initial_stock(p_store_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_row jsonb;
  v_product_id uuid;
  v_name text;
  v_qty numeric;
  v_count int := 0;
begin
  if v_tenant is null or not (can_write(v_tenant) and is_manager()) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission d''importer du stock';
  end if;
  if not exists (select 1 from stores where id = p_store_id and tenant_id = v_tenant) then
    raise exception 'NOT_FOUND: Magasin introuvable';
  end if;
  if not can_access_store(p_store_id) then
    raise exception 'FORBIDDEN: Vous n''avez pas accès à ce magasin';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_product_id := (v_row->>'product_id')::uuid;
    v_qty := (v_row->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QUANTITY: Quantité initiale invalide';
    end if;
    select name into v_name from products where id = v_product_id and tenant_id = v_tenant;
    if v_name is null then
      raise exception 'NOT_FOUND: Produit introuvable';
    end if;

    insert into inventory (tenant_id, product_id, store_id, quantity, min_quantity)
      values (v_tenant, v_product_id, p_store_id, v_qty, nullif(v_row->>'min_quantity', '')::numeric);

    insert into inventory_movements (
      tenant_id, product_id, product_name, store_id, type, quantity,
      previous_quantity, new_quantity, reason, created_by
    ) values (
      v_tenant, v_product_id, v_name, p_store_id, 'INITIAL', v_qty,
      0, v_qty, 'Import en masse — stock initial', auth.uid()
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'count', v_count);
end;
$$;

revoke execute on function import_initial_stock(uuid, jsonb) from public, anon;
grant execute on function import_initial_stock(uuid, jsonb) to authenticated;
