create table stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  code text not null,
  address text,
  city text,
  phone text,
  email text,
  is_warehouse boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  parent_id uuid references categories(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text,
  barcode text,
  name text not null,
  name_lower text generated always as (lower(name)) stored,
  description text,
  category_id uuid references categories(id),
  unit text,
  purchase_price numeric,
  selling_price numeric not null,
  tax_rate numeric not null default 0,
  alert_threshold numeric,
  image_data text,
  is_active boolean not null default true,
  track_inventory boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Remplace la reservation `product_skus` de Firestore : une contrainte unique
-- native suffit, plus besoin de document de reservation ni de logique
-- applicative pour l'unicite (voir lib/products/sku.ts, supprime).
create unique index uq_products_tenant_sku on products (tenant_id, upper(btrim(sku)))
  where sku is not null and btrim(sku) <> '';

create index idx_products_tenant on products(tenant_id);
create index idx_products_tenant_active_name on products(tenant_id, is_active, name);
create index idx_products_name_trgm on products using gin (name gin_trgm_ops);
create index idx_products_barcode on products(tenant_id, barcode);

create table inventory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  quantity numeric not null default 0,
  min_quantity numeric,
  max_quantity numeric,
  reorder_point numeric,
  last_stock_check timestamptz,
  unique (tenant_id, product_id, store_id)
);

create index idx_inventory_store on inventory(tenant_id, store_id);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id),
  product_name text not null,
  store_id uuid not null references stores(id),
  type inventory_movement_type not null,
  quantity numeric not null,
  previous_quantity numeric,
  new_quantity numeric,
  sale_id uuid,
  transfer_id uuid,
  purchase_order_id uuid,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_inventory_movements_store on inventory_movements(tenant_id, store_id, created_at desc);

-- Immuable : aucune mise a jour ni suppression, meme par le proprietaire du
-- schema applicatif — seul un role d'administration DB pourrait le faire.
revoke update, delete on inventory_movements from authenticated, anon;

create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text,
  first_name text,
  last_name text,
  company_name text,
  search_name text generated always as (lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(company_name,''))) stored,
  email text,
  phone text,
  address text,
  city text,
  customer_type customer_type not null default 'INDIVIDUAL',
  credit_limit numeric not null default 0,
  credit_used numeric not null default 0,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_customers_tenant on customers(tenant_id);
create index idx_customers_search_trgm on customers using gin (search_name gin_trgm_ops);
create index idx_customers_phone on customers(tenant_id, phone);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text,
  name text not null,
  contact_person text,
  email text,
  phone text,
  address text,
  city text,
  country text,
  payment_terms text,
  tax_id text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_suppliers_tenant on suppliers(tenant_id);
