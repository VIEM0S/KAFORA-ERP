-- Bloque l'auto-approbation d'une annulation de crédit (migration 045) :
-- approve_credit_write_off() ne vérifiait que le rôle (Owner/Admin), jamais
-- que l'approbateur est une personne DIFFÉRENTE de celle qui a soumis la
-- demande. Prouvé en direct par simulation de rôle : le même compte Owner
-- pouvait demander ET valider sa propre annulation au-dessus du seuil,
-- vidant de son sens le principe de double validation ("gouvernance").
--
-- Un tenant avec un seul Owner/Admin ne peut désormais plus valider ses
-- propres demandes au-dessus du seuil — c'est le compromis assumé : la
-- fonctionnalité existe pour garantir un vrai second regard, pas pour
-- ajouter une simple confirmation.
create or replace function public.approve_credit_write_off(p_credit_id uuid, p_user_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  update credits set status = 'WRITTEN_OFF', write_off_status = 'NONE',
    notes = coalesce(notes || E'\n', '') || format('Annulé le %s (validé par %s) : %s', to_char(now(), 'DD/MM/YYYY'), p_user_name, v_reason)
    where id = p_credit_id;
  update customers set credit_used = greatest(0, coalesce(credit_used, 0) - v_remaining) where id = v_customer_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant_id, 'CREDIT_WRITE_OFF_APPROVED', 'credit', p_credit_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
    jsonb_build_object('amount', v_remaining, 'reason', v_reason));

  return jsonb_build_object('success', true, 'requestedBy', v_requested_by, 'amount', v_remaining);
end;
$function$;
