-- Différenciation sectorielle (suite) : pos_checkout() gagne deux branches
-- additives pour les produits à suivi de péremption ou de série (migration
-- 041) — voir aussi migration 042 (réception) et la page POS.
--
-- Principe de sûreté : le décrément de inventory.quantity et son contrôle
-- de stock négatif (le "vrai" garde-fou, déjà audité — voir mémoire
-- project_dsi_technical_audit) restent EXACTEMENT comme avant, intouchés,
-- pour TOUS les produits. Les deux branches ci-dessous sont purement
-- additives :
--   - péremption : consomme les lots en FEFO (le plus proche d'abord) pour
--     que la ventilation product_lots reste juste ; un écart de ventilation
--     (rare, signale une incohérence de données antérieure) ne bloque
--     jamais la vente, seulement signalé en conflit hors-ligne comme les
--     conflits de stock existants.
--   - série : vérifie que chaque numéro demandé est bien IN_STOCK avant de
--     le marquer SOLD. Contrairement à la péremption, VENDRE DEUX FOIS LE
--     MÊME APPAREIL est une vraie erreur — bloquant en ligne (comme
--     STOCK_INSUFFICIENT), conflit signalé hors-ligne (comme les autres).
--
-- Le court-circuit de rejeu (sync_dedup) en tête de fonction, inchangé,
-- protège ces deux branches de la même façon que le reste : un second
-- appel avec le même offline_sync_id retourne replay:true avant d'atteindre
-- ce code, donc aucun double décrément ni double vente de série.
create or replace function pos_checkout(
  p_tenant_id uuid,
  p_store_id uuid,
  p_cashier_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_payment_method payment_method,
  p_subtotal numeric,
  p_discount_percent numeric,
  p_discount_amount numeric,
  p_tax_total numeric,
  p_total numeric,
  p_item_count numeric,
  p_amount_received numeric,
  p_change numeric,
  p_acompte numeric,
  p_solde_credit numeric,
  p_requires_credit_check boolean,
  p_offline_sync_id text,
  p_quote_id uuid,
  p_user_name text,
  -- [{product_id, product_name, product_sku, category_id, quantity,
  --   unit_price, purchase_price, discount_percent, tax_rate, total,
  --   track_inventory, track_expiry, track_serial, serials?: string[]}]
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiscal_year int := extract(year from now())::int;
  v_seq int;
  v_reference text;
  v_sale_id uuid := gen_random_uuid();
  v_line jsonb;
  v_prev_qty numeric;
  v_new_qty numeric;
  -- array_length(v_stock_conflicts, 1) renvoie NULL (pas 0) tant que le
  -- tableau est vide — toujours l'envelopper de coalesce(..., 0) plus bas.
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
  -- Péremption/série : résultats accumulés pendant la boucle de stock,
  -- réutilisés dans la boucle d'insertion des lignes de vente plus bas.
  v_serials_sold jsonb := '{}'::jsonb;
begin
  -- ── Rejeu idempotent (synchronisation hors-ligne) ──────────────────────────
  if p_offline_sync_id is not null then
    declare
      v_existing record;
    begin
      select sale_id, reference into v_existing
        from sync_dedup where tenant_id = p_tenant_id and offline_sync_id = p_offline_sync_id;
      if found then
        return jsonb_build_object(
          'success', true, 'saleId', v_existing.sale_id, 'reference', v_existing.reference, 'replay', true
        );
      end if;
    end;
  end if;

  -- ── Numerotation sequentielle legale ────────────────────────────────────────
  insert into sale_counters (tenant_id, fiscal_year, value)
    values (p_tenant_id, v_fiscal_year, 1)
    on conflict (tenant_id, fiscal_year) do update set value = sale_counters.value + 1
    returning value into v_seq;
  v_reference := 'FAC-' || v_fiscal_year || '-' || lpad(v_seq::text, 6, '0');

  -- ── Stock : decrement atomique ligne par ligne ──────────────────────────────
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

        -- ── Péremption (FEFO) : consomme les lots, ne bloque jamais la vente ──
        if coalesce((v_line->>'track_expiry')::boolean, false) then
          declare
            v_need numeric := (v_line->>'quantity')::numeric;
            v_lot record;
            v_take numeric;
          begin
            for v_lot in
              select id, quantity from product_lots
              where tenant_id = p_tenant_id and product_id = (v_line->>'product_id')::uuid and store_id = p_store_id
                and quantity > 0
              order by expiry_date asc
              for update
            loop
              exit when v_need <= 0;
              v_take := least(v_lot.quantity, v_need);
              update product_lots set quantity = quantity - v_take where id = v_lot.id;
              v_need := v_need - v_take;
            end loop;
            -- v_need > 0 restant = écart entre inventory.quantity (la garde
            -- bloquante ci-dessus) et la somme des lots détaillés — signalé,
            -- jamais bloquant : la ventilation par lot est un détail, pas
            -- la source de vérité du stock.
            if v_need > 0 and p_offline_sync_id is not null then
              v_stock_conflicts := array_append(v_stock_conflicts,
                format('Lots insuffisants pour %s (%s non ventilé)', v_line->>'product_name', v_need));
            end if;
          end;
        end if;

        -- ── Série/IMEI : vend exactement les exemplaires demandés, jamais deux
        -- fois le même ────────────────────────────────────────────────────────
        if coalesce((v_line->>'track_serial')::boolean, false) then
          declare
            v_serial text;
            v_sold text[] := '{}';
            v_missing text[] := '{}';
            v_updated int;
          begin
            for v_serial in select value from jsonb_array_elements_text(coalesce(v_line->'serials', '[]'::jsonb))
            loop
              -- sale_id/sold_at pas encore renseignés ici : la ligne
              -- `sales` correspondante n'existe pas encore à ce stade de la
              -- fonction (FK product_serials_sale_id_fkey), elle n'est
              -- insérée que plus bas — voir la boucle de rattachement
              -- juste après `insert into sales`.
              update product_serials set status = 'SOLD'
                where tenant_id = p_tenant_id and product_id = (v_line->>'product_id')::uuid and store_id = p_store_id
                  and serial_number = v_serial and status = 'IN_STOCK';
              get diagnostics v_updated = row_count;
              if v_updated > 0 then
                v_sold := array_append(v_sold, v_serial);
              else
                v_missing := array_append(v_missing, v_serial);
              end if;
            end loop;
            if array_length(v_missing, 1) > 0 then
              if p_offline_sync_id is null then
                raise exception 'SERIAL_UNAVAILABLE: Déjà vendu ou introuvable : %', array_to_string(v_missing, ', ');
              end if;
              v_stock_conflicts := array_append(v_stock_conflicts,
                format('Numéro(s) déjà vendu(s) pour %s : %s', v_line->>'product_name', array_to_string(v_missing, ', ')));
            end if;
            v_serials_sold := jsonb_set(v_serials_sold, array[v_line->>'product_id'], to_jsonb(array_to_string(v_sold, ', ')));
          end;
        end if;
      end if;
    end if;
  end loop;

  -- ── Crédit client : verrou de ligne puis verification+increment ────────────
  if p_requires_credit_check then
    select credit_used, credit_limit into v_credit_used, v_credit_limit
      from customers where id = p_customer_id for update;

    if coalesce(v_credit_used, 0) + p_solde_credit > coalesce(v_credit_limit, 0) then
      if p_offline_sync_id is null then
        raise exception 'CREDIT_LIMIT_EXCEEDED: Plafond de crédit dépassé pour ce client. Crédit disponible : % FCFA.',
          greatest(0, coalesce(v_credit_limit, 0) - coalesce(v_credit_used, 0));
      end if;
      v_credit_conflict := true;
      v_alert_messages := array_append(v_alert_messages,
        format('Plafond de crédit dépassé pour %s', coalesce(p_customer_name, 'ce client')));
    end if;

    update customers set credit_used = coalesce(credit_used, 0) + p_solde_credit where id = p_customer_id;
  end if;

  -- ── Vente ────────────────────────────────────────────────────────────────
  insert into sales (
    id, tenant_id, reference, customer_id, customer_name, store_id, cashier_id, status,
    subtotal, tax_amount, discount_amount, total, paid_amount, change_given,
    payment_method, offline_sync_id, stock_conflict, credit_conflict
  ) values (
    v_sale_id, p_tenant_id, v_reference, p_customer_id, p_customer_name, p_store_id, p_cashier_id, 'COMPLETED',
    p_subtotal, p_tax_total, p_discount_amount, p_total, p_amount_received, p_change,
    p_payment_method, p_offline_sync_id, coalesce(array_length(v_stock_conflicts, 1), 0) > 0, v_credit_conflict
  );

  -- Rattache maintenant les numéros de série vendus à la vente (voir le
  -- commentaire dans la boucle de stock plus haut) : la ligne `sales`
  -- existe désormais, product_serials.sale_id peut être renseigné.
  if v_serials_sold <> '{}'::jsonb then
    declare
      v_pid text;
    begin
      for v_pid in select jsonb_object_keys(v_serials_sold) loop
        update product_serials set sale_id = v_sale_id, sold_at = now()
          where tenant_id = p_tenant_id and product_id = v_pid::uuid and status = 'SOLD'
            and serial_number = any(string_to_array(v_serials_sold->>v_pid, ', '));
      end loop;
    end;
  end if;

  if p_offline_sync_id is not null then
    insert into sync_dedup (tenant_id, offline_sync_id, sale_id, reference)
      values (p_tenant_id, p_offline_sync_id, v_sale_id, v_reference);
  end if;

  -- ── Lignes de vente + cumul du coût (pour cost_summary) ─────────────────────
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into sale_items (
      sale_id, tenant_id, product_id, product_name, product_sku, category_id,
      quantity, unit_price, purchase_price, discount_percent, tax_rate, total, serial_number
    ) values (
      v_sale_id, p_tenant_id, (v_line->>'product_id')::uuid, v_line->>'product_name', v_line->>'product_sku',
      nullif(v_line->>'category_id','')::uuid, (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric,
      nullif(v_line->>'purchase_price','')::numeric, (v_line->>'discount_percent')::numeric,
      (v_line->>'tax_rate')::numeric, (v_line->>'total')::numeric,
      nullif(v_serials_sold->>(v_line->>'product_id'), '')
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

  -- ── Devis d'origine : marqué converti seulement maintenant, la vente
  -- réellement encaissée. No-op silencieux si absent/déjà modifié —
  -- ne doit jamais faire échouer une vente déjà actée.
  if p_quote_id is not null then
    update quotes set status = 'CONVERTED', converted_sale_id = v_sale_id where id = p_quote_id;
  end if;

  -- ── Crédit client (si vente à crédit) ───────────────────────────────────────
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

  -- ── Alerte si conflit détecté après synchronisation hors-ligne ─────────────
  if coalesce(array_length(v_stock_conflicts, 1), 0) > 0 or v_credit_conflict then
    insert into alerts (tenant_id, type, severity, title, message, reference, reference_id)
      values (
        p_tenant_id, 'OFFLINE_SYNC_CONFLICT', 'HIGH',
        'Conflit détecté après synchronisation hors-ligne',
        format('Vente %s — %s', v_reference, array_to_string(v_stock_conflicts || v_alert_messages, ' · ')),
        'sales', v_sale_id::text
      );
  end if;

  return jsonb_build_object(
    'success', true, 'saleId', v_sale_id, 'reference', v_reference,
    'total', p_total, 'change', p_change
  );
end;
$$;

revoke execute on function pos_checkout(
  uuid, uuid, uuid, uuid, text, text, payment_method, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, boolean, text, uuid, text, jsonb
) from public;
