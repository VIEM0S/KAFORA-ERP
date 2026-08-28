create table cash_registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references stores(id),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_cash_registers_store on cash_registers(tenant_id, store_id);

-- Absorbe l'etat live aujourd'hui porte par Realtime Database (ouverture/
-- fermeture de caisse) : Supabase Realtime peut ecouter cette meme table,
-- une seule source de verite au lieu d'une double-ecriture Firestore+RTDB.
create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references stores(id),
  register_id uuid references cash_registers(id),
  status text not null default 'OPEN',
  opened_by uuid references auth.users(id),
  opened_by_name text,
  opened_at timestamptz not null default now(),
  opening_balance numeric not null default 0,
  closed_by uuid references auth.users(id),
  closed_by_name text,
  closed_at timestamptz,
  closing_balance numeric,
  expected_balance numeric,
  cash_sales_total numeric,
  credit_repayment_total numeric,
  cash_refund_total numeric,
  difference numeric,
  variance_reason text,
  sales_count integer,
  sales_total numeric,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_cash_sessions_register_opened on cash_sessions(register_id, opened_at);
create index idx_cash_sessions_tenant on cash_sessions(tenant_id, store_id);
revoke insert, update, delete on cash_sessions from authenticated, anon;

create table daily_stats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  date date not null,
  revenue numeric not null default 0,
  cost numeric not null default 0,
  margin numeric not null default 0,
  sale_count integer not null default 0,
  item_count integer not null default 0,
  unique_customers integer not null default 0,
  by_payment jsonb,
  by_store jsonb,
  revenue_by_category jsonb,
  cost_by_category jsonb,
  margin_by_category jsonb,
  top_products jsonb,
  cost_incomplete boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (tenant_id, date)
);

create index idx_daily_stats_tenant_date on daily_stats(tenant_id, date);
revoke insert, update, delete on daily_stats from authenticated, anon;

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sale_id uuid references sales(id),
  reference text not null,
  data jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, reference)
);

create index idx_invoices_tenant on invoices(tenant_id);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type alert_type not null,
  severity alert_severity not null default 'MEDIUM',
  title text not null,
  message text,
  reference text,
  reference_id text,
  is_read boolean not null default false,
  is_resolved boolean not null default false,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_alerts_tenant_resolved_created on alerts(tenant_id, is_resolved, created_at desc);
revoke insert, delete on alerts from authenticated, anon;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  title text not null,
  message text,
  type text,
  reference text,
  reference_id text,
  channel notification_channel not null default 'IN_APP',
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user on notifications(tenant_id, user_id, created_at desc);
revoke delete on notifications from authenticated, anon;

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  entity text,
  entity_id text,
  details text,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_tenant_created on audit_logs(tenant_id, created_at desc);
revoke insert, update, delete on audit_logs from authenticated, anon;

create table error_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references auth.users(id),
  message text,
  stack text,
  context jsonb,
  created_at timestamptz not null default now()
);

create index idx_error_logs_tenant_created on error_logs(tenant_id, created_at desc);
revoke update, delete on error_logs from authenticated, anon;

-- Equivalent de _rate_limits : throttling des routes publiques (login,
-- mot de passe oublie). Table simple plutot qu'une nouvelle dependance
-- Redis/Upstash, proportionne au volume actuel.
create table rate_limits (
  key text primary key,
  window_start_ms bigint not null,
  count integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Aucun acces client : uniquement le role service (equivalent Admin SDK).
revoke all on rate_limits from authenticated, anon;

-- Deduplication des ventes rejouees hors-ligne (remplace _sync_dedup).
create table sync_dedup (
  tenant_id uuid not null references tenants(id) on delete cascade,
  offline_sync_id text not null,
  sale_id uuid references sales(id),
  reference text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, offline_sync_id)
);

revoke all on sync_dedup from authenticated, anon;
