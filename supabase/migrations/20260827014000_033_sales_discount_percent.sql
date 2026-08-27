-- p_discount_percent est deja recu par pos_checkout() mais n'etait jamais
-- persiste sur la vente (seul discount_amount l'etait) — l'affichage
-- "Remise (X%)" de sales/page.tsx n'avait donc plus rien a lire. Trouve
-- en portant cette page vers Supabase.
alter table sales add column discount_percent numeric;

CREATE OR REPLACE FUNCTION public.pos_checkout(p_tenant_id uuid, p_store_id uuid, p_cashier_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text, p_payment_method payment_method, p_subtotal numeric, p_discount_percent numeric, p_discount_amount numeric, p_tax_total numeric, p_total numeric, p_item_count numeric, p_amount_received numeric, p_change numeric, p_acompte numeric, p_solde_credit numeric, p_requires_credit_check boolean, p_offline_sync_id text, p_quote_id uuid, p_user_name text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fiscal_year int := extract(year from now())::int;
  v_seq int;
  v_reference text;
  v_sale_id uuid := gen_random_uuid();
  v_line jsonb;
  v_prev_qty numeric;
  v_new_qty numeric;
  v_stock_conflicts text[] := '{}';
  v_credit_conflict boolean := false;
  v_credit_used numeric;
  v_credit_limit numeric;
  v_cost_total numeric := 0;
  v_lines_without_cost int := 0;
  v_cost_by_category jsonb := '{}'::jsonb;
  v_cat_key text;
  v_line_cost numeric;
  v_credit_id uuid;
  v_alert_messages text[] := '{}';
begin
  if p_offline_sync_id is not null then
    declare
      v_existing record;
    begin
      select sale_id, reference into v_existing
        from sync_dedup where tenant_id = p_tenant_id and offline_sync_id = p_offline_sync_id;
      if found then
        return jsonb_build_object('success', true, 'saleId', v_existing.sale_id, 'reference', v_existing.reference, 'replay', true);
      end if;
    end;
  end if;

  insert into sale_counters (tenant_id, fiscal_year, value)
    values (p_tenant_id, v_fiscal_year, 1)
    on conflict (tenant_id, fiscal_year) do update set value = sale_counters.value + 1
    returning value into v_seq;
  v_reference := 'FAC-' || v_fiscal_year || '-' || lpad(v_seq::text, 6, '0');

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if (v_line->>'track_inventory')::boolean then
      update inventory
        set quantity = quantity - (v_line->>'quantity')::numeric
        where tenant_id = p_tenant_id and product_id = (v_line->>'product_id')::uuid and store_id = p_store_id
        returning quantity, quantity + (v_line->>'quantity')::numeric into v_new_qty, v_prev_qty;

      if found then
        if v_new_qty < 0 then
          if p_offline_sync_id is null then
            raise exception 'STOCK_INSUFFICIENT: Stock insuffisant pour "%" (% disponible, % demandé)',
              v_line->>'product_name', v_prev_qty, v_line->>'quantity';
          end if;
          v_stock_conflicts := array_append(v_stock_conflicts,
            format('Stock négatif : %s (%s dispo, %s vendu)', v_line->>'product_name', v_prev_qty, v_line->>'quantity'));
        end if;

        insert into inventory_movements (
          tenant_id, product_id, product_name, store_id, type, quantity,
          previous_quantity, new_quantity, sale_id, reason, created_by
        ) values (
          p_tenant_id, (v_line->>'product_id')::uuid, v_line->>'product_name', p_store_id, 'SALE',
          -(v_line->>'quantity')::numeric, v_prev_qty, v_new_qty, v_sale_id, 'Vente POS', p_cashier_id
        );
      end if;
    end if;
  end loop;

  if p_requires_credit_check then
    select credit_used, credit_limit into v_credit_used, v_credit_limit
      from customers where id = p_customer_id for update;

    if coalesce(v_credit_used, 0) + p_solde_credit > coalesce(v_credit_limit, 0) then
      if p_offline_sync_id is null then
        raise exception 'CREDIT_LIMIT_EXCEEDED: Plafond de crédit dépassé pour ce client. Crédit disponible : % FCFA.',
          greatest(0, coalesce(v_credit_limit, 0) - coalesce(v_credit_used, 0));
      end if;
      v_credit_conflict := true;
      v_alert_messages := array_append(v_alert_messages, format('Plafond de crédit dépassé pour %s', coalesce(p_customer_name, 'ce client')));
    end if;

    update customers set credit_used = coalesce(credit_used, 0) + p_solde_credit where id = p_customer_id;
  end if;

  insert into sales (
    id, tenant_id, reference, customer_id, customer_name, store_id, cashier_id, status,
    subtotal, tax_amount, discount_amount, discount_percent, total, paid_amount, change_given,
    payment_method, offline_sync_id, stock_conflict, credit_conflict
  ) values (
    v_sale_id, p_tenant_id, v_reference, p_customer_id, p_customer_name, p_store_id, p_cashier_id, 'COMPLETED',
    p_subtotal, p_tax_total, p_discount_amount, p_discount_percent, p_total, p_amount_received, p_change,
    p_payment_method, p_offline_sync_id, coalesce(array_length(v_stock_conflicts, 1), 0) > 0, v_credit_conflict
  );

  if p_offline_sync_id is not null then
    insert into sync_dedup (tenant_id, offline_sync_id, sale_id, reference)
      values (p_tenant_id, p_offline_sync_id, v_sale_id, v_reference);
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into sale_items (
      sale_id, tenant_id, product_id, product_name, product_sku, category_id,
      quantity, unit_price, purchase_price, discount_percent, tax_rate, total
    ) values (
      v_sale_id, p_tenant_id, (v_line->>'product_id')::uuid, v_line->>'product_name', v_line->>'product_sku',
      nullif(v_line->>'category_id','')::uuid, (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric,
      nullif(v_line->>'purchase_price','')::numeric, (v_line->>'discount_percent')::numeric,
      (v_line->>'tax_rate')::numeric, (v_line->>'total')::numeric
    );

    if (v_line->>'purchase_price') is null or v_line->>'purchase_price' = '' then
      v_lines_without_cost := v_lines_without_cost + 1;
    else
      v_line_cost := (v_line->>'quantity')::numeric * (v_line->>'purchase_price')::numeric;
      v_cost_total := v_cost_total + v_line_cost;
      v_cat_key := coalesce(v_line->>'category_id', 'uncategorized');
      v_cost_by_category := jsonb_set(
        v_cost_by_category, array[v_cat_key],
        to_jsonb(coalesce((v_cost_by_category->>v_cat_key)::numeric, 0) + v_line_cost)
      );
    end if;
  end loop;

  insert into payments (sale_id, tenant_id, method, amount, reference)
    values (v_sale_id, p_tenant_id, p_payment_method, p_total, null);

  insert into sale_cost_summary (
    sale_id, tenant_id, store_id, cost_total, margin, cost_by_category, cost_incomplete, lines_without_cost
  ) values (
    v_sale_id, p_tenant_id, p_store_id, v_cost_total, p_total - v_cost_total, v_cost_by_category,
    v_lines_without_cost > 0, v_lines_without_cost
  );

  if p_quote_id is not null then
    update quotes set status = 'CONVERTED', converted_sale_id = v_sale_id where id = p_quote_id;
  end if;

  if p_payment_method = 'CREDIT' and p_solde_credit > 0 and p_customer_id is not null then
    insert into credits (
      tenant_id, customer_id, customer_name, customer_phone, sale_id, reference, total_amount, paid_amount,
      remaining_amount, due_date, status
    ) values (
      p_tenant_id, p_customer_id, p_customer_name, p_customer_phone, v_sale_id, v_reference, p_total, p_acompte,
      p_solde_credit, now() + interval '30 days', 'PENDING'
    ) returning id into v_credit_id;

    if p_acompte > 0 then
      insert into credit_payments (credit_id, tenant_id, store_id, amount, payment_method, user_id, notes)
        values (v_credit_id, p_tenant_id, p_store_id, p_acompte, 'CASH', p_cashier_id, 'Acompte versé lors de la vente');
    end if;
  end if;

  if coalesce(array_length(v_stock_conflicts, 1), 0) > 0 or v_credit_conflict then
    insert into alerts (tenant_id, type, severity, title, message, reference, reference_id)
      values (
        p_tenant_id, 'OFFLINE_SYNC_CONFLICT', 'HIGH',
        'Conflit détecté après synchronisation hors-ligne',
        format('Vente %s — %s', v_reference, array_to_string(v_stock_conflicts || v_alert_messages, ' · ')),
        'sales', v_sale_id::text
      );
  end if;

  return jsonb_build_object('success', true, 'saleId', v_sale_id, 'reference', v_reference, 'total', p_total, 'change', p_change);
end;
$function$
