-- ─────────────────────────────────────────────────────────────────────────
-- Cloisonnement magasin des lectures financières
--
-- Audit DSI du 2026-08-31 : 5 tables portant un store_id (ou lié à un
-- magasin) n'appliquaient que belongs_to_tenant() en lecture, pas
-- can_access_store(). Un employé affecté à un seul magasin pouvait donc
-- lire, via l'API, des données d'un AUTRE magasin de la même entreprise —
-- ce que la politique de confidentialité promet pourtant d'empêcher
-- (« ni le stock, ni les ventes, ni la caisse des autres »).
--
-- Prouvé avant/après par simulation de rôle : un caissier scopé à Bamako
-- voyait la session de caisse et les paiements de Sikasso ; il ne les voit
-- plus. L'OWNER/ADMIN (store_ids absent = siège) continue de tout voir —
-- can_access_store() renvoie true quand auth_store_ids() is null.
--
-- Écritures NON impactées : ces tables sont écrites par des RPC
-- SECURITY DEFINER (pos_checkout, open/close_cash_register,
-- create/receive_purchase_order…) qui contournent RLS. Seules les
-- politiques SELECT changent.
--
-- credit_payments VOLONTAIREMENT NON MODIFIÉE : un crédit client est au
-- niveau entreprise (table credits sans store_id) et peut être remboursé
-- dans un magasin différent de celui de la vente. Cloisonner credit_payments
-- masquerait une partie de l'historique d'un crédit pourtant légitimement
-- visible, cassant la page Crédits. Les paiements d'un crédit font partie du
-- dossier crédit company-wide, pas de la caisse « privée » d'un magasin. La
-- réconciliation de caisse filtre déjà explicitement par store_id côté app
-- (cash-register/page.tsx), donc rien à changer là.
-- ─────────────────────────────────────────────────────────────────────────

-- Session de caisse : appartient à un magasin unique.
alter policy cash_sessions_select on cash_sessions
  using (belongs_to_tenant(tenant_id) and can_access_store(store_id));

-- Commandes fournisseurs : rattachées à un magasin.
alter policy purchase_orders_select on purchase_orders
  using (belongs_to_tenant(tenant_id) and can_access_store(store_id));

-- Résumés de coût/marge par vente (déjà réservés aux managers).
alter policy sale_cost_summary_select on sale_cost_summary
  using (belongs_to_tenant(tenant_id) and is_manager() and can_access_store(store_id));

-- Paiements : pas de store_id direct, rattachés via la vente. L'app ne
-- lit jamais cette table directement (uniquement écrite par pos_checkout),
-- donc aucun impact UX — on ferme seulement la fuite API théorique.
alter policy payments_select on payments
  using (
    belongs_to_tenant(tenant_id)
    and can_access_store((select s.store_id from sales s where s.id = payments.sale_id))
  );
