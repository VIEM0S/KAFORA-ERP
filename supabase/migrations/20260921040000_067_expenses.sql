-- Dépenses de l'entreprise, avec seuil de validation.
--
-- Kafora n'avait aucun moyen d'enregistrer une dépense (loyer, salaires,
-- transport, électricité...) : le bénéfice réel d'un commerçant ne pouvait
-- donc pas être calculé. Idée reprise de MANDE-SOLAIRE-DEYE-ERP (dépenses
-- avec seuil de validation), adaptée au modèle de gouvernance déjà en place
-- pour les annulations de crédit (migration 045) : seuil configurable dans
-- tenants, RPC (jamais d'écriture directe), piste d'audit immuable, alerte
-- au siège, et un vrai second regard (pas d'auto-validation).
--
-- Règle : un Responsable/Manager dont la dépense dépasse le seuil crée une
-- demande EN ATTENTE, à valider par le Propriétaire/Administrateur. Un
-- Propriétaire/Administrateur qui saisit lui-même une dépense n'a personne
-- au-dessus de lui : elle est directement approuvée (mais toujours tracée).

alter type alert_type add value 'EXPENSE_PENDING';
alter type alert_type add value 'EXPENSE_DECIDED';

alter table tenants add column expense_approval_threshold numeric not null default 50000;

create table expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid references stores(id) on delete set null,
  category text not null check (category in (
    'RENT','SALARY','UTILITIES','TRANSPORT','SUPPLIES','MAINTENANCE','TAXES','MARKETING','OTHER'
  )),
  amount numeric not null check (amount > 0),
  description text not null,
  expense_date date not null default current_date,
  status text not null default 'APPROVED' check (status in ('APPROVED','PENDING','REJECTED')),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index idx_expenses_tenant_date on expenses(tenant_id, expense_date desc);
create index idx_expenses_tenant_status on expenses(tenant_id, status);

alter table expenses enable row level security;
create policy expenses_select on expenses for select
  using (belongs_to_tenant(tenant_id) and is_manager() and (store_id is null or can_access_store(store_id)));
-- Aucune écriture directe : uniquement create_expense()/decide_expense().
revoke insert, update, delete on expenses from authenticated, anon;
alter publication supabase_realtime add table expenses;

create or replace function create_expense(
  p_store_id uuid, p_category text, p_amount numeric, p_description text,
  p_expense_date date, p_user_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_threshold numeric;
  v_status text;
  v_id uuid;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  if v_tenant is null or not (can_write(v_tenant) and is_manager()) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission d''enregistrer une dépense';
  end if;
  if not exists (select 1 from stores where id = p_store_id and tenant_id = v_tenant) then
    raise exception 'NOT_FOUND: Magasin introuvable';
  end if;
  if not can_access_store(p_store_id) then
    raise exception 'FORBIDDEN: Vous n''avez pas accès à ce magasin';
  end if;
  if p_category is null or p_category not in ('RENT','SALARY','UTILITIES','TRANSPORT','SUPPLIES','MAINTENANCE','TAXES','MARKETING','OTHER') then
    raise exception 'INVALID_INPUT: Catégorie invalide';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_INPUT: Le montant doit être positif';
  end if;
  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'INVALID_INPUT: Le motif est obligatoire';
  end if;
  if p_expense_date is not null and p_expense_date > current_date then
    raise exception 'INVALID_INPUT: La date ne peut pas être dans le futur';
  end if;

  select expense_approval_threshold into v_threshold from tenants where id = v_tenant;

  v_status := case
    when is_owner_or_admin() then 'APPROVED'
    when p_amount > coalesce(v_threshold, 0) then 'PENDING'
    else 'APPROVED'
  end;

  insert into expenses (tenant_id, store_id, category, amount, description, expense_date, status, created_by, created_by_name)
  values (v_tenant, p_store_id, p_category, p_amount, trim(p_description), coalesce(p_expense_date, current_date), v_status, v_actor_id, p_user_name)
  returning id into v_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant, case when v_status = 'PENDING' then 'EXPENSE_REQUESTED' else 'EXPENSE_RECORDED' end,
    'expense', v_id, v_actor_id, p_user_name, v_actor_role::user_role, p_store_id,
    jsonb_build_object('amount', p_amount, 'category', p_category, 'description', trim(p_description), 'threshold', v_threshold));

  return jsonb_build_object('success', true, 'id', v_id, 'status', v_status, 'threshold', v_threshold);
end;
$$;

create or replace function decide_expense(
  p_expense_id uuid, p_approve boolean, p_note text, p_user_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_status text;
  v_created_by uuid;
  v_amount numeric;
  v_description text;
  v_store uuid;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select tenant_id, status, created_by, amount, description, store_id
    into v_tenant, v_status, v_created_by, v_amount, v_description, v_store
    from expenses where id = p_expense_id for update;

  if not found then
    raise exception 'NOT_FOUND: Dépense introuvable';
  end if;
  if not (can_write(v_tenant) and is_owner_or_admin()) then
    raise exception 'FORBIDDEN: Seuls le Propriétaire ou un Administrateur peuvent valider une dépense';
  end if;
  if v_status <> 'PENDING' then
    raise exception 'INVALID_STATUS: Cette dépense n''est plus en attente';
  end if;
  if v_actor_id = v_created_by then
    raise exception 'FORBIDDEN: Vous ne pouvez pas valider votre propre dépense — une autre personne habilitée doit le faire';
  end if;
  if not p_approve and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'INVALID_INPUT: Un motif est obligatoire pour refuser une dépense';
  end if;

  update expenses set
    status = case when p_approve then 'APPROVED' else 'REJECTED' end,
    decided_by = v_actor_id, decided_by_name = p_user_name, decided_at = now(),
    decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_expense_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant, case when p_approve then 'EXPENSE_APPROVED' else 'EXPENSE_REJECTED' end,
    'expense', p_expense_id, v_actor_id, p_user_name, v_actor_role::user_role, v_store,
    jsonb_build_object('amount', v_amount, 'description', v_description, 'note', nullif(trim(coalesce(p_note, '')), '')));

  return jsonb_build_object('success', true, 'createdBy', v_created_by, 'amount', v_amount, 'description', v_description);
end;
$$;

revoke execute on function create_expense(uuid, text, numeric, text, date, text) from public, anon;
grant execute on function create_expense(uuid, text, numeric, text, date, text) to authenticated;
revoke execute on function decide_expense(uuid, boolean, text, text) from public, anon;
grant execute on function decide_expense(uuid, boolean, text, text) to authenticated;
