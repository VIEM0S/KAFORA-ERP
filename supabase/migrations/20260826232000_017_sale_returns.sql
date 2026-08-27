alter table sale_returns add column credit_reduction numeric not null default 0;
alter table sale_returns add column cash_refund numeric not null default 0;

create or replace function create_sale_return(
  p_tenant_id uuid, p_sale_id uuid, p_caller_id uuid, p_processed_by_name text,
  p_reason text, p_refund_method refund_method, p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status sale_status;
  v_store_id uuid;
  v_customer_id uuid;
  v_reference text;
  v_item jsonb;
  v_qty numeric;
  v_original record;
  v_purchasable numeric;
  v_net_unit_price numeric;
  v_line_total numeric;
  v_refund_amount numeric := 0;
  v_return_id uuid;
  v_prev_qty numeric;
  v_new_qty numeric;
  v_total_original_qty numeric;
  v_total_returned_qty numeric;
  v_new_sale_status sale_status;
  v_credit_id uuid;
  v_credit_remaining numeric;
  v_credit_status credit_status;
  v_credit_reduction numeric := 0;
  v_cash_refund numeric;
begin
  select status, store_id, customer_id, reference into v_status, v_store_id, v_customer_id, v_reference
    from sales where id = p_sale_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'NOT_FOUND: Vente introuvable';
  end if;
  if v_status not in ('COMPLETED', 'PARTIALLY_REFUNDED') then
    raise exception 'INVALID_STATUS: Impossible de retourner une vente %', v_status;
  end if;

  insert into sale_returns (
    tenant_id, sale_id, sale_reference, store_id, customer_id,
    refund_amount, refund_method, reason, status, processed_by, processed_by_name
  ) values (
    p_tenant_id, p_sale_id, coalesce(v_reference, p_sale_id::text), v_store_id, v_customer_id,
    0, p_refund_method, p_reason, 'COMPLETED', p_caller_id, p_processed_by_name
  ) returning id into v_return_id;

  -- ── Valider + traiter chaque ligne (verrou par ligne via FOR UPDATE) ────────
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, floor((v_item->>'quantity')::numeric));

    select id, product_id, product_name, quantity, unit_price, discount_percent, tax_rate, returned_quantity
      into v_original
      from sale_items where sale_id = p_sale_id and product_id = (v_item->>'product_id')::uuid
      for update;

    if not found then
      raise exception 'PRODUCT_NOT_IN_SALE: Produit % absent de la vente d''origine', v_item->>'product_id';
    end if;

    v_purchasable := v_original.quantity - coalesce(v_original.returned_quantity, 0);
    if v_qty > v_purchasable then
      raise exception 'QUANTITY_EXCEEDS: Quantité à retourner (%) supérieure à la quantité restituable (%) pour "%"',
        v_qty, v_purchasable, v_original.product_name;
    end if;

    -- Prix unitaire net (remise + taxe deja appliquees) recalcule a partir de
    -- la ligne d'origine — jamais depuis le client. Arrondi a l'unite : le
    -- franc CFA n'a pas de centimes, un remboursement a decimales ne peut
    -- pas etre rendu en caisse.
    v_net_unit_price := v_original.unit_price * (1 - coalesce(v_original.discount_percent, 0) / 100)
                         * (1 + coalesce(v_original.tax_rate, 0) / 100);
    v_line_total := round(v_net_unit_price * v_qty);
    v_refund_amount := v_refund_amount + v_line_total;

    update sale_items set returned_quantity = coalesce(returned_quantity, 0) + v_qty where id = v_original.id;

    insert into sale_return_items (sale_return_id, product_id, product_name, quantity, unit_price, total, restocked)
      values (v_return_id, v_original.product_id, v_original.product_name, v_qty, v_original.unit_price, v_line_total, (v_item->>'restock')::boolean);

    if (v_item->>'restock')::boolean then
      update inventory set quantity = quantity + v_qty
        where tenant_id = p_tenant_id and product_id = v_original.product_id and store_id = v_store_id
        returning quantity, quantity - v_qty into v_new_qty, v_prev_qty;

      if found then
        insert into inventory_movements (
          tenant_id, product_id, product_name, store_id, type, quantity,
          previous_quantity, new_quantity, sale_id, reason, created_by
        ) values (
          p_tenant_id, v_original.product_id, v_original.product_name, v_store_id, 'RETURN', v_qty,
          v_prev_qty, v_new_qty, p_sale_id, 'Retour client — vente ' || coalesce(v_reference, p_sale_id::text), p_caller_id
        );
      end if;
    end if;
  end loop;

  v_refund_amount := round(v_refund_amount);
  update sale_returns set refund_amount = v_refund_amount where id = v_return_id;

  -- ── Nouveau statut de la vente (retour total ou partiel) ────────────────────
  select sum(quantity), sum(coalesce(returned_quantity, 0)) into v_total_original_qty, v_total_returned_qty
    from sale_items where sale_id = p_sale_id;
  v_new_sale_status := case when v_total_returned_qty >= v_total_original_qty then 'REFUNDED' else 'PARTIALLY_REFUNDED' end;
  update sales set status = v_new_sale_status where id = p_sale_id;

  -- ── Imputation sur la dette avant tout remboursement en especes ─────────────
  -- Un retour sur une vente a credit doit D'ABORD reduire la dette : rendre
  -- des especes a un client qui doit encore de l'argent revient a le payer
  -- pour une marchandise qu'il n'a jamais reglee.
  select id, remaining_amount, status into v_credit_id, v_credit_remaining, v_credit_status
    from credits where sale_id = p_sale_id and tenant_id = p_tenant_id for update;

  v_cash_refund := v_refund_amount;
  if v_credit_id is not null then
    v_credit_reduction := least(v_refund_amount, coalesce(v_credit_remaining, 0));
    v_cash_refund := v_refund_amount - v_credit_reduction;

    if v_credit_reduction > 0 then
      update credits set
        remaining_amount = v_credit_remaining - v_credit_reduction,
        status = case when v_credit_remaining - v_credit_reduction = 0 then 'PAID'::credit_status else v_credit_status end
        where id = v_credit_id;

      if v_customer_id is not null then
        update customers set credit_used = greatest(0, coalesce(credit_used, 0) - v_credit_reduction)
          where id = v_customer_id;
      end if;
    end if;
  end if;

  -- Ventilation : ce qui a efface de la dette, et ce qui est reellement sorti
  -- du tiroir. Sans cette distinction, le rapprochement de caisse deduirait
  -- la totalite du remboursement, y compris la part qui n'a jamais quitte
  -- la caisse.
  update sale_returns set credit_reduction = v_credit_reduction, cash_refund = v_cash_refund where id = v_return_id;

  -- Alerte visible par les managers, comme les autres evenements sensibles.
  insert into alerts (tenant_id, type, severity, title, message, reference, reference_id)
    values (
      p_tenant_id, 'REFUND', (case when v_refund_amount > 50000 then 'HIGH' else 'MEDIUM' end)::alert_severity,
      'Retour client traité',
      format('Remboursement de %s sur la vente %s — motif : %s', v_refund_amount, coalesce(v_reference, p_sale_id::text), p_reason),
      'sale_returns', v_return_id::text
    );

  return jsonb_build_object('success', true, 'id', v_return_id, 'refundAmount', v_refund_amount);
end;
$$;

revoke execute on function create_sale_return(uuid, uuid, uuid, text, text, refund_method, jsonb) from public;
