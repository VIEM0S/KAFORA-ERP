alter table tenants add column suspension_reason text;
alter table tenants add column suspended_at timestamptz;

-- Suspend ou reactive une entreprise cliente, avec double journalisation
-- (cote editeur et cote client) atomique — une suspension qui prend effet
-- sans journal serait contestable, un journal sans suspension effective
-- serait trompeur.
create or replace function set_tenant_status(
  p_tenant_id uuid, p_is_active boolean, p_reason text, p_performed_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_name text;
begin
  select name into v_tenant_name from tenants where id = p_tenant_id;
  if not found then
    raise exception 'NOT_FOUND: Entreprise introuvable';
  end if;

  update tenants set
    is_active = p_is_active,
    suspension_reason = case when p_is_active then null else p_reason end,
    suspended_at = case when p_is_active then null else now() end
    where id = p_tenant_id;

  insert into super_admin_logs (action, tenant_id, target_email, reason, performed_by)
    values (case when p_is_active then 'TENANT_ACTIVATED' else 'TENANT_SUSPENDED' end, p_tenant_id, v_tenant_name, p_reason, p_performed_by);

  insert into audit_logs (tenant_id, user_id, action, entity, entity_id, details)
    values (p_tenant_id, p_performed_by, case when p_is_active then 'ACCOUNT_REACTIVATED' else 'ACCOUNT_SUSPENDED' end, 'tenant', p_tenant_id::text, p_reason);

  return jsonb_build_object('success', true, 'isActive', p_is_active);
end;
$$;

revoke execute on function set_tenant_status(uuid, boolean, text, uuid) from public;

-- Enregistre un paiement d'abonnement et prolonge la periode — volontairement
-- MANUEL (encaissement Mobile Money/especes hors-app au Mali). Recompense
-- le parrain UNIQUEMENT sur un paiement reel (amount > 0), jamais sur une
-- prolongation gracieuse : le statut PENDING du parrainage garantit qu'elle
-- n'est accordee qu'une seule fois.
create or replace function admin_extend_subscription(
  p_tenant_id uuid, p_months int, p_plan subscription_plan, p_amount numeric,
  p_method text, p_note text, p_performed_by uuid,
  p_referrer_bonus_days int,
  -- {"STARTER": {...features}, "BUSINESS": {...}, "ENTERPRISE": {...}}
  p_limits_by_plan jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_end timestamptz;
  v_current_plan subscription_plan;
  v_base timestamptz;
  v_new_end timestamptz;
  v_final_plan subscription_plan;
  v_limits jsonb;
  v_referred_by uuid;
  v_referral_id uuid;
  v_referrer_current_end timestamptz;
  v_referrer_base timestamptz;
  v_referrer_new_end timestamptz;
begin
  select current_period_end, plan into v_current_end, v_current_plan
    from subscriptions where tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'NOT_FOUND: Abonnement introuvable';
  end if;

  -- Point de depart : la fin de periode en cours si elle est future, sinon
  -- maintenant. Payer en avance ne doit jamais faire perdre de temps au
  -- client, payer en retard ne doit jamais lui en offrir indument.
  v_base := case when v_current_end is not null and v_current_end > now() then v_current_end else now() end;
  v_new_end := v_base + (p_months || ' months')::interval;
  v_final_plan := coalesce(p_plan, v_current_plan, 'STARTER');
  v_limits := p_limits_by_plan->v_final_plan::text;

  update subscriptions set
    plan = v_final_plan, status = 'ACTIVE',
    current_period_start = v_base, current_period_end = v_new_end, write_blocked_at = v_new_end,
    limits = coalesce(v_limits, limits)
    where tenant_id = p_tenant_id;

  insert into subscription_payments (tenant_id, months, plan, amount, method, note, period_start, period_end, recorded_by)
    values (p_tenant_id, p_months, v_final_plan, p_amount, p_method, p_note, v_base, v_new_end, p_performed_by);

  if p_amount > 0 then
    select referred_by_tenant_id into v_referred_by from tenants where id = p_tenant_id;

    if v_referred_by is not null then
      select id into v_referral_id from referrals
        where referrer_tenant_id = v_referred_by and referred_tenant_id = p_tenant_id and status = 'PENDING'
        for update;

      if v_referral_id is not null then
        select current_period_end into v_referrer_current_end from subscriptions where tenant_id = v_referred_by for update;

        if found then
          v_referrer_base := case when v_referrer_current_end is not null and v_referrer_current_end > now() then v_referrer_current_end else now() end;
          v_referrer_new_end := v_referrer_base + (p_referrer_bonus_days || ' days')::interval;

          update subscriptions set current_period_end = v_referrer_new_end, write_blocked_at = v_referrer_new_end
            where tenant_id = v_referred_by;
          update referrals set status = 'REWARDED', rewarded_at = now() where id = v_referral_id;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'plan', v_final_plan, 'currentPeriodEnd', v_new_end);
end;
$$;

revoke execute on function admin_extend_subscription(
  uuid, int, subscription_plan, numeric, text, text, uuid, int, jsonb
) from public;

-- Meme classe de bug que les migrations 012/018/019 : trouve en testant en
-- direct. Un journal editeur ne doit jamais bloquer la suppression du
-- tenant qu'il documente.
alter table super_admin_logs drop constraint super_admin_logs_tenant_id_fkey;
alter table super_admin_logs add constraint super_admin_logs_tenant_id_fkey foreign key (tenant_id) references tenants(id) on delete set null;
