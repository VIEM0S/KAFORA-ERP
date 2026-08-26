create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type user_role as enum ('SUPER_ADMIN','OWNER','ADMIN','REGIONAL_MANAGER','MANAGER','CASHIER');
create type subscription_plan as enum ('STARTER','BUSINESS','ENTERPRISE');
create type subscription_status as enum ('TRIAL','ACTIVE','PAST_DUE','CANCELLED','EXPIRED');
create type referral_status as enum ('PENDING','REWARDED');
create type customer_type as enum ('INDIVIDUAL','BUSINESS','WALK_IN');
create type sale_status as enum ('DRAFT','PENDING','COMPLETED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED');
create type payment_method as enum ('CASH','MOBILE_MONEY','BANK_TRANSFER','CREDIT','CARD','SPLIT');
create type credit_status as enum ('PENDING','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED','WRITTEN_OFF');
create type quote_status as enum ('DRAFT','PENDING','SENT','ACCEPTED','REJECTED','EXPIRED','CONVERTED');
create type alert_type as enum (
  'LOW_STOCK','OUT_OF_STOCK','OVERDUE_CREDIT','LARGE_DISCOUNT','REFUND','CASH_VARIANCE',
  'FAILED_PAYMENT','SUSPICIOUS_ACTIVITY','OFFLINE_SYNC_CONFLICT','USER_DELETION_REQUEST','USER_DELETION_RESOLVED'
);
create type alert_severity as enum ('LOW','MEDIUM','HIGH','CRITICAL');
create type notification_channel as enum ('IN_APP','EMAIL','SMS','WHATSAPP','PUSH');
create type transfer_status as enum ('PENDING','APPROVED','SHIPPED','RECEIVED','REJECTED','CANCELLED');
create type purchase_order_status as enum ('DRAFT','SENT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED');
create type return_status as enum ('COMPLETED','CANCELLED');
create type refund_method as enum ('CASH','STORE_CREDIT','ORIGINAL_PAYMENT_METHOD');
create type deletion_request_status as enum ('PENDING','APPROVED','REJECTED','CANCELLED');
create type inventory_movement_type as enum ('SALE','PURCHASE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT','RETURN','INITIAL');
