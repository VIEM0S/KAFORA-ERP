-- Colonne manquante (l'original la traque separement de cash_sales_total).
alter table cash_sessions add column acompte_total numeric;

-- Au plus une session OUVERTE par caisse : remplace a la fois l'etat "live"
-- de Realtime Database ET le controle anti-double-cloture — la MEME ligne
-- transite OPEN -> CLOSED, donc un double-clic trouve simplement "pas de
-- session ouverte" au lieu de creer deux sessions clôturées separees.
create unique index uq_cash_sessions_one_open on cash_sessions(register_id) where status = 'OPEN';

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

-- Cloture une caisse : recalcule TOUT cote serveur a partir des vraies
-- ventes/paiements/retours de la SESSION (pas de la journee — une caisse
-- ouverte l'apres-midi ne doit pas heriter des ventes du matin deja
-- comptees a la cloture precedente). Jamais confiance dans les totaux
-- envoyes par le client.
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
  select id, opened_by, opened_by_name, opened_at, opening_balance
    into v_session_id, v_opened_by, v_opened_by_name, v_opened_at, v_opening_balance
    from cash_sessions where register_id = p_register_id and status = 'OPEN' for update;

  if not found then
    raise exception 'NO_OPEN_SESSION: Aucune caisse ouverte trouvée';
  end if;

  -- Ventes COMPLETED de la session (une vente annulee a ete remboursee : la
  -- compter ferait apparaitre un manquant au caissier pour une erreur qui
  -- n'est pas la sienne).
  select
    coalesce(sum(total) filter (where payment_method = 'CASH'), 0),
    coalesce(sum(paid_amount) filter (where payment_method = 'CREDIT'), 0),
    coalesce(sum(total), 0),
    count(*)
    into v_cash_sales_total, v_acompte_total, v_sales_total, v_sales_count
    from sales
    where tenant_id = p_tenant_id and store_id = p_store_id and status = 'COMPLETED' and created_at >= v_opened_at;

  -- Reglements de dettes encaisses pendant la session : un client venu payer
  -- depose de l'argent dans ce tiroir.
  select coalesce(sum(amount), 0) into v_credit_repayment_total
    from credit_payments
    where tenant_id = p_tenant_id and store_id = p_store_id and payment_method = 'CASH' and created_at >= v_opened_at;

  -- Remboursements rendus en especes : cet argent est SORTI du tiroir.
  -- cash_refund = part reellement sortie (le reste a efface une dette).
  select coalesce(sum(cash_refund), 0) into v_cash_refund_total
    from sale_returns
    where tenant_id = p_tenant_id and store_id = p_store_id and refund_method = 'CASH' and created_at >= v_opened_at;

  -- MEME formule que celle affichee au caissier pendant la session.
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
