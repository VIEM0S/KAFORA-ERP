import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface SessionClaims {
  uid: string;
  tenantId: string | null;
  role: string;
  storeIds: string[] | null;
}

/**
 * Résout la session courante à partir des cookies — remplace le motif
 * répété `cookies().get('__session')` + `adminAuth.verifySessionCookie()`
 * qui ouvrait chaque route users/*. getUser() vérifie cryptographiquement
 * la session auprès de Supabase Auth (voir lib/supabase/server.ts).
 */
export async function getSessionClaims(): Promise<SessionClaims | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const meta = (data.user.app_metadata ?? {}) as {
    tenant_id?: string | null; role?: string; store_ids?: string[] | null;
  };
  if (!meta.role) return null;

  return {
    uid: data.user.id,
    tenantId: meta.tenant_id ?? null,
    role: meta.role,
    storeIds: meta.store_ids ?? null,
  };
}
