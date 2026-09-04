-- customers_insert (migration 044) n'imposait pas la même contrainte de
-- magasin d'inscription que customers_update/customers_delete, qui
-- exigent toutes les deux (registered_store_id is null or
-- can_access_store(registered_store_id)). Trouvé par audit : l'UI stampe
-- toujours registered_store_id au magasin courant
-- (app/(dashboard)/customers/page.tsx), mais un Manager mono-magasin
-- pouvait, par appel direct au client Supabase déjà présent dans le
-- navigateur, insérer un client avec registered_store_id = null (portée
-- siège, éditable par n'importe quel manager du tenant) ou avec le
-- registered_store_id d'un AUTRE magasin — contournant le cloisonnement
-- "agence bancaire" dès la création, sans jamais toucher update/delete.
drop policy if exists customers_insert on customers;

create policy customers_insert on customers for insert
  with check (can_write(tenant_id) and is_manager() and (registered_store_id is null or can_access_store(registered_store_id)));
