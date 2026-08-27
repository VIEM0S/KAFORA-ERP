-- Postgres Changes respecte les politiques RLS SELECT existantes pour
-- filtrer les evenements par client (documente par Supabase) : aucune
-- nouvelle politique necessaire, seulement l'inscription a la publication.
alter publication supabase_realtime add table
  products, categories, customers, suppliers, stores,
  inventory, inventory_movements,
  sales, sale_items, sale_returns,
  credits, credit_payments,
  quotes, quote_items,
  purchase_orders, purchase_order_items,
  transfers, transfer_lines,
  alerts, notifications,
  cash_sessions, cash_registers,
  invoices, daily_stats,
  users, subscriptions;
