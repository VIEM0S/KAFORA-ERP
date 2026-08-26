-- Le REVOKE precedent ciblait anon/authenticated, mais Postgres accorde
-- EXECUTE a PUBLIC par defaut a la creation d'une fonction — et PUBLIC
-- s'applique a TOUT role, y compris anon/authenticated qui en heritent.
-- Sans ce fix, register_tenant() etait appelable directement via
-- /rest/v1/rpc/register_tenant par n'importe qui, avec un p_owner_user_id
-- arbitraire (usurpation potentielle) ; check_rate_limit() etait manipulable
-- par n'importe qui (pollution/reset du throttling).
revoke execute on function check_rate_limit(text, int, int) from public;
revoke execute on function register_tenant(
  uuid, text, text, text, text, text, text, text, text, text, text, text, uuid, jsonb,
  subscription_plan, jsonb, timestamptz, text, text, text, text, text, text, text, text, text
) from public;
