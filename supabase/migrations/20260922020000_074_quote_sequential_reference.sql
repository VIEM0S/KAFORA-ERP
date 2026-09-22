-- Numérotation des devis : alignée sur celle des ventes/bons de commande
-- (FAC-2026-000001 / BC-2026-000001), au lieu d'un identifiant généré côté
-- client (`DEV-<horodatage base36>`, ex. `DEV-M3K2P1`) — ni lisible, ni
-- séquentiel, ni vérifiable après coup. Signalé par le fondateur : « le
-- numéro créance doit suivre la même logique que les factures, et c'est
-- valable pour tous les autres numéros qui ne suivent pas cette logique ».
--
-- Même schéma que purchase_order_counters (migration 022) : un compteur par
-- tenant, incrémenté atomiquement.

create table quote_counters (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  value int not null default 0
);
revoke all on quote_counters from anon, authenticated;

create or replace function next_quote_reference(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
  v_year text := extract(year from now())::text;
begin
  if not (can_write(p_tenant_id) and is_manager()) then
    raise exception 'FORBIDDEN: Vous n''avez pas la permission de créer un devis';
  end if;

  insert into quote_counters (tenant_id, value) values (p_tenant_id, 1)
    on conflict (tenant_id) do update set value = quote_counters.value + 1
    returning value into v_seq;

  return 'DEV-' || v_year || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke execute on function next_quote_reference(uuid) from public, anon;
grant execute on function next_quote_reference(uuid) to authenticated;
