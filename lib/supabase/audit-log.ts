import { createServiceRoleClient } from '@/lib/supabase/server';

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
