-- Trouvé lors de l'audit logique métier (gouvernance des annulations de
-- crédit) : write_off_credit() passait le statut à WRITTEN_OFF et
-- décrémentait bien customers.credit_used, mais laissait
-- credits.remaining_amount inchangé (ex. 20 000 FCFA) — incohérent avec un
-- crédit censé être soldé/passé en perte. Sans conséquence sur le crédit
-- disponible du client (credit_used était correct), mais visible partout où
-- remaining_amount est affiché ou sommé (export CSV, "Total en cours" si mal
-- filtré) et combiné à un autre bug corrigé côté client (isEnRetard() ne
-- traitait pas WRITTEN_OFF comme un état terminal), un crédit annulé dont
-- l'échéance était dépassée réapparaissait "En retard" avec son ancien solde.
create or replace function write_off_credit(p_credit_id uuid, p_reason text, p_user_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
  v_customer_id uuid;
  v_remaining numeric;
  v_status credit_status;
  v_write_off_status text;
  v_registered_store_id uuid;
  v_threshold numeric;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select c.tenant_id, c.customer_id, c.remaining_amount, c.status, c.write_off_status, cu.registered_store_id
    into v_tenant_id, v_customer_id, v_remaining, v_status, v_write_off_status, v_registered_store_id
    from credits c join customers cu on cu.id = c.customer_id
    where c.id = p_credit_id for update;

  if not found then
    raise exception 'NOT_FOUND: Crédit introuvable';
  end if;
  if not (can_write(v_tenant_id) and is_manager()) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission d''annuler un crédit';
  end if;
  if not (v_registered_store_id is null or can_access_store(v_registered_store_id)) then
    raise exception 'FORBIDDEN: Seul le magasin d''inscription de ce client peut annuler ce crédit';
  end if;
  if v_status in ('PAID', 'WRITTEN_OFF', 'CANCELLED') then
    raise exception 'INVALID_STATUS: Ce crédit ne peut plus être annulé (%)', v_status;
  end if;
  if v_write_off_status = 'PENDING' then
    raise exception 'INVALID_STATUS: Une demande d''annulation est déjà en attente pour ce crédit';
  end if;

  select write_off_approval_threshold into v_threshold from tenants where id = v_tenant_id;

  if v_remaining > coalesce(v_threshold, 0) then
    update credits set
      write_off_status = 'PENDING',
      write_off_requested_by = v_actor_id,
      write_off_requested_by_name = p_user_name,
      write_off_requested_at = now(),
      write_off_reason = p_reason,
      write_off_rejected_reason = null
    where id = p_credit_id;

    insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
    values (v_tenant_id, 'CREDIT_WRITE_OFF_REQUESTED', 'credit', p_credit_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
      jsonb_build_object('amount', v_remaining, 'reason', p_reason, 'threshold', v_threshold));

    return jsonb_build_object('success', true, 'status', 'PENDING_APPROVAL', 'threshold', v_threshold);
  end if;

  update credits set status = 'WRITTEN_OFF', write_off_status = 'NONE', remaining_amount = 0,
    notes = coalesce(notes || E'\n', '') || format('Annulé le %s par %s : %s', to_char(now(), 'DD/MM/YYYY'), p_user_name, p_reason)
    where id = p_credit_id;
  update customers set credit_used = greatest(0, coalesce(credit_used, 0) - v_remaining) where id = v_customer_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant_id, 'CREDIT_WRITTEN_OFF', 'credit', p_credit_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
    jsonb_build_object('amount', v_remaining, 'reason', p_reason));

  return jsonb_build_object('success', true, 'status', 'WRITTEN_OFF');
end;
$$;

-- Même correctif pour le chemin d'approbation (crédits au-dessus du seuil) :
-- approve_credit_write_off() avait le même oubli.
create or replace function approve_credit_write_off(p_credit_id uuid, p_user_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
  v_customer_id uuid;
  v_remaining numeric;
  v_write_off_status text;
  v_reason text;
  v_requested_by uuid;
  v_registered_store_id uuid;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select c.tenant_id, c.customer_id, c.remaining_amount, c.write_off_status, c.write_off_reason, c.write_off_requested_by, cu.registered_store_id
    into v_tenant_id, v_customer_id, v_remaining, v_write_off_status, v_reason, v_requested_by, v_registered_store_id
    from credits c join customers cu on cu.id = c.customer_id
    where c.id = p_credit_id for update;

  if not found then raise exception 'NOT_FOUND: Crédit introuvable'; end if;
  if not (can_write(v_tenant_id) and is_owner_or_admin()) then
    raise exception 'FORBIDDEN: Seuls le Propriétaire ou un Administrateur peuvent valider une annulation de crédit';
  end if;
  if v_write_off_status <> 'PENDING' then
    raise exception 'INVALID_STATUS: Aucune demande en attente pour ce crédit';
  end if;
  if v_actor_id = v_requested_by then
    raise exception 'FORBIDDEN: Vous ne pouvez pas valider votre propre demande d''annulation — une autre personne habilitée doit le faire';
  end if;

  update credits set status = 'WRITTEN_OFF', write_off_status = 'NONE', remaining_amount = 0,
    notes = coalesce(notes || E'\n', '') || format('Annulé le %s (validé par %s) : %s', to_char(now(), 'DD/MM/YYYY'), p_user_name, v_reason)
    where id = p_credit_id;
  update customers set credit_used = greatest(0, coalesce(credit_used, 0) - v_remaining) where id = v_customer_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant_id, 'CREDIT_WRITE_OFF_APPROVED', 'credit', p_credit_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
    jsonb_build_object('amount', v_remaining, 'reason', v_reason));

  return jsonb_build_object('success', true, 'requestedBy', v_requested_by, 'amount', v_remaining);
end;
$$;
