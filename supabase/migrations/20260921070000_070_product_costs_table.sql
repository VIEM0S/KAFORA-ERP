-- Prix d'achat des produits : PHASE 1 (additive, compatible avec l'ancien code).
--
-- Constat (2026-09-21, confirmé en réel avec un compte MANAGER) : products
-- porte purchase_price, et products_select laisse lire TOUTE la ligne à
-- n'importe quel membre du tenant — y compris un Caissier via l'API directe.
-- Le masquage n'existait que dans l'affichage. Le choix retenu est cohérent
-- avec sale_cost_summary (déjà réservé aux Managers+) : le coût d'achat est
-- visible des Managers et plus, jamais d'un Caissier.
--
-- Un privilège de colonne ne peut pas distinguer un Manager d'un Caissier
-- (même rôle base de données `authenticated`) : le coût vit donc dans sa
-- propre table, avec sa propre politique RLS. Les écrans en lisent la valeur
-- par jointure (products + product_costs) ; pour un Caissier, la jointure
-- renvoie simplement null.
--
-- Migration en DEUX phases pour ne pas casser la production entre
-- l'application de la base et le déploiement du code :
--   phase 1 (ce fichier) : table + copie des valeurs + synchronisation depuis
--     l'ancienne colonne. L'ancien code (qui lit/écrit products.purchase_price)
--     continue de fonctionner, le nouveau lit/écrit product_costs.
--   phase 2 (071, appliquée APRÈS le déploiement) : suppression de la colonne
--     et de la synchronisation, restriction des colonnes de sale_items.

create table product_costs (
  product_id uuid primary key references products(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  purchase_price numeric
);
create index idx_product_costs_tenant on product_costs(tenant_id);

insert into product_costs (product_id, tenant_id, purchase_price)
select id, tenant_id, purchase_price from products where purchase_price is not null;

alter table product_costs enable row level security;
create policy product_costs_select on product_costs for select
  using (belongs_to_tenant(tenant_id) and is_manager());
create policy product_costs_insert on product_costs for insert
  with check (
    can_write(tenant_id) and is_manager()
    and exists (select 1 from products p where p.id = product_costs.product_id and p.tenant_id = product_costs.tenant_id)
  );
create policy product_costs_update on product_costs for update
  using (can_write(tenant_id) and is_manager())
  with check (
    can_write(tenant_id) and is_manager()
    and exists (select 1 from products p where p.id = product_costs.product_id and p.tenant_id = product_costs.tenant_id)
  );
-- Pas de politique DELETE : la ligne disparaît avec son produit (cascade).

-- Compatibilité transitoire : l'ancien code écrit encore products.purchase_price.
-- À SUPPRIMER en phase 2 (071).
create or replace function sync_product_cost_compat() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.purchase_price is not distinct from new.purchase_price then
    return new;
  end if;
  insert into product_costs (product_id, tenant_id, purchase_price)
  values (new.id, new.tenant_id, new.purchase_price)
  on conflict (product_id) do update set purchase_price = excluded.purchase_price;
  return new;
end;
$$;

create trigger trg_sync_product_cost_compat
  after insert or update of purchase_price on products
  for each row execute function sync_product_cost_compat();

-- Réception d'un bon de commande : le coût moyen pondéré est lu/écrit dans
-- product_costs. La ligne products.purchase_price est encore mise à jour le
-- temps de la transition (l'ancien code la lit) — retirée en phase 2.
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
      update products set purchase_price = v_weighted_cost where id = v_item.product_id; -- compat, retiré en 071
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

-- Les coûts d'achat des bons de commande ne concernent pas un Caissier : les
-- lignes et les bons ne sont plus lisibles que des Managers+ (les écrans
-- correspondants leur sont déjà réservés).
drop policy if exists purchase_order_items_select on purchase_order_items;
create policy purchase_order_items_select on purchase_order_items for select
  using (exists (
    select 1 from purchase_orders p
    where p.id = purchase_order_items.purchase_order_id
      and belongs_to_tenant(p.tenant_id) and is_manager() and can_access_store(p.store_id)
  ));

drop policy if exists purchase_orders_select on purchase_orders;
create policy purchase_orders_select on purchase_orders for select
  using (belongs_to_tenant(tenant_id) and is_manager() and can_access_store(store_id));
