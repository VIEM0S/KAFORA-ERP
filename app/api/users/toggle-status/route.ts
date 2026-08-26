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

    await supabase.from('users').update({ is_active: isActive }).eq('id', uid);

    // Contrairement à /api/users/delete (qui bannit réellement le compte
    // Supabase Auth), cette bascule ne touche que le profil applicatif — la
    // session existante reste valide jusqu'à sa prochaine resynchronisation
    // périodique (hooks/useAuth.ts, ~5 min), qui rejette alors la connexion
    // via le contrôle is_active de /api/auth/login (403 → déconnexion
    // côté client). Même caractéristique de délai qu'avec Firebase, où
    // revokeRefreshTokens forçait un nouveau sign-in qui échouait ensuite
    // sur ce même contrôle applicatif, l'auth Firebase elle-même restant
    // valide.

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Toggle user status error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
