alter table sales add column cancellation_reason text;
alter table sales add column cancelled_by uuid references auth.users(id) on delete set null;
alter table sales add column cancelled_at timestamptz;

alter table credits add column cancellation_reason text;

create or replace function cancel_sale(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_caller_id uuid,
  p_motif text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status sale_status;
  v_store_id uuid;
  v_customer_id uuid;
  v_item record;
  v_prev_qty numeric;
  v_new_qty numeric;
  v_credit_id uuid;
  v_remaining numeric;
begin
  select status, store_id, customer_id into v_status, v_store_id, v_customer_id
    from sales where id = p_sale_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'NOT_FOUND: Vente introuvable';
  end if;
  -- On ne peut annuler qu'une vente encore intacte : si des articles ont deja
  -- ete retournes (PARTIALLY_REFUNDED), une annulation complete restaurerait
  -- deux fois le stock deja reintegre par le retour. Le verrou FOR UPDATE
  -- ci-dessus regle aussi le double-clic concurrent (la 2e requete attend
  -- le verrou puis retrouve un statut deja CANCELLED).
  if v_status != 'COMPLETED' then
    raise exception 'ALREADY_CANCELLED: Impossible d''annuler une vente %', v_status;
  end if;

  -- ── Restaurer le stock ligne par ligne ──────────────────────────────────
  for v_item in select product_id, product_name, quantity from sale_items where sale_id = p_sale_id
  loop
    if v_item.product_id is null then continue; end if;

    update inventory set quantity = quantity + v_item.quantity
      where tenant_id = p_tenant_id and product_id = v_item.product_id and store_id = v_store_id
      returning quantity, quantity - v_item.quantity into v_new_qty, v_prev_qty;

    if found then
      insert into inventory_movements (
        tenant_id, product_id, product_name, store_id, type, quantity,
        previous_quantity, new_quantity, sale_id, reason, created_by
      ) values (
        p_tenant_id, v_item.product_id, v_item.product_name, v_store_id, 'ADJUSTMENT', v_item.quantity,
        v_prev_qty, v_new_qty, p_sale_id,
        'Annulation vente #' || upper(left(p_sale_id::text, 8)) || ' — ' || p_motif, p_caller_id
      );
    end if;
  end loop;

  -- ── Credit lie a cette vente : soldé et plafond libéré ──────────────────
  -- On ne libere que le solde RESTANT, pas le montant initial : si le
  -- client a deja rembourse une partie, ces versements ont deja reduit son
  -- encours — liberer le total le crediterait a tort.
  select id, remaining_amount into v_credit_id, v_remaining
    from credits where sale_id = p_sale_id and tenant_id = p_tenant_id for update;

  if v_credit_id is not null then
    update credits set remaining_amount = 0, status = 'CANCELLED', cancellation_reason = p_motif
      where id = v_credit_id;

    if v_customer_id is not null and v_remaining > 0 then
      update customers set credit_used = greatest(0, coalesce(credit_used, 0) - v_remaining)
        where id = v_customer_id;
    end if;
  end if;

  update sales set
    status = 'CANCELLED', cancellation_reason = p_motif,
    cancelled_by = p_caller_id, cancelled_at = now()
    where id = p_sale_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function cancel_sale(uuid, uuid, uuid, text) from public;
