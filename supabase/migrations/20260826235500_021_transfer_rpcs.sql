-- Expedie un transfert : le stock SORT du magasin source. Refuse en bloc
-- (pas de sortie partielle) si un seul produit manque de stock — l'exception
-- fait rollback TOUTE la transaction, y compris les decrements deja faits
-- sur d'autres lignes dans cette meme boucle.
create or replace function ship_transfer(
  p_tenant_id uuid, p_transfer_id uuid, p_caller_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status transfer_status;
  v_from_store_id uuid;
  v_line record;
  v_new_qty numeric;
begin
  select status, from_store_id into v_status, v_from_store_id
    from transfers where id = p_transfer_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'NOT_FOUND: Transfert introuvable';
  end if;
  if v_status != 'APPROVED' then
    raise exception 'INVALID_STATUS: Ce transfert ne peut pas être expédié (%)', v_status;
  end if;

  for v_line in select product_id, product_name, quantity from transfer_lines where transfer_id = p_transfer_id
  loop
    update inventory set quantity = quantity - v_line.quantity
      where tenant_id = p_tenant_id and product_id = v_line.product_id and store_id = v_from_store_id
      returning quantity into v_new_qty;

    if not found then
      raise exception 'NO_STOCK: Aucun stock enregistré pour : %', coalesce(v_line.product_name, v_line.product_id::text);
    end if;
    if v_new_qty < 0 then
      raise exception 'INSUFFICIENT_STOCK: Stock insuffisant : % (% disponible)',
        coalesce(v_line.product_name, v_line.product_id::text), v_new_qty + v_line.quantity;
    end if;

    insert into inventory_movements (
      tenant_id, product_id, product_name, store_id, type, quantity,
      previous_quantity, new_quantity, transfer_id, reason, created_by
    ) values (
      p_tenant_id, v_line.product_id, v_line.product_name, v_from_store_id, 'TRANSFER_OUT', -v_line.quantity,
      v_new_qty + v_line.quantity, v_new_qty, p_transfer_id, 'Transfert vers un autre magasin', p_caller_id
    );
  end loop;

  update transfers set status = 'SHIPPED', shipped_by = p_caller_id, shipped_at = now() where id = p_transfer_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function ship_transfer(uuid, uuid, uuid) from public;

-- Confirme la reception : le stock ENTRE au magasin destination. Cree la
-- ligne d'inventaire si le produit n'y avait encore jamais ete vendu.
create or replace function receive_transfer(
  p_tenant_id uuid, p_transfer_id uuid, p_caller_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status transfer_status;
  v_to_store_id uuid;
  v_line record;
  v_new_qty numeric;
begin
  select status, to_store_id into v_status, v_to_store_id
    from transfers where id = p_transfer_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'NOT_FOUND: Transfert introuvable';
  end if;
  if v_status != 'SHIPPED' then
    raise exception 'INVALID_STATUS: Ce transfert ne peut pas être reçu (%)', v_status;
  end if;

  for v_line in select product_id, product_name, quantity from transfer_lines where transfer_id = p_transfer_id
  loop
    insert into inventory (tenant_id, product_id, store_id, quantity)
      values (p_tenant_id, v_line.product_id, v_to_store_id, v_line.quantity)
      on conflict (tenant_id, product_id, store_id) do update set quantity = inventory.quantity + v_line.quantity
      returning quantity into v_new_qty;

    insert into inventory_movements (
      tenant_id, product_id, product_name, store_id, type, quantity,
      previous_quantity, new_quantity, transfer_id, reason, created_by
    ) values (
      p_tenant_id, v_line.product_id, v_line.product_name, v_to_store_id, 'TRANSFER_IN', v_line.quantity,
      v_new_qty - v_line.quantity, v_new_qty, p_transfer_id, 'Réception d''un transfert', p_caller_id
    );
  end loop;

  update transfers set status = 'RECEIVED', received_by = p_caller_id, received_at = now() where id = p_transfer_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function receive_transfer(uuid, uuid, uuid) from public;

-- Approuve, refuse ou annule un transfert. Le cas sensible est l'annulation
-- d'un transfert DEJA EXPEDIE : le stock est restitue a la source, avec un
-- mouvement qui garde la trace de l'aller et du retour.
create or replace function decide_transfer(
  p_tenant_id uuid, p_transfer_id uuid, p_caller_id uuid,
  p_action text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status transfer_status;
  v_from_store_id uuid;
  v_target transfer_status;
  v_line record;
  v_new_qty numeric;
begin
  if p_action not in ('APPROVE', 'REJECT', 'CANCEL') then
    raise exception 'INVALID_ACTION: Action inconnue';
  end if;
  v_target := case p_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'CANCELLED' end;

  select status, from_store_id into v_status, v_from_store_id
    from transfers where id = p_transfer_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'NOT_FOUND: Transfert introuvable';
  end if;

  if p_action in ('APPROVE', 'REJECT') and v_status != 'PENDING' then
    raise exception 'INVALID_STATUS: Action impossible depuis l''état « % »', v_status;
  end if;
  if p_action = 'CANCEL' and v_status not in ('PENDING', 'APPROVED', 'SHIPPED') then
    raise exception 'INVALID_STATUS: Action impossible depuis l''état « % »', v_status;
  end if;

  -- Restitution necessaire uniquement si le stock est deja sorti.
  if p_action = 'CANCEL' and v_status = 'SHIPPED' then
    for v_line in select product_id, product_name, quantity from transfer_lines where transfer_id = p_transfer_id
    loop
      insert into inventory (tenant_id, product_id, store_id, quantity)
        values (p_tenant_id, v_line.product_id, v_from_store_id, v_line.quantity)
        on conflict (tenant_id, product_id, store_id) do update set quantity = inventory.quantity + v_line.quantity
        returning quantity into v_new_qty;

      insert into inventory_movements (
        tenant_id, product_id, product_name, store_id, type, quantity,
        previous_quantity, new_quantity, transfer_id, reason, created_by
      ) values (
        p_tenant_id, v_line.product_id, v_line.product_name, v_from_store_id, 'TRANSFER_CANCEL', v_line.quantity,
        v_new_qty - v_line.quantity, v_new_qty, p_transfer_id,
        'Annulation d''un transfert expédié — retour au magasin source', p_caller_id
      );
    end loop;
  end if;

  update transfers set
    status = v_target,
    approved_by = case when p_action = 'APPROVE' then p_caller_id else approved_by end,
    approved_at = case when p_action = 'APPROVE' then now() else approved_at end,
    rejection_reason = case when p_action = 'REJECT' then p_reason else rejection_reason end
    where id = p_transfer_id;

  return jsonb_build_object('success', true, 'restocked', p_action = 'CANCEL' and v_status = 'SHIPPED');
end;
$$;

revoke execute on function decide_transfer(uuid, uuid, uuid, text, text) from public;
