-- 1) FAILLE DE CLOISONNEMENT trouvée en construisant cette migration :
-- alerts_select (migration 007) ne vérifie que belongs_to_tenant(tenant_id)
-- — le ciblage par target_user_id/target_role (ex. "ta demande a été
-- approuvée" ne doit être vue QUE par l'Admin qui l'a faite) n'était
-- appliqué QUE côté client (app/(dashboard)/notifications/page.tsx,
-- filtrage en JS après avoir tout récupéré). N'importe quel utilisateur du
-- tenant pouvait lire supabase.from('alerts').select('*') directement et
-- voir toutes les alertes, y compris celles réservées à un autre rôle ou
-- un autre utilisateur précis (crédits annulés, limites changées,
-- réponses de support qu'on s'apprête à ajouter ci-dessous). Corrigé pour
-- que le ciblage soit une vraie frontière RLS, pas une préférence
-- d'affichage.
drop policy if exists alerts_select on alerts;
create policy alerts_select on alerts for select
  using (
    belongs_to_tenant(tenant_id)
    and (
      target_user_id = auth.uid()
      or (target_user_id is null and target_role is not null and target_role::text = auth_role())
      or (target_user_id is null and target_role is null and is_manager())
    )
  );

-- 2) Nouveaux types d'alerte pour ce qui suit (réponse de support,
-- changements d'abonnement décidés par Kafora, annonce générale).
alter type alert_type add value if not exists 'SUPPORT_TICKET_REPLY';
alter type alert_type add value if not exists 'SUBSCRIPTION_SUSPENDED';
alter type alert_type add value if not exists 'SUBSCRIPTION_REACTIVATED';
alter type alert_type add value if not exists 'SUBSCRIPTION_EXTENDED';
alter type alert_type add value if not exists 'KAFORA_ANNOUNCEMENT';
