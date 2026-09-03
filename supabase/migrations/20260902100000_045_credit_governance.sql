-- Gouvernance des actions sensibles sur les crédits/clients (demandé
-- explicitement le 2026-09-02, en réponse à une auto-critique après le
-- modèle "agence bancaire" de la migration 044) : trois manques identifiés
-- en comparant à comment une vraie banque/microfinance structure ça —
-- piste d'audit séparée, alerte au siège, seuil + double validation pour
-- les annulations de crédit importantes, et la limite de crédit sortie du
-- formulaire générique pour devenir sa propre action tracée.

-- ─── Nouveaux types d'alerte ────────────────────────────────────────────────
alter type alert_type add value 'CREDIT_WRITTEN_OFF';
alter type alert_type add value 'CREDIT_WRITE_OFF_PENDING';
alter type alert_type add value 'CREDIT_LIMIT_CHANGED';

-- ─── Seuil d'approbation (configurable par le Propriétaire, Réglages) ──────
-- Au-delà, une annulation de crédit demande une seconde validation du
-- siège au lieu de s'appliquer immédiatement. 100 000 FCFA par défaut —
-- valeur de départ raisonnable pour un petit commerce, à ajuster.
alter table tenants add column write_off_approval_threshold numeric not null default 100000;

-- ─── Piste d'audit immuable ─────────────────────────────────────────────────
-- Générique (entity_type/entity_id) pour pouvoir servir au-delà des seuls
-- crédits si besoin plus tard, mais alimentée aujourd'hui uniquement par
-- write_off_credit/approve_credit_write_off/reject_credit_write_off/
-- set_credit_limit. Jamais modifiable ni supprimable, même par un Owner —
-- une piste d'audit qu'on peut éditer n'en est pas une.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  actor_id uuid references auth.users(id),
  actor_name text,
  actor_role user_role,
  store_id uuid references stores(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_log_tenant_entity on audit_log(tenant_id, entity_type, entity_id, created_at desc);
alter table audit_log enable row level security;
create policy audit_log_select on audit_log for select using (belongs_to_tenant(tenant_id) and is_manager());
revoke insert, update, delete on audit_log from authenticated, anon;
-- Sans ça, watch() (lib/supabase/watch.ts) reçoit bien la première requête
-- au montage mais plus aucune mise à jour ensuite : le canal Realtime de
-- Supabase ne livre d'événements que pour les tables listées dans cette
-- publication (trouvé en vérifiant en direct après un annuler/valider qui
-- laissait le panneau "Journal d'audit" bloqué sur son état initial vide).
alter publication supabase_realtime add table audit_log;

-- ─── Demande d'annulation en attente (double validation) ───────────────────
alter table credits add column write_off_status text not null default 'NONE'
  check (write_off_status in ('NONE','PENDING','REJECTED'));
alter table credits add column write_off_requested_by uuid references auth.users(id);
alter table credits add column write_off_requested_by_name text;
alter table credits add column write_off_requested_at timestamptz;
alter table credits add column write_off_reason text;
alter table credits add column write_off_rejected_reason text;

-- ─── Limite de crédit : sortie du formulaire générique client ──────────────
-- Même un Owner ne peut plus la modifier par un update direct — seule
-- set_credit_limit() le peut, pour que CHAQUE changement passe par
-- audit_log sans exception ni contournement possible.
--
-- Un simple `revoke update (credit_limit) ...` NE SUFFIT PAS : customers
-- porte déjà un grant UPDATE au niveau de la table entière pour
-- `authenticated` (posé par sa migration de création), et Postgres ne fait
-- pas l'intersection entre un grant table et un revoke colonne — ce sont
-- deux chemins de privilège indépendants/additifs. Vérifié en direct par
-- simulation de rôle : un `revoke update (credit_limit)` seul laissait
-- l'update passer quand même. La seule façon fiable de vraiment protéger
-- cette colonne est de révoquer l'UPDATE de la table entière, puis de le
-- regrant explicitement sur la liste des colonnes qui doivent rester
-- éditables par le client (tout sauf credit_limit et credit_used, cette
-- dernière n'étant modifiée que par les RPC de vente/versement/annulation).
-- registered_store_id est volontairement absent de cette liste : il n'est
-- jamais réécrit après coup (voir customers/page.tsx, stampé seulement à
-- l'insert) — pas de UI de "transfert" de client entre magasins, hors
-- périmètre du modèle "agence bancaire" retenu (migration 044).
revoke update on customers from authenticated;
grant update (code, first_name, last_name, company_name, email, phone, address, city, customer_type, notes, is_active)
  on customers to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- write_off_credit() : remplace la version de la migration 044. Sous le
-- seuil, comportement inchangé (annulation immédiate). Au-dessus, crée une
-- demande en attente au lieu d'appliquer quoi que ce soit — voir
-- approve_credit_write_off()/reject_credit_write_off() plus bas.
create or replace function write_off_credit(
  p_credit_id uuid, p_reason text, p_user_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_customer_id uuid;
  v_remaining numeric;
  v_status credit_status;
  v_write_off_status text;
  v_registered_store_id uuid;
  v_threshold numeric;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select c.tenant_id, c.customer_id, c.remaining_amount, c.status, c.write_off_status, cu.registered_store_id
    into v_tenant_id, v_customer_id, v_remaining, v_status, v_write_off_status, v_registered_store_id
    from credits c join customers cu on cu.id = c.customer_id
    where c.id = p_credit_id for update;

  if not found then
    raise exception 'NOT_FOUND: Crédit introuvable';
  end if;
  if not (can_write(v_tenant_id) and is_manager()) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission d''annuler un crédit';
  end if;
  if not (v_registered_store_id is null or can_access_store(v_registered_store_id)) then
    raise exception 'FORBIDDEN: Seul le magasin d''inscription de ce client peut annuler ce crédit';
  end if;
  if v_status in ('PAID', 'WRITTEN_OFF', 'CANCELLED') then
    raise exception 'INVALID_STATUS: Ce crédit ne peut plus être annulé (%)', v_status;
  end if;
  if v_write_off_status = 'PENDING' then
    raise exception 'INVALID_STATUS: Une demande d''annulation est déjà en attente pour ce crédit';
  end if;

  select write_off_approval_threshold into v_threshold from tenants where id = v_tenant_id;

  if v_remaining > coalesce(v_threshold, 0) then
    update credits set
      write_off_status = 'PENDING',
      write_off_requested_by = v_actor_id,
      write_off_requested_by_name = p_user_name,
      write_off_requested_at = now(),
      write_off_reason = p_reason,
      write_off_rejected_reason = null
    where id = p_credit_id;

    insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
    values (v_tenant_id, 'CREDIT_WRITE_OFF_REQUESTED', 'credit', p_credit_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
      jsonb_build_object('amount', v_remaining, 'reason', p_reason, 'threshold', v_threshold));

    return jsonb_build_object('success', true, 'status', 'PENDING_APPROVAL', 'threshold', v_threshold);
  end if;

  update credits set status = 'WRITTEN_OFF', write_off_status = 'NONE',
    notes = coalesce(notes || E'\n', '') || format('Annulé le %s par %s : %s', to_char(now(), 'DD/MM/YYYY'), p_user_name, p_reason)
    where id = p_credit_id;
  update customers set credit_used = greatest(0, coalesce(credit_used, 0) - v_remaining) where id = v_customer_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant_id, 'CREDIT_WRITTEN_OFF', 'credit', p_credit_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
    jsonb_build_object('amount', v_remaining, 'reason', p_reason));

  return jsonb_build_object('success', true, 'status', 'WRITTEN_OFF');
end;
$$;

revoke execute on function write_off_credit(uuid, text, text) from public;

-- ─────────────────────────────────────────────────────────────────────────
-- approve_credit_write_off() : le siège (Owner/Admin) valide une demande
-- au-dessus du seuil — applique alors exactement l'effet qu'aurait eu une
-- annulation immédiate.
create or replace function approve_credit_write_off(
  p_credit_id uuid, p_user_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_customer_id uuid;
  v_remaining numeric;
  v_write_off_status text;
  v_reason text;
  v_requested_by uuid;
  v_registered_store_id uuid;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select c.tenant_id, c.customer_id, c.remaining_amount, c.write_off_status, c.write_off_reason, c.write_off_requested_by, cu.registered_store_id
    into v_tenant_id, v_customer_id, v_remaining, v_write_off_status, v_reason, v_requested_by, v_registered_store_id
    from credits c join customers cu on cu.id = c.customer_id
    where c.id = p_credit_id for update;

  if not found then raise exception 'NOT_FOUND: Crédit introuvable'; end if;
  if not (can_write(v_tenant_id) and is_owner_or_admin()) then
    raise exception 'FORBIDDEN: Seuls le Propriétaire ou un Administrateur peuvent valider une annulation de crédit';
  end if;
  if v_write_off_status <> 'PENDING' then
    raise exception 'INVALID_STATUS: Aucune demande en attente pour ce crédit';
  end if;

  update credits set status = 'WRITTEN_OFF', write_off_status = 'NONE',
    notes = coalesce(notes || E'\n', '') || format('Annulé le %s (validé par %s) : %s', to_char(now(), 'DD/MM/YYYY'), p_user_name, v_reason)
    where id = p_credit_id;
  update customers set credit_used = greatest(0, coalesce(credit_used, 0) - v_remaining) where id = v_customer_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant_id, 'CREDIT_WRITE_OFF_APPROVED', 'credit', p_credit_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
    jsonb_build_object('amount', v_remaining, 'reason', v_reason));

  return jsonb_build_object('success', true, 'requestedBy', v_requested_by, 'amount', v_remaining);
end;
$$;

revoke execute on function approve_credit_write_off(uuid, text) from public;

-- ─────────────────────────────────────────────────────────────────────────
-- reject_credit_write_off() : le siège refuse — rien n'est modifié sur le
-- crédit lui-même (statut, solde), seule la demande est marquée refusée.
-- Le magasin d'inscription peut soumettre une nouvelle demande ensuite.
create or replace function reject_credit_write_off(
  p_credit_id uuid, p_user_name text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_write_off_status text;
  v_requested_by uuid;
  v_registered_store_id uuid;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select c.tenant_id, c.write_off_status, c.write_off_requested_by, cu.registered_store_id
    into v_tenant_id, v_write_off_status, v_requested_by, v_registered_store_id
    from credits c join customers cu on cu.id = c.customer_id
    where c.id = p_credit_id for update;

  if not found then raise exception 'NOT_FOUND: Crédit introuvable'; end if;
  if not (can_write(v_tenant_id) and is_owner_or_admin()) then
    raise exception 'FORBIDDEN: Seuls le Propriétaire ou un Administrateur peuvent refuser une annulation de crédit';
  end if;
  if v_write_off_status <> 'PENDING' then
    raise exception 'INVALID_STATUS: Aucune demande en attente pour ce crédit';
  end if;

  update credits set write_off_status = 'REJECTED', write_off_rejected_reason = p_reason where id = p_credit_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant_id, 'CREDIT_WRITE_OFF_REJECTED', 'credit', p_credit_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
    jsonb_build_object('reason', p_reason));

  return jsonb_build_object('success', true, 'requestedBy', v_requested_by);
end;
$$;

revoke execute on function reject_credit_write_off(uuid, text, text) from public;

-- ─────────────────────────────────────────────────────────────────────────
-- set_credit_limit() : seul chemin désormais possible pour changer la
-- limite de crédit d'un client (colonne protégée par revoke plus haut).
create or replace function set_credit_limit(
  p_customer_id uuid, p_new_limit numeric, p_reason text, p_user_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_registered_store_id uuid;
  v_old_limit numeric;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth_role();
begin
  select tenant_id, registered_store_id, credit_limit into v_tenant_id, v_registered_store_id, v_old_limit
    from customers where id = p_customer_id for update;

  if not found then raise exception 'NOT_FOUND: Client introuvable'; end if;
  if not (can_write(v_tenant_id) and is_manager()) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission de modifier la limite de crédit';
  end if;
  if not (v_registered_store_id is null or can_access_store(v_registered_store_id)) then
    raise exception 'FORBIDDEN: Seul le magasin d''inscription de ce client peut modifier sa limite de crédit';
  end if;
  if p_new_limit is null or p_new_limit < 0 then
    raise exception 'INVALID_AMOUNT: Limite invalide';
  end if;

  update customers set credit_limit = p_new_limit where id = p_customer_id;

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, store_id, details)
  values (v_tenant_id, 'CREDIT_LIMIT_CHANGED', 'customer', p_customer_id, v_actor_id, p_user_name, v_actor_role::user_role, v_registered_store_id,
    jsonb_build_object('previous_limit', v_old_limit, 'new_limit', p_new_limit, 'reason', p_reason));

  return jsonb_build_object('success', true, 'previousLimit', v_old_limit, 'newLimit', p_new_limit);
end;
$$;

revoke execute on function set_credit_limit(uuid, numeric, text, text) from public;
