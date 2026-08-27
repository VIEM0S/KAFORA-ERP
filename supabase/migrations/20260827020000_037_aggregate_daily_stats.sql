-- Phase 6 : agrégation quotidienne des ventes (daily_stats).
--
-- Remplace la boucle JS de netlify/functions/aggregate-daily-stats.mts
-- (une lecture Firestore par tenant, réduite à la main) par une seule
-- requête ensembliste couvrant tous les tenants pour une journée donnée.
--
-- aggregate_daily_stats_for_day(date) calcule et upsert la ligne
-- daily_stats de chaque tenant pour cette journée (UTC) ; renvoie le
-- nombre de lignes écrites.
-- aggregate_daily_stats(days) est le point d'entrée appelé par la fonction
-- planifiée Netlify : rattrape `days` journées en arrière (bornées à 30).

create or replace function aggregate_daily_stats_for_day(p_date date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  -- p_date::timestamp (naïf) at time zone 'UTC' interprète p_date comme une
  -- journée UTC quel que soit le fuseau de la session — contrairement à
  -- p_date::timestamptz qui utiliserait le fuseau de la session en cours.
  v_start timestamptz := p_date::timestamp at time zone 'UTC';
  v_end timestamptz := v_start + interval '1 day';
  v_written int;
begin
  with completed_sales as (
    select * from sales
    where status = 'COMPLETED' and created_at >= v_start and created_at < v_end
  ),
  sales_by_payment as (
    select tenant_id, payment_method, sum(total) as amt
    from completed_sales group by tenant_id, payment_method
  ),
  sales_by_payment_json as (
    select tenant_id, jsonb_object_agg(payment_method, amt) as by_payment
    from sales_by_payment group by tenant_id
  ),
  sales_by_store as (
    select tenant_id, store_id, sum(total) as amt
    from completed_sales where store_id is not null
    group by tenant_id, store_id
  ),
  sales_by_store_json as (
    select tenant_id, jsonb_object_agg(store_id::text, amt) as by_store
    from sales_by_store group by tenant_id
  ),
  sales_agg as (
    select tenant_id, count(*) as sale_count, sum(total) as revenue,
      count(distinct coalesce(customer_id::text, 'comptoir')) as unique_customers
    from completed_sales group by tenant_id
  ),
  cost_raw as (
    select cs.tenant_id, cs.cost_total, cs.cost_by_category, cs.cost_incomplete
    from sale_cost_summary cs
    join completed_sales s on s.id = cs.sale_id
  ),
  cost_agg as (
    select tenant_id, sum(cost_total) as cost, count(*) as cost_summary_count,
      bool_or(cost_incomplete) as any_partial
    from cost_raw group by tenant_id
  ),
  cost_by_cat_flat as (
    select tenant_id, kv.key as cat_key, sum((kv.value)::numeric) as cost
    from cost_raw, jsonb_each_text(coalesce(cost_by_category, '{}'::jsonb)) as kv(key, value)
    group by tenant_id, kv.key
  ),
  cost_by_cat_json as (
    select tenant_id, jsonb_object_agg(cat_key, cost) as cost_by_category
    from cost_by_cat_flat group by tenant_id
  ),
  items_raw as (
    select si.tenant_id, si.product_id, si.product_name, si.category_id, si.quantity, si.total
    from sale_items si
    join completed_sales s on s.id = si.sale_id
    where si.product_id is not null
  ),
  items_agg as (
    select tenant_id, sum(quantity) as item_count from items_raw group by tenant_id
  ),
  rev_by_cat_flat as (
    select tenant_id, coalesce(category_id::text, 'uncategorized') as cat_key, sum(total) as revenue
    from items_raw group by tenant_id, coalesce(category_id::text, 'uncategorized')
  ),
  rev_by_cat_json as (
    select tenant_id, jsonb_object_agg(cat_key, revenue) as revenue_by_category
    from rev_by_cat_flat group by tenant_id
  ),
  top_products_flat as (
    select tenant_id, product_id, max(product_name) as name, sum(total) as revenue, sum(quantity) as quantity
    from items_raw group by tenant_id, product_id
  ),
  top_products_ranked as (
    select tenant_id, product_id, name, revenue, quantity,
      row_number() over (partition by tenant_id order by revenue desc) as rn
    from top_products_flat
  ),
  top_products_json as (
    select tenant_id,
      jsonb_agg(jsonb_build_object('productId', product_id, 'name', name, 'revenue', revenue, 'quantity', quantity) order by revenue desc) as top_products
    from top_products_ranked where rn <= 10
    group by tenant_id
  ),
  margin_by_cat_flat as (
    select coalesce(r.tenant_id, c.tenant_id) as tenant_id,
           coalesce(r.cat_key, c.cat_key) as cat_key,
           coalesce(r.revenue, 0) - coalesce(c.cost, 0) as margin
    from rev_by_cat_flat r
    full outer join cost_by_cat_flat c on r.tenant_id = c.tenant_id and r.cat_key = c.cat_key
  ),
  margin_by_cat_json as (
    select tenant_id, jsonb_object_agg(cat_key, margin) as margin_by_category
    from margin_by_cat_flat group by tenant_id
  ),
  upserted as (
    insert into daily_stats (
      tenant_id, date, revenue, cost, margin, sale_count, item_count, unique_customers,
      by_payment, by_store, revenue_by_category, cost_by_category, margin_by_category,
      top_products, cost_incomplete, computed_at
    )
    select
      t.id, p_date,
      coalesce(sa.revenue, 0), coalesce(ca.cost, 0), coalesce(sa.revenue, 0) - coalesce(ca.cost, 0),
      coalesce(sa.sale_count, 0), coalesce(ia.item_count, 0), coalesce(sa.unique_customers, 0),
      coalesce(spj.by_payment, '{}'::jsonb), coalesce(ssj.by_store, '{}'::jsonb),
      coalesce(rcj.revenue_by_category, '{}'::jsonb), coalesce(ccj.cost_by_category, '{}'::jsonb),
      coalesce(mcj.margin_by_category, '{}'::jsonb),
      coalesce(tpj.top_products, '[]'::jsonb),
      coalesce(
        (coalesce(sa.sale_count, 0) > 0 and coalesce(ca.cost_summary_count, 0) < coalesce(sa.sale_count, 0))
        or coalesce(ca.any_partial, false),
        false
      ),
      now()
    from tenants t
    left join sales_agg sa on sa.tenant_id = t.id
    left join cost_agg ca on ca.tenant_id = t.id
    left join items_agg ia on ia.tenant_id = t.id
    left join sales_by_payment_json spj on spj.tenant_id = t.id
    left join sales_by_store_json ssj on ssj.tenant_id = t.id
    left join rev_by_cat_json rcj on rcj.tenant_id = t.id
    left join cost_by_cat_json ccj on ccj.tenant_id = t.id
    left join margin_by_cat_json mcj on mcj.tenant_id = t.id
    left join top_products_json tpj on tpj.tenant_id = t.id
    on conflict (tenant_id, date) do update set
      revenue = excluded.revenue, cost = excluded.cost, margin = excluded.margin,
      sale_count = excluded.sale_count, item_count = excluded.item_count,
      unique_customers = excluded.unique_customers, by_payment = excluded.by_payment,
      by_store = excluded.by_store, revenue_by_category = excluded.revenue_by_category,
      cost_by_category = excluded.cost_by_category, margin_by_category = excluded.margin_by_category,
      top_products = excluded.top_products, cost_incomplete = excluded.cost_incomplete,
      computed_at = excluded.computed_at
    returning 1
  )
  select count(*) into v_written from upserted;
  return v_written;
end;
$$;
revoke execute on function aggregate_daily_stats_for_day(date) from public;

create or replace function aggregate_daily_stats(p_days int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 1), 1), 30);
  v_i int;
  v_written int := 0;
  v_day date;
begin
  for v_i in 1..v_days loop
    v_day := ((now() at time zone 'UTC')::date - v_i);
    v_written := v_written + aggregate_daily_stats_for_day(v_day);
  end loop;
  return jsonb_build_object('success', true, 'written', v_written, 'days', v_days);
end;
$$;
revoke execute on function aggregate_daily_stats(int) from public;
