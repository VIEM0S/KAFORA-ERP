create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo text,
  email text not null,
  phone text,
  address text,
  city text,
  country text not null default 'Mali',
  rccm text,
  nif text,
  currency text not null default 'XOF',
  timezone text not null default 'Africa/Bamako',
  is_active boolean not null default true,
  referral_code text unique,
  referred_by_tenant_id uuid references tenants(id),
  transfer_settings jsonb,
  terms_acceptance jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table super_admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table super_admin_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  tenant_id uuid references tenants(id),
  target_email text,
  reason text,
  performed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id) on delete cascade,
  plan subscription_plan not null default 'STARTER',
  status subscription_status not null default 'TRIAL',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  write_blocked_at timestamptz,
  limits jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table subscription_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  months integer not null,
  plan subscription_plan not null,
  amount numeric not null,
  method text,
  note text,
  period_start timestamptz not null,
  period_end timestamptz not null,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_tenant_id uuid not null references tenants(id) on delete cascade,
  referred_tenant_id uuid not null references tenants(id) on delete cascade,
  referred_company_name text,
  status referral_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  rewarded_at timestamptz
);

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  phone text,
  avatar text,
  role user_role not null,
  store_ids uuid[],
  is_active boolean not null default true,
  email_verified boolean not null default false,
  mfa_enabled boolean not null default false,
  working_hours jsonb,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  target_user_id uuid not null references users(id) on delete cascade,
  justification text,
  status deletion_request_status not null default 'PENDING',
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_users_tenant on users(tenant_id);
create index idx_subscription_payments_tenant on subscription_payments(tenant_id);
create index idx_referrals_referrer on referrals(referrer_tenant_id);
create index idx_referrals_referred on referrals(referred_tenant_id);
create index idx_user_deletion_requests_tenant on user_deletion_requests(tenant_id);
