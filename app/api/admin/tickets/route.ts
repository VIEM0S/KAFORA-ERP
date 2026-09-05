import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

/**
 * Console éditeur : liste tous les signalements clients (tous tenants
 * confondus), triés par statut (ouverts d'abord) puis date. Réservée au
 * rôle SUPER_ADMIN — même garde que /api/admin/tenants.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const admin = createServiceRoleClient();
    const [{ data: tickets, error: ticketsError }, { data: tenants }] = await Promise.all([
      admin
        .from('support_tickets')
        .select('id, tenant_id, user_name, user_email, user_role, type, message, page_url, status, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(200),
      admin.from('tenants').select('id, name'),
    ]);
    if (ticketsError) throw ticketsError;

    const tenantNameById = new Map((tenants ?? []).map(t => [t.id, t.name]));
    const rows = (tickets ?? []).map(t => ({
      id: t.id,
      tenantId: t.tenant_id,
      tenantName: tenantNameById.get(t.tenant_id) || 'Entreprise inconnue',
      userName: t.user_name,
      userEmail: t.user_email,
      userRole: t.user_role,
      type: t.type,
      message: t.message,
      pageUrl: t.page_url,
      status: t.status,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }));

    return NextResponse.json({ tickets: rows });
  } catch (error) {
    console.error('Admin tickets list error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
