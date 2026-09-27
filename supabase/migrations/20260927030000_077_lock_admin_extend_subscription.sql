-- Faille trouvée en passant (scanner de sécurité Supabase, 2026-09-27) en
-- modifiant admin_extend_subscription() pour les codes promo : la fonction
-- n'a JAMAIS eu de `revoke execute` depuis sa création (migration 024).
-- Elle ne fait elle-même AUCUN contrôle de permission (ni can_write, ni
-- is_manager, ni SUPER_ADMIN) — la seule barrière est le check
-- `session.role === 'SUPER_ADMIN'` dans app/api/admin/subscription/
-- route.ts, entièrement contournable en appelant la RPC directement via
-- l'API Supabase (n'importe quel Caissier connecté aurait pu prolonger
-- gratuitement l'abonnement de N'IMPORTE QUEL tenant, p_tenant_id étant un
-- paramètre libre sans vérification d'appartenance).
--
-- Le client service-role de la route admin (qui, lui, ignore les grants)
-- continue de fonctionner sans changement : ce revoke ne bloque que les
-- appels directs authentifiés/anonymes.
revoke execute on function admin_extend_subscription(
  uuid, integer, subscription_plan, numeric, text, text, uuid, integer, jsonb, uuid, numeric
) from public, anon, authenticated;
