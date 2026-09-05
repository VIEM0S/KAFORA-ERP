-- Suite de la migration 039 (audit DSI, store_scope_financial_reads) : ce
-- pass avait cloisonné cash_sessions/purchase_orders/sale_cost_summary/
-- payments par magasin mais n'avait jamais touché les tables ENFANTS
-- (lignes de détail) de sales/purchase_orders/transfers/sale_returns —
-- alors que leur table PARENTE, elle, est bien cloisonnée. Trouvé lors de
-- l'audit du 2026-09-05 en comparant systématiquement chaque table liée à
-- un store_id contre sa parente.
--
-- Conséquence concrète : sale_items est même dans la publication realtime
-- (migration 025) — un Caissier affecté à un seul magasin peut lire (et
-- recevoir en direct via son abonnement realtime) le détail ligne par
-- ligne — y compris le prix d'achat/coût — de TOUTES les ventes de TOUS
-- les magasins du tenant, alors que la table sales elle-même le lui
-- interdit déjà. Même trou sur purchase_order_items/transfer_lines
-- (realtime aussi) et sale_return_items (lecture directe uniquement).
--
-- Même remarque que la 039 : OWNER/ADMIN/store_ids null continuent de
-- tout voir (can_access_store() renvoie true quand auth_store_ids() est
-- null) — ce correctif ne retire rien à la direction, seulement aux
-- rôles mono/multi-magasin déjà cloisonnés sur la table parente.
drop policy if exists sale_items_select on sale_items;
create policy sale_items_select on sale_items for select
  using (
    belongs_to_tenant(tenant_id)
    and can_access_store((select s.store_id from sales s where s.id = sale_items.sale_id))
  );

drop policy if exists purchase_order_items_select on purchase_order_items;
create policy purchase_order_items_select on purchase_order_items for select
  using (
    exists (
      select 1 from purchase_orders p
      where p.id = purchase_order_items.purchase_order_id
        and belongs_to_tenant(p.tenant_id)
        and can_access_store(p.store_id)
    )
  );

drop policy if exists transfer_lines_select on transfer_lines;
create policy transfer_lines_select on transfer_lines for select
  using (
    exists (
      select 1 from transfers t
      where t.id = transfer_lines.transfer_id
        and belongs_to_tenant(t.tenant_id)
        and (can_access_store(t.from_store_id) or can_access_store(t.to_store_id))
    )
  );

drop policy if exists sale_return_items_select on sale_return_items;
create policy sale_return_items_select on sale_return_items for select
  using (
    exists (
      select 1 from sale_returns r
      where r.id = sale_return_items.sale_return_id
        and belongs_to_tenant(r.tenant_id)
        and can_access_store(r.store_id)
    )
  );
