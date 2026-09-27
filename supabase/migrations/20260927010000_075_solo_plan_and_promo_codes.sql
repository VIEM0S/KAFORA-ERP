-- Palier "Solo" (8 000 FCFA/mois, vendeur seul) + système de codes promo
-- pour les abonnements, demandés le 2026-09-27 pour capter les milliers de
-- petits revendeurs (parfums, téléphones, nourriture...) que le prix
-- Starter actuel freine, alors même qu'ils ne savent souvent pas s'ils
-- vendent à profit.

-- ─── Palier Solo ────────────────────────────────────────────────────────
-- subscription_plan est un vrai enum Postgres (voir migration 001), pas du
-- texte libre : impossible d'insérer 'SOLO' dans subscriptions.plan sans
-- cet ajout.
alter type subscription_plan add value if not exists 'SOLO';

-- ─── Codes promo ────────────────────────────────────────────────────────
-- Outil interne uniquement (console admin, SUPER_ADMIN) : le règlement des
-- abonnements Kafora reste 100% manuel (voir app/api/admin/subscription/
-- route.ts), un code promo ne fait que documenter/tracer une remise que
-- l'admin applique lui-même en enregistrant un paiement — il ne calcule ni
-- n'impose jamais le montant réellement encaissé.
create table promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  discount_type text not null check (discount_type in ('PERCENT','FIXED')),
  discount_value numeric not null check (discount_value > 0),
  -- null = applicable à tous les forfaits.
  applicable_plans subscription_plan[],
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  -- null = pas de plafond.
  max_redemptions int,
  times_redeemed int not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
-- Table interne-plateforme, pas des données de tenant : aucune policy pour
-- authenticated/anon, accès uniquement via le client service-role des
-- routes /api/admin/* (même pattern que subscription_payments/audit_log).
alter table promo_codes enable row level security;
revoke all on promo_codes from anon, authenticated;

-- Piste de rédemption : une ligne par paiement où un code promo a été
-- appliqué, jamais modifiable après coup (pas de policy update/delete).
create table promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references promo_codes(id),
  tenant_id uuid not null references tenants(id) on delete cascade,
  subscription_payment_id uuid references subscription_payments(id),
  discount_amount numeric not null,
  redeemed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index idx_promo_redemptions_code on promo_code_redemptions(promo_code_id);
alter table promo_code_redemptions enable row level security;
revoke all on promo_code_redemptions from anon, authenticated;

-- ─── admin_extend_subscription() : ajoute la validation/traçabilité promo ──
-- Remplace la définition de la migration 059. Signature étendue avec
-- p_promo_code_id (nullable, rétrocompatible avec tout appelant existant).
create or replace function public.admin_extend_subscription(
  p_tenant_id uuid, p_months integer, p_plan subscription_plan, p_amount numeric,
  p_method text, p_note text, p_performed_by uuid, p_referrer_bonus_days integer,
  p_limits_by_plan jsonb, p_promo_code_id uuid default null, p_catalog_price numeric default null
)
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
  v_payment_id uuid;
  v_promo record;
  v_discount_amount numeric;
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

  if p_promo_code_id is not null then
    select * into v_promo from promo_codes where id = p_promo_code_id for update;
    if not found then
      raise exception 'INVALID_PROMO: Code promo introuvable';
    end if;
    if not v_promo.is_active then
      raise exception 'INVALID_PROMO: Ce code promo est désactivé';
    end if;
    if v_promo.valid_from > now() or (v_promo.valid_until is not null and v_promo.valid_until < now()) then
      raise exception 'INVALID_PROMO: Ce code promo n''est plus valide';
    end if;
    if v_promo.max_redemptions is not null and v_promo.times_redeemed >= v_promo.max_redemptions then
      raise exception 'INVALID_PROMO: Ce code promo a atteint son plafond d''utilisation';
    end if;
    if v_promo.applicable_plans is not null and not (v_final_plan = any(v_promo.applicable_plans)) then
      raise exception 'INVALID_PROMO: Ce code promo ne s''applique pas au forfait %', v_final_plan;
    end if;

    update promo_codes set times_redeemed = times_redeemed + 1 where id = p_promo_code_id;
  end if;

  update subscriptions set
    plan = v_final_plan, status = 'ACTIVE',
    current_period_start = v_base, current_period_end = v_new_end, write_blocked_at = v_new_end,
    limits = coalesce(v_limits, limits),
    last_reminder_days_left = null
    where tenant_id = p_tenant_id;

  insert into subscription_payments (tenant_id, months, plan, amount, method, note, period_start, period_end, recorded_by)
    values (p_tenant_id, p_months, v_final_plan, p_amount, p_method, p_note, v_base, v_new_end, p_performed_by)
    returning id into v_payment_id;

  if p_promo_code_id is not null then
    -- Traçabilité uniquement : la remise "théorique" documentée est l'écart
    -- entre le prix catalogue du forfait choisi (fourni par l'appelant,
    -- qui connaît déjà SUBSCRIPTION_PLANS côté application) et le montant
    -- réellement saisi par l'admin — jamais recalculée ni imposée.
    v_discount_amount := greatest(0, coalesce(p_catalog_price, p_amount) - p_amount);

    insert into promo_code_redemptions (promo_code_id, tenant_id, subscription_payment_id, discount_amount, redeemed_by)
      values (p_promo_code_id, p_tenant_id, v_payment_id, v_discount_amount, p_performed_by);
  end if;

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
