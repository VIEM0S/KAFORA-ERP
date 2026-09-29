-- set_credit_limit() ne rejetait qu'une limite negative -- aucun plafond
-- haut. Un Manager pouvait fixer une limite de credit absurde (ex. 1e15
-- FCFA), faussant les indicateurs d'exposition credit tenant-wide sans
-- qu'aucune erreur ne le signale. Plafond de bon sens (pas une regle
-- metier), pour attraper une faute de frappe/un abus, pas pour contraindre
-- une vraie limite commerciale legitime. Trouve lors de l'audit du
-- 2026-09-29.
create or replace function set_credit_limit(
  p_customer_id uuid, p_new_limit numeric, p_reason text, p_user_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_registered_store_id uuid;
  v_old_limit numeric;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select tenant_id, registered_store_id, credit_limit into v_tenant_id, v_registered_store_id, v_old_limit
    from customers where id = p_customer_id for update;

  if not found then raise exception 'NOT_FOUND: Client introuvable'; end if;
  if not (can_write(v_tenant_id) and is_manager()) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission de modifier la limite de crédit';
  end if;
  if not (v_registered_store_id is null or can_access_store(v_registered_store_id)) then
    raise exception 'FORBIDDEN: Seul le magasin d''inscription de ce client peut modifier sa limite de crédit';
  end if;
  if p_new_limit is null or p_new_limit < 0 then
    raise exception 'INVALID_AMOUNT: Limite invalide';
  end if;
  if p_new_limit > 100000000 then
    raise exception 'INVALID_AMOUNT: Limite trop élevée (plafond de sécurité 100 000 000 FCFA)';
  end if;

  update customers set credit_limit = p_new_limit where id = p_customer_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant_id, 'CREDIT_LIMIT_CHANGED', 'customer', p_customer_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
    jsonb_build_object('previous_limit', v_old_limit, 'new_limit', p_new_limit, 'reason', p_reason));

  return jsonb_build_object('success', true, 'previousLimit', v_old_limit, 'newLimit', p_new_limit);
end;
$$;
