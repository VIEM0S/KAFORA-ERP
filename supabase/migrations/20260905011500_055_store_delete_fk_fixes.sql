-- Suite de la migration 019 (deletable_entity_fk_fixes), qui avait déjà
-- converti 9 tables de `on delete cascade` à `on delete set null` pour
-- store_id sur la suppression d'un magasin (sales, sale_returns,
-- sale_cost_summary, purchase_orders, transfers, credit_payments,
-- cash_registers, cash_sessions, inventory_movements) — trois tables sont
-- passées entre les mailles du filet, jamais touchées par ce pass :
-- inventory, product_lots, product_serials, toutes encore en CASCADE.
--
-- Trouvé lors de l'audit du 2026-09-05 : le dialogue de suppression d'un
-- magasin (app/(dashboard)/stores/page.tsx) affirme explicitement "le
-- stock et l'historique associés ne seront pas supprimés" — c'était FAUX
-- pour ces trois tables. Supprimer un magasin détruisait silencieusement
-- les quantités en stock, les lots de péremption (FEFO) et l'historique
-- des numéros de série/IMEI de ce magasin, y compris pour des séries déjà
-- VENDUES (product_serials garde son store_id après la vente).
alter table inventory drop constraint inventory_store_id_fkey;
alter table inventory add constraint inventory_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table inventory alter column store_id drop not null;

alter table product_lots drop constraint product_lots_store_id_fkey;
alter table product_lots add constraint product_lots_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table product_lots alter column store_id drop not null;

alter table product_serials drop constraint product_serials_store_id_fkey;
alter table product_serials add constraint product_serials_store_id_fkey foreign key (store_id) references stores(id) on delete set null;
alter table product_serials alter column store_id drop not null;
