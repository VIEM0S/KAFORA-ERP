-- Meme classe de bug que la migration 012 (auth.users) : ces tables sont des
-- lignes HISTORIQUES qui snapshottent deja product_name/product_sku pour
-- rester lisibles meme si le produit est supprime (delete-product-dialog.tsx
-- fait une suppression definitive). Sans ON DELETE SET NULL, supprimer un
-- produit ayant le moindre historique aurait ete bloque.
alter table inventory_movements drop constraint inventory_movements_product_id_fkey;
alter table inventory_movements add constraint inventory_movements_product_id_fkey foreign key (product_id) references products(id) on delete set null;

alter table purchase_order_items drop constraint purchase_order_items_product_id_fkey;
alter table purchase_order_items add constraint purchase_order_items_product_id_fkey foreign key (product_id) references products(id) on delete set null;

alter table quote_items drop constraint quote_items_product_id_fkey;
alter table quote_items add constraint quote_items_product_id_fkey foreign key (product_id) references products(id) on delete set null;

alter table sale_items drop constraint sale_items_product_id_fkey;
alter table sale_items add constraint sale_items_product_id_fkey foreign key (product_id) references products(id) on delete set null;

alter table sale_return_items drop constraint sale_return_items_product_id_fkey;
alter table sale_return_items add constraint sale_return_items_product_id_fkey foreign key (product_id) references products(id) on delete set null;

alter table transfer_lines drop constraint transfer_lines_product_id_fkey;
alter table transfer_lines add constraint transfer_lines_product_id_fkey foreign key (product_id) references products(id) on delete set null;
