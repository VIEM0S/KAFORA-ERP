-- Désactivation de compte : fermeture de la fenêtre résiduelle côté base.
--
-- /api/users/toggle-status bannit maintenant le compte Supabase Auth (plus de
-- getUser() valide dans proxy.ts, plus de refresh, plus de reconnexion). Reste
-- un cas : un jeton d'accès DÉJÀ émis, utilisé directement contre PostgREST
-- (sans passer par l'app), reste accepté jusqu'à son expiration (≤ 1 h) car le
-- JWT est vérifié localement. Constaté empiriquement.
--
-- can_write() est le garde-fou de toutes les écritures (politiques RLS et RPC
-- security definer) : on y refuse un utilisateur explicitement désactivé.
-- Lecture PK unique, uniquement sur les écritures — les politiques SELECT
-- (belongs_to_tenant) restent sans lecture de table, pour ne pas réintroduire
-- la régression de performance corrigée en migration 061. La lecture d'un
-- jeton résiduel expire d'elle-même avec le jeton.
-- Ne refuse que is_active = false explicite : aucun effet sur un compte
-- actif ni sur une ligne absente (pas de régression possible).

create or replace function auth_user_is_inactive() returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (select 1 from public.users where id = auth.uid() and is_active = false)
$$;
revoke execute on function auth_user_is_inactive() from public, anon;
grant execute on function auth_user_is_inactive() to authenticated;

create or replace function can_write(tid uuid) returns boolean
language sql stable
as $$
  select belongs_to_tenant(tid) and subscription_active(tid) and not auth_user_is_inactive()
$$;
