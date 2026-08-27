-- Remplace serverTimestamp() sur updatedAt, présent sur QUASIMENT chaque
-- écriture Firestore côté client. Plutôt que de le reproduire à la main
-- dans chaque route/composant (risque réel d'oubli), un déclencheur générique
-- garantit updated_at = now() sur TOUTE ligne modifiée, sans dépendre de ce
-- que l'appelant envoie (plus robuste qu'un serverTimestamp() qu'on pouvait
-- oublier d'ajouter à un payload).
create or replace function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'updated_at'
        and table_name not in ('rate_limits')
  loop
    execute format('drop trigger if exists trg_set_updated_at on %I', t);
    execute format('create trigger trg_set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end $$;
