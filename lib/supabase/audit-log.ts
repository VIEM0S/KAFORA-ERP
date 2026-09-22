import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Kafora a DEUX tables d'audit, pas une seule doublon de l'autre :
 *  - `audit_logs` (celle-ci, migration 005) : générique, alimente aujourd'hui
 *    surtout la console éditeur (super-admin) — LOGIN, PASSWORD_RESET_LINK...
 *  - `audit_log` (migration 045) : piste de gouvernance du TENANT lui-même,
 *    lue par sa propre page /audit-log (Owner/Admin). Longtemps limitée aux
 *    crédits/dépenses/prix ; étendue ici (2026-09-22, en comparant à
 *    MANDE-SOLAIRE-DEYE-ERP qui journalise depuis l'origine la quasi-totalité
 *    des actions sensibles) aux changements de rôle, à la désactivation/
 *    suppression/restauration d'un compte et à l'annulation d'une vente —
 *    jusque-là, ces actions étaient soit invisibles pour le tenant, soit pas
 *    journalisées du tout (constaté en lisant toggle-status/delete/restore :
 *    aucun des trois n'écrivait la moindre trace, malgré le bannissement Auth
 *    posé en 2026-09-21). writeAuditLog() ci-dessous reste inchangé, utilisé
 *    en parallèle pour ne rien retirer à la console éditeur.
 */
export async function writeGovernanceLog(params: {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  storeId?: string | null;
  details?: Record<string, unknown>;
}) {
  try {
    const supabase = createServiceRoleClient();
    await supabase.from('audit_log').insert({
      tenant_id: params.tenantId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      actor_id: params.actorId,
      actor_name: params.actorName || null,
      actor_role: params.actorRole as Database['public']['Enums']['user_role'],
      store_id: params.storeId ?? null,
      details: (params.details ?? {}) as Database['public']['Tables']['audit_log']['Insert']['details'],
    });
  } catch (e) {
    // Comme writeAuditLog : un échec de journalisation ne doit jamais faire
    // échouer l'action métier elle-même, déjà réussie à ce stade.
    console.error('writeGovernanceLog error:', e);
  }
}

/** Nom d'affichage de l'acteur (session.uid), pour les entrées de governance log. */
export async function getActorName(userId: string): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.from('users').select('first_name, last_name').eq('id', userId).maybeSingle();
  return data ? `${data.first_name || ''} ${data.last_name || ''}`.trim() : '';
}

export type AuditAction =
  | 'LOGIN'
  | 'ROLE_CHANGED'
  | 'USER_DEACTIVATED'
  | 'USER_RESTORED'
  | 'USER_PURGED'
  | 'SALE_CANCELLED'
  | 'DELETION_REQUEST_CREATED'
  | 'DELETION_REQUEST_APPROVED'
  | 'DELETION_REQUEST_REJECTED';

/**
 * Journal d'audit — trace qui a fait quoi sur les actions sensibles.
 */
export async function writeAuditLog(params: {
  tenantId: string;
  userId: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  details?: string;
}) {
  try {
    const supabase = createServiceRoleClient();
    await supabase.from('audit_logs').insert({
      tenant_id: params.tenantId,
      user_id: params.userId,
      action: params.action,
      entity: params.entity,
      entity_id: params.entityId,
      details: params.details || null,
    });
  } catch (e) {
    // Un échec du journal d'audit ne doit jamais faire échouer l'action
    // métier elle-même — juste le signaler.
    console.error('writeAuditLog error:', e);
  }
}
