-- "Signaler un problème" (app/api/feedback/route.ts) n'était qu'un email à
-- sens unique, rien n'était conservé en base : pas d'historique, pas de
-- suivi de statut, aucun moyen pour Kafora de répondre autrement que par
-- un email manuel séparé. Demandé explicitement : un vrai suivi.
create type ticket_status as enum ('OPEN', 'ANSWERED', 'CLOSED');
create type ticket_type as enum ('BUG', 'SUGGESTION', 'QUESTION');

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Snapshot du nom/rôle au moment de l'envoi : reste lisible même si
  -- l'utilisateur est supprimé ensuite (même raisonnement que
  -- sale_returns.processed_by_name ailleurs dans ce schéma).
  user_id uuid references users(id) on delete set null,
  user_name text,
  user_email text,
  user_role text,
  type ticket_type not null default 'QUESTION',
  message text not null,
  page_url text,
  status ticket_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_support_tickets_tenant on support_tickets(tenant_id, created_at desc);
create index idx_support_tickets_status on support_tickets(status, created_at desc);

alter table support_tickets enable row level security;

-- Un membre du tenant voit les signalements de SON entreprise (utile pour
-- qu'un Manager retrouve ce qu'un collègue a déjà signalé) — jamais ceux
-- d'un autre tenant. L'écriture passe par /api/feedback (service role,
-- tenant/utilisateur lus depuis la session serveur, jamais du client) ;
-- aucune policy INSERT pour authenticated : on ne veut pas qu'un ticket
-- puisse être fabriqué avec un tenant_id/user_id falsifiés depuis le
-- navigateur.
create policy support_tickets_select on support_tickets for select
  using (belongs_to_tenant(tenant_id));

create table support_ticket_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_type text not null check (author_type in ('CLIENT', 'KAFORA')),
  author_name text,
  message text not null,
  created_at timestamptz not null default now()
);
create index idx_support_ticket_replies_ticket on support_ticket_replies(ticket_id, created_at);

alter table support_ticket_replies enable row level security;

create policy support_ticket_replies_select on support_ticket_replies for select
  using (
    exists (
      select 1 from support_tickets t
      where t.id = support_ticket_replies.ticket_id and belongs_to_tenant(t.tenant_id)
    )
  );

-- Écriture (ticket ET réponse) réservée au service-role — routes
-- /api/feedback et /api/admin/tickets/reply, jamais un INSERT direct
-- depuis le navigateur (pas de policy INSERT/UPDATE pour authenticated,
-- donc refusé par défaut).
