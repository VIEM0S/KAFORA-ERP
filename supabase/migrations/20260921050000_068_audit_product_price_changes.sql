-- Historique des changements de prix de vente / prix d'achat.
--
-- Jusqu'ici, un Responsable pouvait modifier le prix d'un produit (ou son coût
-- d'achat, qui sert au calcul de marge) sans qu'aucune trace ne subsiste : la
-- ligne produit est simplement écrasée. audit_log ne couvrait que les
-- annulations de crédit et les limites de crédit.
--
-- Un déclencheur (et non un appel dans l'application) garantit la trace quelle
-- que soit la voie d'écriture : formulaire produit, import, appel direct
-- PostgREST. Il n'écrit que si le prix de vente ou d'achat change réellement
-- (le formulaire réécrit toutes les colonnes à chaque enregistrement).
--
-- Pas de trace de suppression de produit ici : la suppression d'un tenant
-- supprime en cascade ses produits, et écrire dans audit_log pour un tenant
-- en cours de suppression violerait sa clé étrangère.

create or replace function audit_product_price_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_role user_role;
begin
  if auth.uid() is not null then
    select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
      into v_name from users where id = auth.uid();
  end if;
  -- Rôle lu dans l'énumération : jamais d'erreur (donc jamais de blocage de la
  -- modification du produit) si la revendication est vide ou inattendue.
  select r into v_role from unnest(enum_range(null::user_role)) r where r::text = auth_role();

  insert into audit_log (tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role, details)
  values (
    new.tenant_id, 'PRODUCT_PRICE_CHANGED', 'product', new.id, auth.uid(), v_name, v_role,
    jsonb_build_object(
      'name', new.name,
      'selling_price', jsonb_build_object('from', old.selling_price, 'to', new.selling_price),
      'purchase_price', jsonb_build_object('from', old.purchase_price, 'to', new.purchase_price)
    )
  );
  return new;
end;
$$;

create trigger trg_audit_product_price_change
  after update of selling_price, purchase_price on products
  for each row
  when (old.selling_price is distinct from new.selling_price or old.purchase_price is distinct from new.purchase_price)
  execute function audit_product_price_change();
