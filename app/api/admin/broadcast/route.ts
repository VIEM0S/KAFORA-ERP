import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyRole } from '@/lib/api/notify-role';
import type { PlanId } from '@/lib/constants';

/**
 * Message groupé aux clients — réservé SUPER_ADMIN. Filtrable par forfait
 * ou envoyé à toutes les entreprises actives. Réutilise notifyRole (donc
 * la même alerte in-app ciblée + email) plutôt qu'un nouveau canal.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { title, message, plan } = (await request.json()) as {
      title?: string; message?: string; plan?: PlanId | 'ALL';
    };
    if (!title?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Titre et message requis' }, { status: 400 });
    }

    const admin = createServiceRoleClient();

    // Même approche que /api/admin/tenants (requêtes séparées jointes en
    // JS) plutôt qu'un embed PostgREST, pour rester cohérent avec le
    // reste de la console.
    const { data: activeTenants, error: tenantsError } = await admin
      .from('tenants').select('id').eq('is_active', true);
    if (tenantsError) throw tenantsError;
    const tenantIds = (activeTenants ?? []).map(t => t.id);

    let targets: { id: string }[] = activeTenants ?? [];
    if (plan && plan !== 'ALL' && tenantIds.length > 0) {
      const { data: subs, error: subsError } = await admin
        .from('subscriptions').select('tenant_id').eq('plan', plan).in('tenant_id', tenantIds);
      if (subsError) throw subsError;
      const matching = new Set((subs ?? []).map(s => s.tenant_id));
      targets = targets.filter(t => matching.has(t.id));
    }
    // Best-effort et en parallèle : un échec d'envoi à UN client ne doit
    // jamais empêcher les autres de recevoir l'annonce.
    const results = await Promise.allSettled(
      targets.map(t => notifyRole(t.id, 'OWNER', {
        type: 'KAFORA_ANNOUNCEMENT', severity: 'MEDIUM',
        title: title.trim(), message: message.trim(),
      }))
    );
    const failures = results.filter(r => r.status === 'rejected').length;

    await admin.from('super_admin_logs').insert({
      action: 'BROADCAST_SENT',
      tenant_id: null,
      target_email: `${targets.length} entreprise(s)${plan && plan !== 'ALL' ? ` (forfait ${plan})` : ' (toutes)'}`,
      reason: `${title.trim()} — ${message.trim()}`,
      performed_by: session.uid,
    });

    return NextResponse.json({ success: true, sentTo: targets.length, failures });
  } catch (error) {
    console.error('Admin broadcast error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
