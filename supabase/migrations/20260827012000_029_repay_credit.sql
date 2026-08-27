-- Le versement d'un crédit touche 3 tables (credit_payments, credits,
-- customers) : la version Firestore le faisait dans une transaction client
-- (runTransaction) pour éviter qu'un solde lu par le navigateur soit déjà
-- périmé (deux versements simultanés). PostgREST n'offre pas de transaction
-- multi-requêtes côté client — direction RPC atomique, comme pour tous les
-- autres flux à enjeu de cette migration (checkout, transferts...).
--
-- Différence avec les RPC précédentes : celle-ci est appelée DEPUIS LE
-- NAVIGATEUR (comme les CRUD simples stores/customers/...), pas depuis une
-- route API avec la clé de service — d'où le GRANT EXECUTE explicite à
-- authenticated, et des vérifications d'autorisation ÉCRITES DANS LA
-- FONCTION (SECURITY DEFINER contourne RLS, donc RLS ne protège plus rien
-- ici : c'est la fonction elle-même qui doit refuser un tenant/magasin/rôle
-- non autorisé, avec can_write()/is_manager()/can_access_store() — les mêmes
-- garde-fous que les politiques RLS auraient appliqué sur un UPDATE direct).
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

  insert into credit_payments (credit_id, tenant_id, store_id, amount, payment_method, user_id, user_name)
    values (p_credit_id, v_tenant_id, p_store_id, p_amount, 'CASH', auth.uid(), p_user_name);

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

revoke execute on function repay_credit(uuid, numeric, uuid, text) from public;
grant execute on function repay_credit(uuid, numeric, uuid, text) to authenticated;
