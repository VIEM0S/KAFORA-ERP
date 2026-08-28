-- L'original affichait le solde immediatement apres chaque versement
-- (utile pour l'historique/audit) — perdu en simplifiant le schema, remis
-- en trouvant l'ecart en portant credits/page.tsx.
alter table credit_payments add column remaining_after numeric;

create or replace function repay_credit(
  p_credit_id uuid, p_amount numeric, p_store_id uuid, p_user_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_customer_id uuid;
  v_remaining numeric;
  v_total numeric;
  v_status credit_status;
  v_new_remaining numeric;
  v_new_status credit_status;
  v_current_used numeric;
begin
  select tenant_id, customer_id, remaining_amount, total_amount, status
    into v_tenant_id, v_customer_id, v_remaining, v_total, v_status
    from credits where id = p_credit_id for update;

  if not found then
    raise exception 'NOT_FOUND: Crédit introuvable';
  end if;
  if not (can_write(v_tenant_id) and is_manager()) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission d''enregistrer un versement de crédit';
  end if;
  if p_store_id is not null and not can_access_store(p_store_id) then
    raise exception 'FORBIDDEN: Vous n''avez pas accès à ce magasin';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: Montant invalide';
  end if;
  if p_amount > v_remaining then
    raise exception 'INVALID_AMOUNT: Montant supérieur au solde restant';
  end if;

  v_new_remaining := greatest(0, v_remaining - p_amount);
  v_new_status := case
    when v_new_remaining = 0 then 'PAID'
    when v_new_remaining < v_total then 'PARTIALLY_PAID'
    else v_status
  end;

  insert into credit_payments (credit_id, tenant_id, store_id, amount, payment_method, user_id, user_name, remaining_after)
    values (p_credit_id, v_tenant_id, p_store_id, p_amount, 'CASH', auth.uid(), p_user_name, v_new_remaining);

  update credits set
    paid_amount = paid_amount + p_amount,
    remaining_amount = v_new_remaining,
    status = v_new_status
    where id = p_credit_id;

  if v_customer_id is not null then
    select credit_used into v_current_used from customers where id = v_customer_id for update;
    if found then
      update customers set credit_used = greatest(0, v_current_used - p_amount) where id = v_customer_id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'remainingAmount', v_new_remaining, 'status', v_new_status);
end;
$$;
