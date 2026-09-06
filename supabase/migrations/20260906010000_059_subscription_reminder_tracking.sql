-- Relance automatique avant blocage (7 jours puis 1 jour) — jusqu'ici un
-- client ne l'apprenait qu'en essayant de se connecter après blocage, ou
-- si l'éditeur pensait à le prévenir manuellement. Voir la fonction
-- planifiée netlify/functions/subscription-reminders.mts.
--
-- last_reminder_days_left mémorise le dernier seuil (7 ou 1) pour lequel
-- une relance a déjà été envoyée à CE cycle d'abonnement — sans lui, une
-- exécution planifiée quotidienne renverrait la même relance chaque jour
-- tant que le compte reste sous le seuil. Remis à null par
-- admin_extend_subscription() à chaque prolongation : un nouveau cycle
-- doit pouvoir déclencher ses propres relances.
alter table subscriptions add column last_reminder_days_left int;

alter type alert_type add value if not exists 'SUBSCRIPTION_EXPIRING_SOON';

create or replace function public.admin_extend_subscription(p_tenant_id uuid, p_months integer, p_plan subscription_plan, p_amount numeric, p_method text, p_note text, p_performed_by uuid, p_referrer_bonus_days integer, p_limits_by_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_base := case when v_current_end is not null and v_current_end > now() then v_current_end else now() end;
  v_new_end := v_base + (p_months || ' months')::interval;
  v_final_plan := coalesce(p_plan, v_current_plan, 'STARTER');
  v_limits := p_limits_by_plan->v_final_plan::text;

  update subscriptions set
    plan = v_final_plan, status = 'ACTIVE',
    current_period_start = v_base, current_period_end = v_new_end, write_blocked_at = v_new_end,
    limits = coalesce(v_limits, limits),
    -- Nouveau cycle payé : les relances de l'échéance précédente ne
    -- comptent plus, celle-ci doit pouvoir en déclencher de nouvelles.
    last_reminder_days_left = null
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
$function$;
