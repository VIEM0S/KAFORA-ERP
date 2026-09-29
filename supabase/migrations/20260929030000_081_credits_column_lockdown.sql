-- credits/credit_payments : verrouille les colonnes de gouvernance contre
-- une ecriture directe via PostgREST avec le JWT d'un Manager, meme si la
-- policy RLS credits_update/credit_payments_insert exige deja
-- can_write(tenant_id) and is_manager() -- ces conditions n'empechent en
-- rien un Manager legitime d'appeler PATCH /rest/v1/credits directement
-- avec son propre acces, en dehors des RPC write_off_credit()/
-- approve_credit_write_off()/reject_credit_write_off()/repay_credit(),
-- pour forcer status='WRITTEN_OFF' sans seuil, sans double validation
-- (contournant le blocage d'auto-approbation de la migration 048) et
-- surtout sans aucune ecriture dans audit_log, qui n'existe que dans ces
-- RPC. Trouve lors de l'audit du 2026-09-29.
--
-- Meme mecanisme que customers.credit_limit (migration 045) : un simple
-- `revoke update (colonnes sensibles)` ne suffit pas tant que credits porte
-- encore un grant UPDATE au niveau de la table entiere pour authenticated
-- (pose implicitement par Supabase a la creation de la table) -- il faut
-- revoke la table entiere puis regrant explicitement les seules colonnes
-- qui doivent rester editables directement par un client.
--
-- Seule colonne legitimement ecrite hors RPC : last_reminder_sent_at
-- (horodatage du rappel WhatsApp, migration 040, app/(dashboard)/credits/
-- page.tsx). Toutes les autres (status, remaining_amount, paid_amount,
-- write_off_status et ses colonnes associees...) ne doivent plus passer que
-- par les fonctions SECURITY DEFINER existantes -- non affectees par ce
-- revoke puisqu'elles s'executent avec les privileges du proprietaire de la
-- fonction, pas de l'appelant.
revoke update on credits from authenticated;
grant update (last_reminder_sent_at) on credits to authenticated;

-- credit_payments : jamais insere directement cote client (grep exhaustif
-- du repo : uniquement lu). Seul repay_credit() (SECURITY DEFINER) doit
-- pouvoir y ecrire, pour que amount/remaining_after restent toujours
-- coherents avec credits.remaining_amount/customers.credit_used -- un
-- insert direct pouvait fabriquer un paiement fictif (montant superieur au
-- solde restant, remaining_after arbitraire) sans jamais toucher au solde
-- reel du credit. update/delete etaient deja bloques (migration 004) ;
-- insert ne l'etait pas.
revoke insert on credit_payments from authenticated;
