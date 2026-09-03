-- Suite à une question de l'utilisateur sur ce qu'un compte Caissier voit
-- dans l'appli, audit complet des boutons de gestion (produits, catégories,
-- stock, fournisseurs, clients, crédits) visibles/actifs pour TOUS les rôles
-- côté UI. Le RLS bloquait déjà réellement l'écriture pour products/
-- categories/customers/suppliers/inventory (tous exigent is_manager(), qui
-- exclut CASHIER — vérifié en direct par simulation de rôle avant toute
-- correction), donc pas de brèche là — juste des boutons qui promettent une
-- action qu'ils ne peuvent pas accomplir. Correction UI en parallèle (voir
-- commit) : masquage des sections de gestion pour CASHIER.
--
-- UNE vraie faille trouvée en creusant : inventory_movements_insert
-- n'exigeait PAS is_manager(), contrairement à ses tables sœurs
-- (inventory_write, product_lots_insert, product_serials_insert). Un
-- CASHIER ne peut pas changer la quantité réelle (inventory, bien protégée)
-- mais pouvait insérer une ligne de mouvement fabriquée dans l'historique —
-- prouvé en direct par simulation de rôle avant correction (update inventory
-- → 0 ligne, insert inventory_movements → réussit). Déjà appliqué en
-- production (apply_migration `fix_inventory_movements_insert_requires_manager`),
-- ce fichier documente la même correction pour que le schéma local et
-- l'historique de migrations restent la source de vérité.
drop policy if exists inventory_movements_insert on inventory_movements;
create policy inventory_movements_insert on inventory_movements
  for insert
  with check (can_write(tenant_id) and is_manager() and can_access_store(store_id));
