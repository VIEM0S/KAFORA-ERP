-- Relance de crédit par WhatsApp (session du 2026-08-31, brainstorm produit
-- post-audit DSI) : le commerçant clique un bouton qui ouvre WhatsApp avec un
-- message pré-rempli vers le client en retard — voir
-- app/(dashboard)/credits/page.tsx. Cette colonne ne sert qu'à afficher
-- "Relancé le ..." et éviter les envois en double par erreur ; elle n'envoie
-- rien elle-même (aucune API SMS/WhatsApp n'est intégrée).
alter table credits add column last_reminder_sent_at timestamptz;
