-- Différenciation sectorielle profonde (session du 2026-08-31, brainstorm
-- produit post-audit DSI) : suivi de péremption/lots (utile Épicerie) et
-- suivi par numéro de série/IMEI (utile Électronique/Téléphonie).
--
-- inventory.quantity reste la source de vérité agrégée par (produit,
-- magasin) — aucune lecture existante à réécrire. product_lots et
-- product_serials sont des ventilations additionnelles, tenues en
-- cohérence dans la même transaction à chaque mouvement de stock.

alter table products add column track_expiry boolean not null default false;
alter table products add column track_serial boolean not null default false;
alter table products add constraint chk_products_track_exclusive
  check (not (track_expiry and track_serial));

-- ─── Lots à péremption (FEFO) ───────────────────────────────────────────────

create table product_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  quantity numeric not null default 0 check (quantity >= 0),
  expiry_date date not null,
  received_at timestamptz not null default now(),
  purchase_order_id uuid references purchase_orders(id),
  notes text,
  created_at timestamptz not null default now()
);

create index idx_product_lots_product_store on product_lots(tenant_id, product_id, store_id) where quantity > 0;
create index idx_product_lots_expiry on product_lots(tenant_id, expiry_date) where quantity > 0;

alter table product_lots enable row level security;

create policy product_lots_select on product_lots for select
  using (belongs_to_tenant(tenant_id) and can_access_store(store_id));
create policy product_lots_insert on product_lots for insert
  with check (can_write(tenant_id) and is_manager() and can_access_store(store_id));
create policy product_lots_update on product_lots for update
  using (can_write(tenant_id) and is_manager() and can_access_store(store_id))
  with check (can_write(tenant_id) and is_manager() and can_access_store(store_id));

-- ─── Numéros de série / IMEI ────────────────────────────────────────────────

create table product_serials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  serial_number text not null,
  status text not null default 'IN_STOCK' check (status in ('IN_STOCK', 'SOLD')),
  sale_id uuid references sales(id),
  sold_at timestamptz,
  received_at timestamptz not null default now(),
  purchase_order_id uuid references purchase_orders(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, product_id, serial_number)
);

create index idx_product_serials_available on product_serials(tenant_id, product_id, store_id) where status = 'IN_STOCK';

alter table product_serials enable row level security;

create policy product_serials_select on product_serials for select
  using (belongs_to_tenant(tenant_id) and can_access_store(store_id));
create policy product_serials_insert on product_serials for insert
  with check (can_write(tenant_id) and is_manager() and can_access_store(store_id));
create policy product_serials_update on product_serials for update
  using (can_write(tenant_id) and is_manager() and can_access_store(store_id))
  with check (can_write(tenant_id) and is_manager() and can_access_store(store_id));

-- Le numéro de série vendu doit rester lisible sur la vente (ticket,
-- historique, SAV) même si product_serials est modifié plus tard.
alter table sale_items add column serial_number text;
