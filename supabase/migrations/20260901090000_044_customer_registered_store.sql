-- Magasin d'inscription du client (modèle "agence bancaire", demandé par
-- l'utilisateur le 2026-09-01) : un client est inscrit dans un magasin,
-- mais peut être servi partout (vente, remboursement de crédit — inchangé,
-- toujours ouvert à tous). Seules les actions sensibles sur la fiche
-- client elle-même deviennent réservées à son magasin d'inscription (ou au
-- siège, store_ids null) : modifier/supprimer le client, modifier sa
-- limite de crédit, annuler un crédit.
--
-- `registered_store_id` est nullable et NE REÇOIT PAS de valeur pour les
-- clients existants : null = ouvert à tous les managers, exactement le
-- comportement actuel. Seuls les clients créés après cette migration sont
-- rattachés à un magasin (voir app/(dashboard)/customers/page.tsx).
alter table customers add column registered_store_id uuid references stores(id);

drop policy customers_write on customers;

create policy customers_insert on customers for insert
  with check (can_write(tenant_id) and is_manager());

create policy customers_update on customers for update
  using (can_write(tenant_id) and is_manager() and (registered_store_id is null or can_access_store(registered_store_id)))
  with check (can_write(tenant_id) and is_manager() and (registered_store_id is null or can_access_store(registered_store_id)));

create policy customers_delete on customers for delete
  using (can_write(tenant_id) and is_manager() and (registered_store_id is null or can_access_store(registered_store_id)));

-- ─────────────────────────────────────────────────────────────────────────
-- Annulation de crédit (WRITTEN_OFF) : la valeur existe dans l'enum
-- credit_status depuis le début (migration 001) mais n'était atteignable
-- depuis aucune UI/RPC — construite ici pour la première fois. Même
-- structure que repay_credit() (migration 029) : verrou de ligne,
-- vérification de permission explicite (RLS ne s'applique pas dans une
-- fonction security definer), erreurs préfixées que le client sait déjà
-- nettoyer.
--
-- Le garde-fou magasin porte sur le magasin D'INSCRIPTION DU CLIENT, pas
-- sur un magasin d'exécution : contrairement à repay_credit() (encaisser
-- un remboursement, ouvert à tous), annuler un crédit est une décision
-- administrative sur la relation client — réservée à "son" gestionnaire.
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
  v_registered_store_id uuid;
begin
  select c.tenant_id, c.customer_id, c.remaining_amount, c.status, cu.registered_store_id
    into v_tenant_id, v_customer_id, v_remaining, v_status, v_registered_store_id
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

  update credits set status = 'WRITTEN_OFF',
    notes = coalesce(notes || E'\n', '') || format('Annulé le %s par %s : %s', to_char(now(), 'DD/MM/YYYY'), p_user_name, p_reason)
    where id = p_credit_id;

  -- Le solde annulé ne doit plus consommer la limite de crédit du client —
  -- sans ça, sa limite resterait bloquée indéfiniment par une dette qui
  -- n'existe plus comptablement.
  update customers set credit_used = greatest(0, coalesce(credit_used, 0) - v_remaining) where id = v_customer_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function write_off_credit(uuid, text, text) from public;
