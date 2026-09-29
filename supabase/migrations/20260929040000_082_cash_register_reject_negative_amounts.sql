-- Le solde d'ouverture (opening_balance) n'etait borne nulle part cote
-- serveur -- un Caissier pouvait ouvrir sa caisse avec un solde negatif
-- (ex. -100000), ce qui abaisse d'autant le solde attendu calcule a la
-- fermeture (v_expected_balance := opening_balance + ventes especes + ...)
-- et masque un pretexte de vol de meme montant sans jamais faire apparaitre
-- d'ecart a la reconciliation -- defait exactement le controle anti-vol que
-- le journal par caissier a ete construit pour fournir. Meme risque, moindre
-- mesure, sur le montant compte a la fermeture (counted_amount). Deja
-- corrige cote client/route (clamp >= 0), ce garde-fou RPC est la derniere
-- ligne de defense si un futur appelant oublie de clamper. Trouve lors de
-- l'audit du 2026-09-29.
create or replace function open_cash_register(
  p_tenant_id uuid, p_store_id uuid, p_register_id uuid,
  p_caller_id uuid, p_caller_name text, p_opening_balance numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_opening_balance is not null and p_opening_balance < 0 then
    raise exception 'INVALID_AMOUNT: Le solde d''ouverture ne peut pas etre negatif';
  end if;

  begin
    insert into cash_sessions (
      tenant_id, store_id, register_id, status, opened_by, opened_by_name, opened_at, opening_balance
    ) values (
      p_tenant_id, p_store_id, p_register_id, 'OPEN', p_caller_id, p_caller_name, now(), coalesce(p_opening_balance, 0)
    ) returning id into v_id;
  exception when unique_violation then
    raise exception 'ALREADY_OPEN: Cette caisse est déjà ouverte';
  end;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

revoke execute on function open_cash_register(uuid, uuid, uuid, uuid, text, numeric) from public;

create or replace function close_cash_register(
  p_tenant_id uuid, p_store_id uuid, p_register_id uuid,
  p_caller_id uuid, p_caller_name text, p_counted_amount numeric, p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_opened_by uuid;
  v_opened_by_name text;
  v_opened_at timestamptz;
  v_opening_balance numeric;
  v_cash_sales_total numeric := 0;
  v_acompte_total numeric := 0;
  v_sales_total numeric := 0;
  v_sales_count int := 0;
  v_credit_repayment_total numeric := 0;
  v_cash_refund_total numeric := 0;
  v_expected_balance numeric;
  v_difference numeric;
begin
  if p_counted_amount is not null and p_counted_amount < 0 then
    raise exception 'INVALID_AMOUNT: Le montant compte ne peut pas etre negatif';
  end if;

  select id, opened_by, opened_by_name, opened_at, opening_balance
    into v_session_id, v_opened_by, v_opened_by_name, v_opened_at, v_opening_balance
    from cash_sessions where register_id = p_register_id and status = 'OPEN' for update;

  if not found then
    raise exception 'NO_OPEN_SESSION: Aucune caisse ouverte trouvée';
  end if;

  select
    coalesce(sum(total) filter (where payment_method = 'CASH'), 0),
    coalesce(sum(paid_amount) filter (where payment_method = 'CREDIT'), 0),
    coalesce(sum(total), 0),
    count(*)
    into v_cash_sales_total, v_acompte_total, v_sales_total, v_sales_count
    from sales
    where tenant_id = p_tenant_id and store_id = p_store_id and status = 'COMPLETED' and created_at >= v_opened_at;

  select coalesce(sum(amount), 0) into v_credit_repayment_total
    from credit_payments
    where tenant_id = p_tenant_id and store_id = p_store_id and payment_method = 'CASH' and created_at >= v_opened_at;

  select coalesce(sum(cash_refund), 0) into v_cash_refund_total
    from sale_returns
    where tenant_id = p_tenant_id and store_id = p_store_id and refund_method = 'CASH' and created_at >= v_opened_at;

  v_expected_balance := coalesce(v_opening_balance, 0) + v_cash_sales_total + v_acompte_total + v_credit_repayment_total - v_cash_refund_total;
  v_difference := coalesce(p_counted_amount, 0) - v_expected_balance;

  update cash_sessions set
    status = 'CLOSED',
    closed_by = p_caller_id,
    closed_by_name = p_caller_name,
    closed_at = now(),
    closing_balance = p_counted_amount,
    expected_balance = v_expected_balance,
    cash_sales_total = v_cash_sales_total,
    acompte_total = v_acompte_total,
    credit_repayment_total = v_credit_repayment_total,
    cash_refund_total = v_cash_refund_total,
    difference = v_difference,
    sales_count = v_sales_count,
    sales_total = v_sales_total,
    notes = p_notes
    where id = v_session_id;

  return jsonb_build_object(
    'success', true, 'id', v_session_id, 'expectedBalance', v_expected_balance,
    'difference', v_difference, 'cashSalesTotal', v_cash_sales_total,
    'salesTotal', v_sales_total, 'txCount', v_sales_count
  );
end;
$$;

revoke execute on function close_cash_register(uuid, uuid, uuid, uuid, text, numeric, text) from public;
