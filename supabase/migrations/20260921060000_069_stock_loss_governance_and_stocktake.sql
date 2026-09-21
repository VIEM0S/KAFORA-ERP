-- Gouvernance des pertes de stock + inventaire physique (comptage).
--
-- Constat (comparaison avec MANDE-SOLAIRE-DEYE-ERP) : adjust_inventory() acceptait
-- n'importe quelle sortie de stock d'un Responsable — 1 000 unités retirées,
-- motif facultatif, aucune relecture. Kafora n'avait pas non plus de comptage
-- physique pour rapprocher le stock réel du stock théorique. Or la démarque
-- (casse, vol, erreurs) est le premier trou d'argent d'un commerce.
--
-- Deux garde-fous complémentaires, autour d'un seul seuil configurable
-- (tenants.stock_loss_approval_threshold, en FCFA, valeur au coût d'achat) :
--
--  1. Ajustement manuel : un Responsable ne peut plus retirer du stock pour une
--     valeur supérieure au seuil. Il doit passer par un inventaire physique
--     (ci-dessous), dont l'écart est validé par le Propriétaire/Administrateur.
--     Le Propriétaire/Administrateur n'est pas bloqué (personne au-dessus).
--  2. Inventaire physique : comptage par magasin. Sous le seuil de perte, les
--     écarts sont appliqués directement ; au-dessus, l'inventaire attend la
--     validation d'une AUTRE personne habilitée (pas d'auto-validation).
--
-- Les écarts sont appliqués en DELTA (compté − théorique au démarrage) sur la
-- quantité ACTUELLE, sous verrou : une vente faite pendant le comptage n'est
-- jamais écrasée. Toute écriture passe par RPC + inventory_movements + audit_log.
-- Les produits à numéros de série sont exclus (chaque exemplaire est suivi
-- individuellement : un comptage agrégé ferait diverger le stock et les séries).

alter table tenants add column stock_loss_approval_threshold numeric not null default 50000;

alter type alert_type add value 'STOCKTAKE_PENDING';
alter type alert_type add value 'STOCKTAKE_DECIDED';

-- ─── 1. Garde-fou sur l'ajustement manuel ────────────────────────────────────
drop function if exists public.adjust_inventory(uuid, uuid, uuid, text, text, int, boolean, int, text, uuid);

create or replace function public.adjust_inventory(
  p_tenant_id uuid,
  p_store_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_mode text, -- 'add' | 'remove' | 'set'
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

  -- Sortie de stock au-dessus du seuil : réservée au Propriétaire/Administrateur
  -- (les autres passent par un inventaire physique validé).
  if v_new < v_previous and coalesce(p_caller_role, '') not in ('OWNER', 'ADMIN') then
    select coalesce(purchase_price, selling_price, 0) into v_unit_cost
      from products where id = p_product_id and tenant_id = p_tenant_id;
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

revoke execute on function public.adjust_inventory(uuid, uuid, uuid, text, text, int, boolean, int, text, uuid, text) from public, anon, authenticated;

-- ─── 2. Inventaire physique ──────────────────────────────────────────────────
create table stocktakes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  status text not null default 'IN_PROGRESS'
    check (status in ('IN_PROGRESS','PENDING_APPROVAL','COMPLETED','REJECTED','CANCELLED')),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  loss_value numeric,
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  completed_at timestamptz
);
-- Un seul inventaire ouvert à la fois par magasin.
create unique index uq_stocktakes_open_per_store on stocktakes(store_id)
  where status in ('IN_PROGRESS','PENDING_APPROVAL');
create index idx_stocktakes_tenant on stocktakes(tenant_id, created_at desc);

create table stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  stocktake_id uuid not null references stocktakes(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  product_name text not null,
  sku text,
  expected_qty numeric not null,
  counted_qty numeric check (counted_qty is null or counted_qty >= 0),
  unit_cost numeric not null default 0,
  unique (stocktake_id, product_id)
);
create index idx_stocktake_lines_stocktake on stocktake_lines(stocktake_id);

alter table stocktakes enable row level security;
alter table stocktake_lines enable row level security;
create policy stocktakes_select on stocktakes for select
  using (belongs_to_tenant(tenant_id) and is_manager() and can_access_store(store_id));
create policy stocktake_lines_select on stocktake_lines for select
  using (belongs_to_tenant(tenant_id) and is_manager() and can_access_store(store_id));
-- Aucune écriture directe : uniquement les RPC ci-dessous.
revoke insert, update, delete on stocktakes from authenticated, anon;
revoke insert, update, delete on stocktake_lines from authenticated, anon;
alter publication supabase_realtime add table stocktakes;
alter publication supabase_realtime add table stocktake_lines;

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

  -- Photo du stock théorique à cet instant (produits actifs, suivis en stock,
  -- hors numéros de série).
  insert into stocktake_lines (tenant_id, store_id, stocktake_id, product_id, product_name, sku, expected_qty, unit_cost)
  select v_tenant, p_store_id, v_id, p.id, p.name, p.sku, coalesce(i.quantity, 0),
         coalesce(p.purchase_price, p.selling_price, 0)
    from products p
    left join inventory i on i.product_id = p.id and i.store_id = p_store_id
   where p.tenant_id = v_tenant and p.is_active and p.track_inventory and not p.track_serial;
  get diagnostics v_count = row_count;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant, 'STOCKTAKE_STARTED', 'stocktake', v_id, v_actor_id, p_user_name, v_actor_role::user_role, p_store_id,
    jsonb_build_object('products', v_count));

  return jsonb_build_object('success', true, 'id', v_id, 'products', v_count);
end;
$$;

create or replace function save_stocktake_counts(p_id uuid, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_store uuid;
  v_status text;
  v_item jsonb;
  v_saved int := 0;
  v_n int;
begin
  select tenant_id, store_id, status into v_tenant, v_store, v_status from stocktakes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: Inventaire introuvable'; end if;
  if not (can_write(v_tenant) and is_manager() and can_access_store(v_store)) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission de modifier cet inventaire';
  end if;
  if v_status <> 'IN_PROGRESS' then
    raise exception 'INVALID_STATUS: Cet inventaire n''est plus modifiable';
  end if;

  for v_item in select * from jsonb_array_elements(p_counts) loop
    if (v_item->>'counted') is not null and (v_item->>'counted')::numeric < 0 then
      raise exception 'INVALID_INPUT: Une quantité comptée ne peut pas être négative';
    end if;
    update stocktake_lines set counted_qty = nullif(v_item->>'counted', '')::numeric
      where stocktake_id = p_id and product_id = (v_item->>'product_id')::uuid;
    get diagnostics v_n = row_count;
    v_saved := v_saved + v_n;
  end loop;

  return jsonb_build_object('success', true, 'saved', v_saved);
end;
$$;

-- Applique les écarts d'un inventaire (interne : appelée seulement par les RPC
-- ci-dessous, jamais exposée). Delta = compté − théorique au démarrage,
-- appliqué à la quantité ACTUELLE sous verrou.
create or replace function apply_stocktake(p_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_store uuid;
  v_line stocktake_lines%rowtype;
  v_inv_id uuid;
  v_current numeric;
  v_new numeric;
begin
  select tenant_id, store_id into v_tenant, v_store from stocktakes where id = p_id;

  for v_line in select * from stocktake_lines where stocktake_id = p_id and counted_qty is not null loop
    select id, quantity into v_inv_id, v_current
      from inventory where tenant_id = v_tenant and store_id = v_store and product_id = v_line.product_id
      for update;
    if not found then
      v_inv_id := null; v_current := 0;
    end if;

    v_new := greatest(0, v_current + (v_line.counted_qty - v_line.expected_qty));

    if v_new <> v_current then
      if v_inv_id is null then
        insert into inventory (tenant_id, store_id, product_id, quantity, last_stock_check)
        values (v_tenant, v_store, v_line.product_id, v_new, now());
      else
        update inventory set quantity = v_new, last_stock_check = now() where id = v_inv_id;
      end if;
      insert into inventory_movements (
        tenant_id, product_id, product_name, store_id, type, quantity,
        previous_quantity, new_quantity, reason, created_by
      ) values (
        v_tenant, v_line.product_id, v_line.product_name, v_store, 'ADJUSTMENT',
        v_new - v_current, v_current, v_new, 'Inventaire physique', p_actor
      );
    elsif v_inv_id is not null then
      update inventory set last_stock_check = now() where id = v_inv_id;
    end if;
  end loop;
end;
$$;
revoke execute on function apply_stocktake(uuid, uuid) from public, anon, authenticated;

create or replace function submit_stocktake(p_id uuid, p_user_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_store uuid;
  v_status text;
  v_counted int;
  v_loss numeric;
  v_threshold numeric;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select tenant_id, store_id, status into v_tenant, v_store, v_status from stocktakes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: Inventaire introuvable'; end if;
  if not (can_write(v_tenant) and is_manager() and can_access_store(v_store)) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission de terminer cet inventaire';
  end if;
  if v_status <> 'IN_PROGRESS' then
    raise exception 'INVALID_STATUS: Cet inventaire n''est plus en cours';
  end if;

  select count(*), coalesce(sum(greatest(expected_qty - counted_qty, 0) * unit_cost), 0)
    into v_counted, v_loss
    from stocktake_lines where stocktake_id = p_id and counted_qty is not null;
  if v_counted = 0 then
    raise exception 'INVALID_INPUT: Aucun produit n''a été compté';
  end if;

  select stock_loss_approval_threshold into v_threshold from tenants where id = v_tenant;

  if v_loss > coalesce(v_threshold, 0) and not is_owner_or_admin() then
    update stocktakes set status = 'PENDING_APPROVAL', submitted_at = now(), loss_value = v_loss where id = p_id;
    insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
    values (v_tenant, 'STOCKTAKE_SUBMITTED', 'stocktake', p_id, v_actor_id, p_user_name, v_actor_role::user_role, v_store,
      jsonb_build_object('counted', v_counted, 'loss_value', v_loss, 'threshold', v_threshold));
    return jsonb_build_object('success', true, 'status', 'PENDING_APPROVAL', 'lossValue', v_loss, 'threshold', v_threshold);
  end if;

  perform apply_stocktake(p_id, v_actor_id);
  update stocktakes set status = 'COMPLETED', submitted_at = now(), completed_at = now(), loss_value = v_loss where id = p_id;
  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant, 'STOCKTAKE_COMPLETED', 'stocktake', p_id, v_actor_id, p_user_name, v_actor_role::user_role, v_store,
    jsonb_build_object('counted', v_counted, 'loss_value', v_loss));
  return jsonb_build_object('success', true, 'status', 'COMPLETED', 'lossValue', v_loss);
end;
$$;

create or replace function decide_stocktake(p_id uuid, p_approve boolean, p_note text, p_user_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_store uuid;
  v_status text;
  v_created_by uuid;
  v_loss numeric;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select tenant_id, store_id, status, created_by, loss_value
    into v_tenant, v_store, v_status, v_created_by, v_loss
    from stocktakes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: Inventaire introuvable'; end if;
  if not (can_write(v_tenant) and is_owner_or_admin()) then
    raise exception 'FORBIDDEN: Seuls le Propriétaire ou un Administrateur peuvent valider un inventaire';
  end if;
  if v_status <> 'PENDING_APPROVAL' then
    raise exception 'INVALID_STATUS: Cet inventaire n''est pas en attente de validation';
  end if;
  if v_actor_id = v_created_by then
    raise exception 'FORBIDDEN: Vous ne pouvez pas valider votre propre inventaire — une autre personne habilitée doit le faire';
  end if;
  if not p_approve and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'INVALID_INPUT: Un motif est obligatoire pour refuser un inventaire';
  end if;

  if p_approve then
    perform apply_stocktake(p_id, v_actor_id);
  end if;

  update stocktakes set
    status = case when p_approve then 'COMPLETED' else 'REJECTED' end,
    decided_by = v_actor_id, decided_by_name = p_user_name, decided_at = now(),
    decision_note = nullif(trim(coalesce(p_note, '')), ''),
    completed_at = case when p_approve then now() else null end
  where id = p_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant, case when p_approve then 'STOCKTAKE_APPROVED' else 'STOCKTAKE_REJECTED' end,
    'stocktake', p_id, v_actor_id, p_user_name, v_actor_role::user_role, v_store,
    jsonb_build_object('loss_value', v_loss, 'note', nullif(trim(coalesce(p_note, '')), '')));

  return jsonb_build_object('success', true, 'createdBy', v_created_by, 'lossValue', v_loss);
end;
$$;

create or replace function cancel_stocktake(p_id uuid, p_user_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_store uuid;
  v_status text;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select tenant_id, store_id, status into v_tenant, v_store, v_status from stocktakes where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: Inventaire introuvable'; end if;
  if not (can_write(v_tenant) and is_manager() and can_access_store(v_store)) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission d''annuler cet inventaire';
  end if;
  if v_status not in ('IN_PROGRESS', 'PENDING_APPROVAL') then
    raise exception 'INVALID_STATUS: Cet inventaire est déjà terminé';
  end if;
  if v_status = 'PENDING_APPROVAL' and not is_owner_or_admin() then
    raise exception 'FORBIDDEN: Seul le Propriétaire ou un Administrateur peut annuler un inventaire soumis';
  end if;

  update stocktakes set status = 'CANCELLED' where id = p_id;
  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant, 'STOCKTAKE_CANCELLED', 'stocktake', p_id, v_actor_id, p_user_name, v_actor_role::user_role, v_store, '{}'::jsonb);
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function start_stocktake(uuid, text) from public, anon;
revoke execute on function save_stocktake_counts(uuid, jsonb) from public, anon;
revoke execute on function submit_stocktake(uuid, text) from public, anon;
revoke execute on function decide_stocktake(uuid, boolean, text, text) from public, anon;
revoke execute on function cancel_stocktake(uuid, text) from public, anon;
grant execute on function start_stocktake(uuid, text) to authenticated;
grant execute on function save_stocktake_counts(uuid, jsonb) to authenticated;
grant execute on function submit_stocktake(uuid, text) to authenticated;
grant execute on function decide_stocktake(uuid, boolean, text, text) to authenticated;
grant execute on function cancel_stocktake(uuid, text) to authenticated;

-- ─── Compatibilité transitoire ───────────────────────────────────────────────
-- L'ancien code déployé appelle adjust_inventory() SANS p_caller_role. Cette
-- surcharge à 10 arguments délègue avec un rôle inconnu (garde-fou le plus
-- strict) le temps du déploiement de la nouvelle route. À SUPPRIMER une fois
-- /api/inventory/adjust déployée avec p_caller_role :
--   drop function public.adjust_inventory(uuid, uuid, uuid, text, text, int, boolean, int, text, uuid);
create or replace function public.adjust_inventory(
  p_tenant_id uuid, p_store_id uuid, p_product_id uuid, p_product_name text, p_mode text, p_amount int,
  p_has_min_quantity boolean, p_min_quantity int, p_reason text, p_caller_id uuid
) returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select public.adjust_inventory(p_tenant_id, p_store_id, p_product_id, p_product_name, p_mode, p_amount,
    p_has_min_quantity, p_min_quantity, p_reason, p_caller_id, null::text)
$$;
revoke execute on function public.adjust_inventory(uuid, uuid, uuid, text, text, int, boolean, int, text, uuid) from public, anon, authenticated;
