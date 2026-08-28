-- Oubliee de la migration 025 (liste initiale des tables temps reel) —
-- necessaire pour que useUsersData() reçoive les mises a jour en direct
-- des demandes de suppression, pas seulement le chargement initial.
alter publication supabase_realtime add table user_deletion_requests;
