-- Correction du modèle de caisse (demandé explicitement le 2026-09-03) :
-- une seule caisse "ouverte" existait par MAGASIN (contrainte unique
-- (tenant_id, store_id) sur cash_registers), partagée par tout le monde.
-- Deux caissiers avec deux tiroirs physiques distincts ne pouvaient donc
-- jamais avoir chacun leur propre session — le second se heurtait à
-- ALREADY_OPEN, ou pire, ses ventes finissaient mélangées avec celles du
-- premier dans une seule clôture (aucun rapprochement individuel possible
-- en cas d'écart). Vérifié dans le code avant toute correction : ni
-- sales/credit_payments/sale_returns ni close_cash_register() ne filtraient
-- jamais par caissier, seulement par magasin + fenêtre de temps.
--
-- Modèle retenu (validé explicitement par l'utilisateur, 2 questions) :
-- 1. Attribution automatique par personne — chaque utilisateur obtient sa
--    propre caisse auto-créée à son nom, sans écran de configuration.
-- 2. Pas de "relève" formelle — un caissier qui encaisse sans avoir ouvert
--    SA caisse voit le même avertissement "hors clôture" qu'aujourd'hui
--    (app/(dashboard)/pos/page.tsx), volontairement inchangé.
--
-- Rien à migrer : les cash_registers/cash_sessions déjà en base restent
-- valides telles quelles (owner_user_id NULL = ancienne caisse partagée,
-- jamais réutilisée par le nouveau code, jamais en collision avec les
-- nouvelles lignes par personne grâce au NULL distinct de Postgres dans un
-- index unique).

alter table cash_registers add column owner_user_id uuid references auth.users(id);

alter table cash_registers drop constraint if exists uq_cash_registers_tenant_store;
create unique index uq_cash_registers_tenant_store_owner
  on cash_registers (tenant_id, store_id, owner_user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- close_cash_register() : ajoute le filtre par titulaire de la session
-- (cashier_id/user_id/processed_by) à chacune des 3 requêtes de calcul,
-- en plus du magasin et de la fenêtre de temps déjà en place. C'est ce qui
-- rend deux caisses simultanées au même magasin réellement indépendantes
-- l'une de l'autre.
create or replace function close_cash_register(
  p_tenant_id uuid, p_store_id uuid, p_register_id uuid,
  p_caller_id uuid, p_caller_name text, p_counted_amount numeric, p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_opened_by uuid;
  v_opened_by_name text;
  v_opened_at timestamptz;
  v_opening_balance numeric;
  v_cash_sales_total numeric := 0;
  v_acompte_total numeric := 0;
  v_sales_total numeric := 0;
  v_sales_count int := 0;
  v_credit_repayment_total numeric := 0;
  v_cash_refund_total numeric := 0;
  v_expected_balance numeric;
  v_difference numeric;
begin
  select id, opened_by, opened_by_name, opened_at, opening_balance
    into v_session_id, v_opened_by, v_opened_by_name, v_opened_at, v_opening_balance
    from cash_sessions where register_id = p_register_id and status = 'OPEN' for update;

  if not found then
    raise exception 'NO_OPEN_SESSION: Aucune caisse ouverte trouvée';
  end if;

  -- Ventes COMPLETED de la session, DE CE TITULAIRE UNIQUEMENT (une vente
  -- annulée a été remboursée : la compter ferait apparaître un manquant au
  -- caissier pour une erreur qui n'est pas la sienne).
  select
    coalesce(sum(total) filter (where payment_method = 'CASH'), 0),
    coalesce(sum(paid_amount) filter (where payment_method = 'CREDIT'), 0),
    coalesce(sum(total), 0),
    count(*)
    into v_cash_sales_total, v_acompte_total, v_sales_total, v_sales_count
    from sales
    where tenant_id = p_tenant_id and store_id = p_store_id and status = 'COMPLETED'
      and created_at >= v_opened_at and cashier_id = v_opened_by;

  -- Règlements de dettes encaissés pendant la session PAR CE TITULAIRE : un
  -- client venu payer dépose de l'argent dans ce tiroir précis.
  select coalesce(sum(amount), 0) into v_credit_repayment_total
    from credit_payments
    where tenant_id = p_tenant_id and store_id = p_store_id and payment_method = 'CASH'
      and created_at >= v_opened_at and user_id = v_opened_by;

  -- Remboursements rendus en espèces PAR CE TITULAIRE : cet argent est
  -- SORTI de ce tiroir précis. cash_refund = part réellement sortie (le
  -- reste a effacé une dette).
  select coalesce(sum(cash_refund), 0) into v_cash_refund_total
    from sale_returns
    where tenant_id = p_tenant_id and store_id = p_store_id and refund_method = 'CASH'
      and created_at >= v_opened_at and processed_by = v_opened_by;

  -- MÊME formule que celle affichée au caissier pendant la session.
  v_expected_balance := coalesce(v_opening_balance, 0) + v_cash_sales_total + v_acompte_total + v_credit_repayment_total - v_cash_refund_total;
  v_difference := coalesce(p_counted_amount, 0) - v_expected_balance;

  update cash_sessions set
    status = 'CLOSED',
    closed_by = p_caller_id,
    closed_by_name = p_caller_name,
    closed_at = now(),
    closing_balance = p_counted_amount,
    expected_balance = v_expected_balance,
    cash_sales_total = v_cash_sales_total,
    acompte_total = v_acompte_total,
    credit_repayment_total = v_credit_repayment_total,
    cash_refund_total = v_cash_refund_total,
    difference = v_difference,
    sales_count = v_sales_count,
    sales_total = v_sales_total,
    notes = p_notes
    where id = v_session_id;

  return jsonb_build_object(
    'success', true, 'id', v_session_id, 'expectedBalance', v_expected_balance,
    'difference', v_difference, 'cashSalesTotal', v_cash_sales_total,
    'salesTotal', v_sales_total, 'txCount', v_sales_count
  );
end;
$$;

revoke execute on function close_cash_register(uuid, uuid, uuid, uuid, text, numeric, text) from anon, authenticated;
