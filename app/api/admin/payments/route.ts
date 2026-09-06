import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

/**
 * Console éditeur : tous les paiements enregistrés, tous tenants
 * confondus, filtrables — le vrai encaissé (subscription_payments),
 * distinct de la projection au tarif catalogue affichée sur /api/admin/
 * tenants. Demandé explicitement en complément du "Journal" par client
 * (qui reste la narration contextuelle ; ceci est la vue comptable).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId');
    const plan = url.searchParams.get('plan');
    const method = url.searchParams.get('method');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');

    const admin = createServiceRoleClient();
    let query = admin
      .from('subscription_payments')
      .select('id, tenant_id, months, plan, amount, method, note, period_start, period_end, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    if (plan) query = query.eq('plan', plan as 'STARTER' | 'BUSINESS' | 'ENTERPRISE');
    if (method) query = query.ilike('method', `%${method}%`);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);

    const { data: payments, error } = await query;
    if (error) throw error;

    const tenantIds = Array.from(new Set((payments ?? []).map(p => p.tenant_id)));
    const { data: tenants } = await admin.from('tenants').select('id, name')
      .in('id', tenantIds.length > 0 ? tenantIds : ['00000000-0000-0000-0000-000000000000']);
    const nameById = new Map((tenants ?? []).map(t => [t.id, t.name]));

    const rows = (payments ?? []).map(p => ({
      id: p.id,
      tenantId: p.tenant_id,
      tenantName: nameById.get(p.tenant_id) || 'Entreprise inconnue',
      months: p.months,
      plan: p.plan,
      amount: p.amount,
      method: p.method,
      note: p.note,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      createdAt: p.created_at,
    }));

    const total = rows.reduce((a, p) => a + (Number(p.amount) || 0), 0);

    return NextResponse.json({ payments: rows, total });
  } catch (error) {
    console.error('Admin payments error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
