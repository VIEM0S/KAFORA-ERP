-- Remplace lib/api/rate-limit.ts (runTransaction Firestore) : meme algorithme
-- de fenetre fixe, atomicite garantie par le verrou de ligne (FOR UPDATE)
-- plutot que par une transaction Firestore explicite.
create or replace function check_rate_limit(p_key text, p_max_attempts int, p_window_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_window_start bigint;
  v_count int;
begin
  insert into rate_limits (key, window_start_ms, count, updated_at)
  values (p_key, v_now_ms, 1, now())
  on conflict (key) do nothing;

  select window_start_ms, count into v_window_start, v_count
    from rate_limits where key = p_key for update;

  if v_now_ms - v_window_start > p_window_seconds * 1000 then
    update rate_limits set window_start_ms = v_now_ms, count = 1, updated_at = now() where key = p_key;
    return jsonb_build_object('allowed', true, 'remaining', p_max_attempts - 1, 'retryAfterSeconds', 0);
  end if;

  if v_count >= p_max_attempts then
    return jsonb_build_object(
      'allowed', false, 'remaining', 0,
      'retryAfterSeconds', greatest(1, ceil((v_window_start + p_window_seconds * 1000 - v_now_ms) / 1000.0))
    );
  end if;

  update rate_limits set count = count + 1, updated_at = now() where key = p_key;
  return jsonb_build_object('allowed', true, 'remaining', p_max_attempts - v_count - 1, 'retryAfterSeconds', 0);
end;
$$;

revoke execute on function check_rate_limit(text, int, int) from anon, authenticated;

-- Remplace le batch atomique d'inscription de app/api/auth/register/route.ts :
-- tenant + abonnement + magasin + profil utilisateur + parrainage eventuel,
-- dans UNE vraie transaction (rollback complet si une seule etape echoue —
-- amelioration reelle par rapport au batch Firestore, qui n'offrait deja
-- l'atomicite qu'entre ces memes ecritures, sans plus de garantie que ca).
create or replace function register_tenant(
  p_owner_user_id uuid,
  p_tenant_name text,
  p_tenant_slug text,
  p_tenant_email text,
  p_tenant_phone text,
  p_tenant_address text,
  p_tenant_city text,
  p_tenant_country text,
  p_tenant_rccm text,
  p_tenant_nif text,
  p_tenant_currency text,
  p_own_referral_code text,
  p_referred_by_tenant_id uuid,
  p_terms_acceptance jsonb,
  p_plan subscription_plan,
  p_limits jsonb,
  p_trial_end timestamptz,
  p_store_name text,
  p_store_code text,
  p_store_address text,
  p_store_city text,
  p_store_phone text,
  p_owner_email text,
  p_owner_first_name text,
  p_owner_last_name text,
  p_owner_phone text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_store_id uuid;
begin
  insert into tenants (
    name, slug, email, phone, address, city, country, rccm, nif, currency,
    referral_code, referred_by_tenant_id, terms_acceptance
  ) values (
    p_tenant_name, p_tenant_slug, p_tenant_email, p_tenant_phone, p_tenant_address,
    p_tenant_city, coalesce(p_tenant_country, 'Mali'), p_tenant_rccm, p_tenant_nif,
    coalesce(p_tenant_currency, 'XOF'), p_own_referral_code, p_referred_by_tenant_id, p_terms_acceptance
  ) returning id into v_tenant_id;

  insert into subscriptions (
    tenant_id, plan, status, trial_ends_at, current_period_start, current_period_end,
    write_blocked_at, limits
  ) values (
    v_tenant_id, p_plan, 'TRIAL', p_trial_end, now(), p_trial_end, p_trial_end, p_limits
  );

  insert into stores (tenant_id, name, code, address, city, phone)
  values (v_tenant_id, p_store_name, p_store_code, p_store_address, p_store_city, p_store_phone)
  returning id into v_store_id;

  insert into users (id, tenant_id, email, first_name, last_name, phone, role, is_active)
  values (p_owner_user_id, v_tenant_id, p_owner_email, p_owner_first_name, p_owner_last_name, p_owner_phone, 'OWNER', true);

  if p_referred_by_tenant_id is not null then
    insert into referrals (referrer_tenant_id, referred_tenant_id, referred_company_name, status)
    values (p_referred_by_tenant_id, v_tenant_id, p_tenant_name, 'PENDING');
  end if;

  return jsonb_build_object('tenantId', v_tenant_id, 'storeId', v_store_id);
end;
$$;

revoke execute on function register_tenant(
  uuid, text, text, text, text, text, text, text, text, text, text, text, uuid, jsonb,
  subscription_plan, jsonb, timestamptz, text, text, text, text, text, text, text, text, text
) from anon, authenticated;
