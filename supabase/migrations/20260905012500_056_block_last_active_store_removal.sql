-- "Garder au moins un magasin actif" (app/(dashboard)/stores/page.tsx)
-- n'était vérifié que côté navigateur — un Owner/Admin appelant
-- directement supabase.from('stores').delete()/.update({is_active:false})
-- pouvait désactiver ou supprimer tous les magasins d'un tenant sans
-- aucun garde-fou côté base, se coupant lui-même (et toute son équipe)
-- de l'accès au POS/à la caisse. Trouvé lors de l'audit du 2026-09-05.
create or replace function public.block_last_active_store_removal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid := coalesce(old.tenant_id, new.tenant_id);
  v_remaining_active int;
begin
  if tg_op = 'DELETE' and old.is_active = false then
    return old;
  end if;
  if tg_op = 'UPDATE' and (old.is_active = false or new.is_active <> false) then
    return new;
  end if;

  select count(*) into v_remaining_active
    from stores
    where tenant_id = v_tenant_id and is_active = true and id <> old.id;

  if v_remaining_active = 0 then
    raise exception 'LAST_ACTIVE_STORE: Impossible de désactiver ou supprimer le dernier magasin actif du tenant';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;

drop trigger if exists trg_block_last_active_store_delete on public.stores;
create trigger trg_block_last_active_store_delete
  before delete on public.stores
  for each row
  execute function public.block_last_active_store_removal();

drop trigger if exists trg_block_last_active_store_deactivate on public.stores;
create trigger trg_block_last_active_store_deactivate
  before update on public.stores
  for each row
  execute function public.block_last_active_store_removal();
