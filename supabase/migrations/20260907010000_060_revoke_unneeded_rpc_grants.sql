-- Durcissement défense-en-profondeur, trouvé par l'audit sécurité (get_advisors) du
-- 2026-09-07 : plusieurs fonctions étaient exécutables via /rest/v1/rpc/... par des
-- rôles qui n'en ont jamais besoin. Aucune n'était réellement exploitable (vérifié en
-- direct : write_off_credit et set_credit_limit rejettent bien un appel anonyme avec
-- FORBIDDEN, can_write()/is_manager() exigent auth.uid() non nul) — mais le principe du
-- moindre privilège dit de ne pas compter uniquement sur la logique interne : si une
-- future fonction du même genre oublie la vérification, le GRANT explicite est la seule
-- protection restante.

-- Ces 4 RPC de gouvernance crédit ne sont jamais appelées côté client sans session
-- utilisateur active : retirer l'accès anonyme est sans impact fonctionnel.
revoke execute on function write_off_credit(uuid, text, text) from anon;
revoke execute on function set_credit_limit(uuid, numeric, text, text) from anon;
revoke execute on function approve_credit_write_off(uuid, text) from anon;
revoke execute on function reject_credit_write_off(uuid, text, text) from anon;

-- Ces deux fonctions sont des triggers (elles lisent `old`/`new`/`tg_op`) : appelées
-- hors d'un contexte de trigger, Postgres refuse déjà l'exécution, mais elles n'ont
-- jamais eu besoin d'être exposées via l'API REST à qui que ce soit.
revoke execute on function block_last_active_store_removal() from public, anon, authenticated;
revoke execute on function prevent_self_privilege_escalation() from public, anon, authenticated;
