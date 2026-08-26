-- Toutes ces colonnes ne sont que des references HISTORIQUES vers l'acteur
-- d'une action passee (qui a encaisse cette vente, qui a approuve ce
-- transfert...). Sans ON DELETE SET NULL, purger un compte (users/purge)
-- aurait ete bloque des qu'il a le moindre historique — une regression
-- silencieuse par rapport a Firestore, ou ces champs etaient de simples
-- chaines sans contrainte referentielle. Le nom lisible est deja
-- snapshotte a cote (ex. processed_by_name, opened_by_name) precisement
-- pour que l'historique reste comprehensible meme apres purge.

alter table alerts drop constraint alerts_resolved_by_fkey;
alter table alerts add constraint alerts_resolved_by_fkey foreign key (resolved_by) references auth.users(id) on delete set null;

alter table alerts drop constraint alerts_target_user_id_fkey;
alter table alerts add constraint alerts_target_user_id_fkey foreign key (target_user_id) references auth.users(id) on delete set null;

alter table audit_logs drop constraint audit_logs_user_id_fkey;
alter table audit_logs add constraint audit_logs_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

alter table cash_sessions drop constraint cash_sessions_opened_by_fkey;
alter table cash_sessions add constraint cash_sessions_opened_by_fkey foreign key (opened_by) references auth.users(id) on delete set null;

alter table cash_sessions drop constraint cash_sessions_closed_by_fkey;
alter table cash_sessions add constraint cash_sessions_closed_by_fkey foreign key (closed_by) references auth.users(id) on delete set null;

alter table credit_payments drop constraint credit_payments_user_id_fkey;
alter table credit_payments add constraint credit_payments_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

alter table error_logs drop constraint error_logs_user_id_fkey;
alter table error_logs add constraint error_logs_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

alter table inventory_movements drop constraint inventory_movements_created_by_fkey;
alter table inventory_movements add constraint inventory_movements_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

alter table invoices drop constraint invoices_created_by_fkey;
alter table invoices add constraint invoices_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

alter table purchase_orders drop constraint purchase_orders_created_by_fkey;
alter table purchase_orders add constraint purchase_orders_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

alter table sale_returns drop constraint sale_returns_processed_by_fkey;
alter table sale_returns add constraint sale_returns_processed_by_fkey foreign key (processed_by) references auth.users(id) on delete set null;

alter table sales drop constraint sales_cashier_id_fkey;
alter table sales add constraint sales_cashier_id_fkey foreign key (cashier_id) references auth.users(id) on delete set null;

alter table subscription_payments drop constraint subscription_payments_recorded_by_fkey;
alter table subscription_payments add constraint subscription_payments_recorded_by_fkey foreign key (recorded_by) references auth.users(id) on delete set null;

alter table super_admin_logs drop constraint super_admin_logs_performed_by_fkey;
alter table super_admin_logs add constraint super_admin_logs_performed_by_fkey foreign key (performed_by) references auth.users(id) on delete set null;

alter table transfers drop constraint transfers_received_by_fkey;
alter table transfers add constraint transfers_received_by_fkey foreign key (received_by) references auth.users(id) on delete set null;

alter table transfers drop constraint transfers_shipped_by_fkey;
alter table transfers add constraint transfers_shipped_by_fkey foreign key (shipped_by) references auth.users(id) on delete set null;

alter table transfers drop constraint transfers_approved_by_fkey;
alter table transfers add constraint transfers_approved_by_fkey foreign key (approved_by) references auth.users(id) on delete set null;

alter table transfers drop constraint transfers_requested_by_fkey;
alter table transfers add constraint transfers_requested_by_fkey foreign key (requested_by) references auth.users(id) on delete set null;

alter table user_deletion_requests drop constraint user_deletion_requests_resolved_by_fkey;
alter table user_deletion_requests add constraint user_deletion_requests_resolved_by_fkey foreign key (resolved_by) references auth.users(id) on delete set null;

-- requested_by etait NOT NULL : impossible avec ON DELETE SET NULL si le
-- demandeur est purge un jour. On la relache, le nom est deja snapshotte
-- dans requested_by_name.
alter table user_deletion_requests alter column requested_by drop not null;
alter table user_deletion_requests drop constraint user_deletion_requests_requested_by_fkey;
alter table user_deletion_requests add constraint user_deletion_requests_requested_by_fkey foreign key (requested_by) references auth.users(id) on delete set null;

alter table users drop constraint users_deleted_by_fkey;
alter table users add constraint users_deleted_by_fkey foreign key (deleted_by) references auth.users(id) on delete set null;

alter table users drop constraint users_restored_by_fkey;
alter table users add constraint users_restored_by_fkey foreign key (restored_by) references auth.users(id) on delete set null;

-- notifications.user_id reste NOT NULL (une notification appartient a QUELQU'UN
-- par definition) : si la personne est purgee, ses notifications personnelles
-- n'ont plus de sens a conserver -> CASCADE plutot que SET NULL.
alter table notifications drop constraint notifications_user_id_fkey;
alter table notifications add constraint notifications_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
