import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

/**
 * "Journal Kafora" d'un client : toutes les actions prises côté éditeur
 * sur son compte (suspension/réactivation, paiements enregistrés,
 * réponses de support, liens de réinitialisation générés) — le suivi
 * demandé explicitement, jusqu'ici éparpillé dans super_admin_logs et
 * subscription_payments sans aucun écran pour les consulter.
 *
 * Ne montre QUE les actions de Kafora sur ce compte, jamais les données
 * commerciales du client (voir le même principe déjà appliqué à
 * /api/admin/tenant-users).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const tenantId = new URL(request.url).searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Entreprise manquante' }, { status: 400 });

    const admin = createServiceRoleClient();
    const [{ data: logs, error: logsError }, { data: payments, error: paymentsError }] = await Promise.all([
      admin.from('super_admin_logs').select('action, reason, target_email, created_at').eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }).limit(100),
      admin.from('subscription_payments').select('months, plan, amount, method, note, created_at').eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }).limit(100),
    ]);
    if (logsError) throw logsError;
    if (paymentsError) throw paymentsError;

    const events = [
      ...(logs ?? []).map(l => ({
        kind: 'LOG' as const, action: l.action, detail: l.reason || l.target_email || null, createdAt: l.created_at,
      })),
      ...(payments ?? []).map(p => ({
        kind: 'PAYMENT' as const, action: 'PAYMENT_RECORDED',
        detail: `${p.amount} FCFA — ${p.months} mois (${p.plan})${p.method ? `, ${p.method}` : ''}${p.note ? ` — ${p.note}` : ''}`,
        createdAt: p.created_at,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Admin tenant-history error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
