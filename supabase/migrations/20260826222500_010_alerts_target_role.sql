-- Colonne manquante decouverte en portant notifyRole() (app/api/users/delete) :
-- une alerte peut cibler un ROLE entier (ex. tous les OWNER/ADMIN) plutot
-- qu'un utilisateur precis, filtre cote client.
alter table alerts add column target_role user_role;
create index idx_alerts_target_role on alerts(tenant_id, target_role) where target_role is not null;
