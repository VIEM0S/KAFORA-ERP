import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    // Restaurer un compte annule une décision de suppression déjà validée —
    // réservé au Propriétaire, cohérent avec le reste du workflow.
    if (session.role !== 'OWNER') {
      return NextResponse.json({ error: 'Réservé au Propriétaire' }, { status: 403 });
    }
    const tenantId = session.tenantId as string;

    const { uid } = await request.json();
    if (!uid) return NextResponse.json({ error: 'Champ manquant' }, { status: 400 });

    const supabase = createServiceRoleClient();
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('id', uid)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 });
    }

    await supabase.auth.admin.updateUserById(uid, { ban_duration: 'none' });
    await supabase
      .from('users')
      .update({
        is_active: true,
        deleted_at: null,
        deleted_by: null,
        restored_at: new Date().toISOString(),
        restored_by: session.uid,
      })
      .eq('id', uid);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Restore user error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
