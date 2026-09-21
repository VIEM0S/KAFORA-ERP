import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!['OWNER', 'ADMIN'].includes(session.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const { tenantId, uid, isActive } = await request.json();
    if (!tenantId || !uid || typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    if (uid === session.uid) {
      return NextResponse.json({ error: 'Impossible de modifier votre propre statut' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: existing } = await supabase
      .from('users')
      .select('role')
      .eq('id', uid)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }
    if (existing.role === 'OWNER') {
      return NextResponse.json({ error: 'Impossible de modifier le Propriétaire' }, { status: 403 });
    }
    // Même règle que /api/users/delete : un Administrateur ne touche pas à un
    // autre Administrateur, seul le Propriétaire le peut — sinon deux ADMIN
    // pouvaient se désactiver mutuellement sans aucun recours.
    if (existing.role === 'ADMIN' && session.role !== 'OWNER') {
      return NextResponse.json({ error: 'Seul le Propriétaire peut modifier le statut d\'un Administrateur' }, { status: 403 });
    }

    // Bannissement Auth AVANT le drapeau applicatif, comme /api/users/delete :
    // proxy.ts appelle getUser() à chaque requête, qui rejette un compte banni
    // immédiatement, et le refresh token ne peut plus émettre de nouveau jeton.
    // Sans ça, is_active=false seul laissait la session (et le refresh token)
    // pleinement valides — constaté empiriquement : lecture, écriture et
    // renouvellement du jeton restaient possibles après désactivation.
    // Si le bannissement échoue on s'arrête, pour ne jamais afficher
    // "désactivé" alors que le compte garde son accès.
    const { error: banError } = await supabase.auth.admin.updateUserById(uid, {
      ban_duration: isActive ? 'none' : '876000h', // ~100 ans = désactivé
    });
    if (banError) {
      console.error('Toggle user status ban error:', banError);
      return NextResponse.json({ error: 'Impossible de modifier l\'accès du compte' }, { status: 500 });
    }

    await supabase.from('users').update({ is_active: isActive }).eq('id', uid);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Toggle user status error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
