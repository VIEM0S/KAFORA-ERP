-- ── Instantanés manquants (l'original Firestore les ecrit, mon schema les
-- avait omis) : necessaires pour que l'historique reste lisible meme apres
-- suppression du client/fournisseur source.
alter table sales add column customer_name text;
alter table credits add column customer_name text;
alter table credits add column customer_phone text;

-- ── Categories : suppression d'une categorie ne doit jamais etre bloquee
-- ni casser un produit/ligne de vente existant (confirme par l'UI : "Les
-- produits associes ne seront pas supprimes").
alter table categories drop constraint categories_parent_id_fkey;
alter table categories add constraint categories_parent_id_fkey foreign key (parent_id) references categories(id) on delete set null;

alter table products drop constraint products_category_id_fkey;
alter table products add constraint products_category_id_fkey foreign key (category_id) references categories(id) on delete set null;

alter table sale_items drop constraint sale_items_category_id_fkey;
alter table sale_items add constraint sale_items_category_id_fkey foreign key (category_id) references categories(id) on delete set null;

-- ── Clients : suppression confirmee "hard delete, aucune cascade" cote UI —
-- meme regle ici, avec le nom deja snapshotte ci-dessus pour rester lisible.
alter table credits alter column customer_id drop not null;
alter table credits drop constraint credits_customer_id_fkey;
alter table credits add constraint credits_customer_id_fkey foreign key (customer_id) references customers(id) on delete set null;

alter table quotes drop constraint quotes_customer_id_fkey;
alter table quotes add constraint quotes_customer_id_fkey foreign key (customer_id) references customers(id) on delete set null;

alter table sale_returns drop constraint sale_returns_customer_id_fkey;
alter table sale_returns add constraint sale_returns_customer_id_fkey foreign key (customer_id) references customers(id) on delete set null;

alter table sales drop constraint sales_customer_id_fkey;
alter table sales add constraint sales_customer_id_fkey foreign key (customer_id) references customers(id) on delete set null;

-- ── Fournisseurs : meme principe.
alter table purchase_orders drop constraint purchase_orders_supplier_id_fkey;
alter table purchase_orders add constraint purchase_orders_supplier_id_fkey foreign key (supplier_id) references suppliers(id) on delete set null;

-- ── Magasins : suppression autorisee cote UI ("Le stock et l'historique
-- associes ne seront pas supprimes"), avec un garde-fou applicatif qui
-- empeche de supprimer le dernier magasin actif. Sans ce fix, toutes ces
-- FK bloqueraient purement et simplement la suppression — le contraire de
-- ce que l'interface promet.
alter table cash_registers drop constraint cash_registers_store_id_fkey;
alter table cash_registers add constraint cash_registers_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table cash_registers alter column store_id drop not null;

alter table cash_sessions drop constraint cash_sessions_store_id_fkey;
alter table cash_sessions add constraint cash_sessions_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table cash_sessions alter column store_id drop not null;

alter table credit_payments drop constraint credit_payments_store_id_fkey;
alter table credit_payments add constraint credit_payments_store_id_fkey foreign key (store_id) references stores(id) on delete set null;

alter table inventory_movements drop constraint inventory_movements_store_id_fkey;
alter table inventory_movements add constraint inventory_movements_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table inventory_movements alter column store_id drop not null;

alter table purchase_orders drop constraint purchase_orders_store_id_fkey;
alter table purchase_orders add constraint purchase_orders_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table purchase_orders alter column store_id drop not null;

alter table sale_cost_summary drop constraint sale_cost_summary_store_id_fkey;
alter table sale_cost_summary add constraint sale_cost_summary_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table sale_cost_summary alter column store_id drop not null;

alter table sale_returns drop constraint sale_returns_store_id_fkey;
alter table sale_returns add constraint sale_returns_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table sale_returns alter column store_id drop not null;

alter table sales drop constraint sales_store_id_fkey;
alter table sales add constraint sales_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table sales alter column store_id drop not null;

alter table transfers drop constraint transfers_from_store_id_fkey;
alter table transfers add constraint transfers_from_store_id_fkey foreign key (from_store_id) references stores(id) on delete set null;
alter table transfers alter column from_store_id drop not null;

alter table transfers drop constraint transfers_to_store_id_fkey;
alter table transfers add constraint transfers_to_store_id_fkey foreign key (to_store_id) references stores(id) on delete set null;
alter table transfers alter column to_store_id drop not null;
