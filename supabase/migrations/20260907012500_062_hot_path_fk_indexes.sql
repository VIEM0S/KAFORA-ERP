-- Perf, trouvé par l'audit (get_advisors, catégorie performance) du 2026-09-07 :
-- 74 clés étrangères sans index couvrant au total (niveau INFO, pas critique en
-- soi). Plutôt que d'indexer les 74 à l'aveugle sur une base financière en
-- production, on cible les colonnes réellement filtrées/jointes par les écrans
-- existants — fiche client (onglets Ventes/Crédits), stock (mouvements par
-- produit/magasin), catalogue (filtre catégorie), scoping magasin d'inscription.
-- Les colonnes d'audit pur (cashier_id, cancelled_by, created_by, user_id,
-- write_off_requested_by) sont laissées de côté : jamais filtrées par l'app
-- aujourd'hui, l'index ne rapporterait rien et coûterait en écriture.
-- Tables encore petites (< 100 lignes chacune) : verrou de création négligeable,
-- pas besoin de CONCURRENTLY.

create index if not exists idx_sales_customer_id on sales(customer_id);
create index if not exists idx_sales_store_id on sales(store_id);
create index if not exists idx_credits_customer_id on credits(customer_id);
create index if not exists idx_inventory_movements_product_id on inventory_movements(product_id);
create index if not exists idx_inventory_movements_store_id on inventory_movements(store_id);
create index if not exists idx_sale_items_product_id on sale_items(product_id);
create index if not exists idx_products_category_id on products(category_id);
create index if not exists idx_customers_registered_store_id on customers(registered_store_id);
