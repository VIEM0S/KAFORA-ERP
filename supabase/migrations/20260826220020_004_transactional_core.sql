create table sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  reference text not null,
  customer_id uuid references customers(id),
  store_id uuid not null references stores(id),
  cashier_id uuid references auth.users(id),
  status sale_status not null default 'COMPLETED',
  subtotal numeric not null default 0,
  tax_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  discount_reason text,
  total numeric not null default 0,
  paid_amount numeric not null default 0,
  change_given numeric not null default 0,
  payment_method payment_method not null,
  notes text,
  offline_sync_id text,
  stock_conflict boolean not null default false,
  credit_conflict boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, reference),
  unique (tenant_id, offline_sync_id)
);

create index idx_sales_tenant_store_created on sales(tenant_id, store_id, created_at desc);
create index idx_sales_tenant_customer_created on sales(tenant_id, customer_id, created_at desc);
revoke insert, update, delete on sales from authenticated, anon;

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  product_sku text,
  category_id uuid references categories(id),
  quantity numeric not null,
  unit_price numeric not null,
  purchase_price numeric,
  discount_percent numeric not null default 0,
  tax_rate numeric not null default 0,
  total numeric not null,
  returned_quantity numeric not null default 0,
  created_at timestamptz not null default now()
);

create index idx_sale_items_sale on sale_items(sale_id);
create index idx_sale_items_tenant_created on sale_items(tenant_id, created_at);
revoke insert, update, delete on sale_items from authenticated, anon;

create table payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  method payment_method not null,
  amount numeric not null,
  reference text,
  mobile_provider text
);

create index idx_payments_sale on payments(sale_id);
revoke insert, update, delete on payments from authenticated, anon;

-- Remplace la sous-collection cost_summary ET la regle collectionGroup
-- dediee qui n'existait que pour contourner une limitation de provabilite
-- des requetes Firestore : une simple table avec tenant_id/store_id suffit.
create table sale_cost_summary (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references sales(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references stores(id),
  cost_total numeric not null default 0,
  margin numeric not null default 0,
  cost_by_category jsonb,
  cost_incomplete boolean not null default false,
  lines_without_cost integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_sale_cost_summary_tenant_created on sale_cost_summary(tenant_id, created_at);
revoke insert, update, delete on sale_cost_summary from authenticated, anon;

create table sale_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sale_id uuid not null references sales(id),
  sale_reference text not null,
  store_id uuid not null references stores(id),
  customer_id uuid references customers(id),
  refund_amount numeric not null default 0,
  refund_method refund_method not null,
  reason text,
  status return_status not null default 'COMPLETED',
  processed_by uuid references auth.users(id),
  processed_by_name text,
  created_at timestamptz not null default now()
);

create index idx_sale_returns_tenant_store_created on sale_returns(tenant_id, store_id, created_at);
revoke insert, update, delete on sale_returns from authenticated, anon;

create table sale_return_items (
  id uuid primary key default gen_random_uuid(),
  sale_return_id uuid not null references sale_returns(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  quantity numeric not null,
  unit_price numeric not null,
  total numeric not null,
  restocked boolean not null default false
);

create index idx_sale_return_items_return on sale_return_items(sale_return_id);
revoke insert, update, delete on sale_return_items from authenticated, anon;

create table credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id),
  sale_id uuid references sales(id),
  reference text,
  total_amount numeric not null,
  paid_amount numeric not null default 0,
  remaining_amount numeric not null,
  due_date timestamptz,
  status credit_status not null default 'PENDING',
  penalty_rate numeric,
  penalty_amount numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_credits_tenant_customer_created on credits(tenant_id, customer_id, created_at desc);
create index idx_credits_tenant_status on credits(tenant_id, status);

create table credit_payments (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references credits(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid references stores(id),
  amount numeric not null,
  payment_method payment_method not null,
  reference text,
  notes text,
  user_id uuid references auth.users(id),
  user_name text,
  created_at timestamptz not null default now()
);

create index idx_credit_payments_credit on credit_payments(credit_id);
create index idx_credit_payments_tenant_store_created on credit_payments(tenant_id, store_id, created_at);
revoke update, delete on credit_payments from authenticated, anon;

create table quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  reference text not null,
  customer_id uuid references customers(id),
  status quote_status not null default 'PENDING',
  valid_until timestamptz,
  subtotal numeric not null default 0,
  tax_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  total numeric not null default 0,
  notes text,
  terms text,
  converted_sale_id uuid references sales(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, reference)
);

create index idx_quotes_tenant_customer_created on quotes(tenant_id, customer_id, created_at desc);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  product_sku text,
  quantity numeric not null,
  unit_price numeric not null,
  discount_percent numeric not null default 0,
  tax_rate numeric not null default 0,
  total numeric not null
);

create index idx_quote_items_quote on quote_items(quote_id);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  reference text not null,
  supplier_id uuid references suppliers(id),
  store_id uuid not null references stores(id),
  status purchase_order_status not null default 'DRAFT',
  subtotal numeric not null default 0,
  notes text,
  expected_date timestamptz,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  received_at timestamptz,
  unique (tenant_id, reference)
);

create index idx_purchase_orders_tenant_created on purchase_orders(tenant_id, created_at desc);
revoke insert, update, delete on purchase_orders from authenticated, anon;

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  product_sku text,
  quantity_ordered numeric not null,
  quantity_received numeric not null default 0,
  unit_cost numeric not null,
  total numeric not null
);

create index idx_purchase_order_items_po on purchase_order_items(purchase_order_id);
revoke insert, update, delete on purchase_order_items from authenticated, anon;

create table transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  reference text not null,
  from_store_id uuid not null references stores(id),
  to_store_id uuid not null references stores(id),
  status transfer_status not null default 'PENDING',
  note text,
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  shipped_by uuid references auth.users(id),
  received_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  shipped_at timestamptz,
  received_at timestamptz,
  rejection_reason text,
  unique (tenant_id, reference)
);

create index idx_transfers_from_store on transfers(tenant_id, from_store_id, created_at desc);
create index idx_transfers_to_store on transfers(tenant_id, to_store_id, created_at desc);
create index idx_transfers_status on transfers(tenant_id, status, created_at desc);
revoke insert, update, delete on transfers from authenticated, anon;

create table transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references transfers(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  product_sku text,
  quantity numeric not null
);

create index idx_transfer_lines_transfer on transfer_lines(transfer_id);
revoke insert, update, delete on transfer_lines from authenticated, anon;
