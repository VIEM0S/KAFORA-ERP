import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail, escapeHtml } from '@/lib/email/send';
import type { Database } from '@/lib/supabase/database.types';

type AlertType = Database['public']['Enums']['alert_type'];
type AlertSeverity = Database['public']['Enums']['alert_severity'];
type UserRole = Database['public']['Enums']['user_role'];

/**
 * Notifie tous les membres actifs d'un ROLE donné (ex. tous les OWNER/ADMIN) :
 * une alerte in-app (visible sur /notifications, filtrée côté client par
 * target_role) + un email best-effort à chacun.
 */
export async function notifyRole(
  tenantId: string,
  targetRole: 'OWNER' | 'ADMIN',
  alert: { type: AlertType; severity: AlertSeverity; title: string; message: string; referenceId?: string }
) {
  const supabase = createServiceRoleClient();

  await supabase.from('alerts').insert({
    tenant_id: tenantId,
    type: alert.type,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    reference: 'users',
    reference_id: alert.referenceId || null,
    target_role: targetRole as UserRole,
  });

  // Best-effort : une erreur ici (SendGrid non configuré...) ne doit jamais
  // faire échouer l'action métier elle-même, l'alerte in-app a déjà réussi.
  try {
    const { data: users } = await supabase
      .from('users')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('role', targetRole)
      .eq('is_active', true);
    const results = await Promise.all(
      (users ?? []).map((u) =>
        u.email
          ? sendEmail({ to: u.email, subject: alert.title, html: `<p>${escapeHtml(alert.message)}</p>` })
          : Promise.resolve({ sent: false, error: "Pas d'email sur ce compte" })
      )
    );
    results.forEach((r) => { if (!r.sent) console.error('Notification email non envoyée :', r.error); });
  } catch (e) {
    console.error("notifyRole: échec de l'envoi email (notification in-app déjà créée) :", e);
  }
}

/** Notifie un utilisateur précis (ex. l'Admin qui a fait une demande de suppression). */
export async function notifyUser(tenantId: string, userId: string, title: string, message: string) {
  const supabase = createServiceRoleClient();

  await supabase.from('alerts').insert({
    tenant_id: tenantId,
    type: 'USER_DELETION_RESOLVED',
    severity: 'MEDIUM',
    title, message,
    reference: 'users',
    target_user_id: userId,
  });

  try {
    const { data: target } = await supabase.from('users').select('email').eq('id', userId).maybeSingle();
    if (target?.email) {
      const result = await sendEmail({ to: target.email, subject: title, html: `<p>${escapeHtml(message)}</p>` });
      if (!result.sent) console.error('Notification email non envoyée :', result.error);
    }
  } catch (e) {
    console.error("notifyUser: échec de l'envoi email (notification in-app déjà créée) :", e);
  }
}
