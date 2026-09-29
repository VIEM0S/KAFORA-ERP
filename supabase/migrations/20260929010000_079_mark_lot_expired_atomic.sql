-- "Marquer périmé" (app/(dashboard)/inventory/alerts/page.tsx) faisait DEUX
-- écritures séparées et non liées : un update direct client → serveur sur
-- product_lots (quantité à 0), puis un appel HTTP séparé vers
-- adjust_inventory() pour décrémenter inventory.quantity du MÊME montant,
-- envoyé par le client (lot.quantity) sans qu'aucune contrainte serveur ne
-- garantisse que les deux restent synchronisés. Si la première réussissait
-- et la seconde échouait (coupure réseau, timeout) — silencieusement avalée
-- par le `catch (e) { console.error(e) }` du composant — le lot passait à 0
-- mais inventory.quantity restait inchangé : le stock agrégé du magasin
-- devenait durablement faux, sans aucun signal visible pour le gérant.
-- Trouvé lors de l'audit du 2026-09-29.
--
-- Remplace par UNE RPC atomique, même schéma que adjust_inventory() : verrou
-- de ligne sur le lot ET sur inventory, le montant décrémenté est lu depuis
-- le lot verrouillé lui-même (jamais transmis par le client), et la même
-- gouvernance de seuil de perte (tenants.stock_loss_approval_threshold,
-- migration 069) s'applique qu'à un ajustement manuel classique.
create or replace function public.mark_lot_expired(
  p_lot_id uuid,
  p_caller_id uuid,
  p_caller_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_store_id uuid;
  v_product_id uuid;
  v_lot_qty numeric;
  v_product_name text;
  v_inventory_id uuid;
  v_previous numeric;
  v_new numeric;
  v_unit_cost numeric;
  v_threshold numeric;
  v_loss numeric;
begin
  select product_lots.tenant_id, product_lots.store_id, product_lots.product_id, product_lots.quantity
    into v_tenant_id, v_store_id, v_product_id, v_lot_qty
    from product_lots where id = p_lot_id for update;

  if not found then
    raise exception 'NOT_FOUND: Lot introuvable';
  end if;
  if v_lot_qty <= 0 then
    raise exception 'INVALID_STATUS: Ce lot est deja a zero';
  end if;

  select name into v_product_name from products where id = v_product_id and tenant_id = v_tenant_id;

  select id, quantity into v_inventory_id, v_previous
    from inventory where tenant_id = v_tenant_id and store_id = v_store_id and product_id = v_product_id
    for update;
  if not found then
    v_previous := 0;
  end if;

  v_new := greatest(0, v_previous - v_lot_qty);

  -- Même garde-fou qu'un ajustement manuel : une péremption dont la valeur
  -- dépasse le seuil de perte est réservée au Propriétaire/Administrateur,
  -- sinon n'importe quel Manager pourrait passer une perte importante en
  -- "péremption" pour contourner le contrôle déjà en place sur les sorties
  -- manuelles (voir migration 069).
  if coalesce(p_caller_role, '') not in ('OWNER', 'ADMIN') then
    select coalesce(pc.purchase_price, p.selling_price, 0) into v_unit_cost
      from products p left join product_costs pc on pc.product_id = p.id
      where p.id = v_product_id and p.tenant_id = v_tenant_id;
    select stock_loss_approval_threshold into v_threshold from tenants where id = v_tenant_id;
    v_loss := (v_previous - v_new) * coalesce(v_unit_cost, 0);
    if v_loss > coalesce(v_threshold, 0) then
      raise exception 'FORBIDDEN: Cette peremption represente % FCFA, au-dessus du seuil de % FCFA. Un Proprietaire ou Administrateur doit s''en charger.',
        round(v_loss), round(coalesce(v_threshold, 0));
    end if;
  end if;

  update product_lots set quantity = 0 where id = p_lot_id;

  if v_inventory_id is null then
    insert into inventory (tenant_id, store_id, product_id, quantity)
      values (v_tenant_id, v_store_id, v_product_id, v_new);
  else
    update inventory set quantity = v_new where id = v_inventory_id;
  end if;

  insert into inventory_movements (
    tenant_id, product_id, product_name, store_id, type, quantity,
    previous_quantity, new_quantity, reason, created_by
  ) values (
    v_tenant_id, v_product_id, coalesce(v_product_name, 'Produit'), v_store_id, 'ADJUSTMENT',
    v_new - v_previous, v_previous, v_new, 'Peremption', p_caller_id
  );

  return jsonb_build_object(
    'success', true, 'previousQuantity', v_previous, 'newQuantity', v_new, 'lotQuantity', v_lot_qty
  );
end;
$function$;

revoke execute on function public.mark_lot_expired(uuid, uuid, text) from public, anon, authenticated;
