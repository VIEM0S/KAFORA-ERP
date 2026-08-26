-- Champs decouverts en portant le cycle de vie utilisateur (delete/restore/
-- purge/deletion-requests), absents du schema initial.

alter table users add column deleted_at timestamptz;
alter table users add column deleted_by uuid references auth.users(id);
alter table users add column restored_at timestamptz;
alter table users add column restored_by uuid references auth.users(id);

-- Cible d'alerte par utilisateur precis (en plus de target_role deja ajoute) :
-- notifyAdmin() cible un seul utilisateur, notifyRole() cible tout un role.
alter table alerts add column target_user_id uuid references auth.users(id);
create index idx_alerts_target_user on alerts(tenant_id, target_user_id) where target_user_id is not null;

alter type deletion_request_status add value 'COMPLETED';

alter table user_deletion_requests add column target_user_name text;
alter table user_deletion_requests add column target_user_role user_role;
alter table user_deletion_requests add column requested_by_name text;
alter table user_deletion_requests add column resolved_by_name text;
alter table user_deletion_requests add column resolution_note text;
alter table user_deletion_requests add column completed_at timestamptz;
