import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

// Réservé au Propriétaire, comme la restauration (/api/users/restore) :
// c'est l'action la plus irréversible de tout le cycle de vie d'un compte,
// elle ne peut pas être moins protégée que son inverse.
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'OWNER') {
      return NextResponse.json({ error: 'Réservé au Propriétaire' }, { status: 403 });
    }
    const tenantId = session.tenantId as string;

    const { uid, confirmName } = await request.json();
    if (!uid || !confirmName) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (uid === session.uid) {
      return NextResponse.json({ error: 'Impossible de purger votre propre compte' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: existing } = await supabase
      .from('users')
      .select('role, first_name, last_name, is_active')
      .eq('id', uid)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: 'Compte introuvable (déjà purgé ?)' }, { status: 404 });
    }
    if (existing.role === 'OWNER') {
      return NextResponse.json({ error: 'Impossible de purger le Propriétaire' }, { status: 403 });
    }
    // La purge ne s'offre dans l'interface qu'aux comptes déjà désactivés —
    // un appel direct à l'API ne doit pas pouvoir court-circuiter cette
    // étape et effacer définitivement un compte encore actif.
    if (existing.is_active !== false) {
      return NextResponse.json(
        { error: 'Ce compte doit être désactivé avant de pouvoir être purgé' },
        { status: 409 }
      );
    }
    const targetName = `${existing.first_name || ''} ${existing.last_name || ''}`.trim();
    if (confirmName.trim().toLowerCase() !== targetName.toLowerCase()) {
      return NextResponse.json({ error: 'Le nom saisi ne correspond pas' }, { status: 400 });
    }

    await supabase.auth.admin.deleteUser(uid).catch((e: unknown) => {
      const code = (e as { code?: string })?.code;
      if (code !== 'user_not_found') throw e;
    });
    // L'historique des ventes/transactions (sales, credits...) référence
    // l'uid via une colonne, jamais par clé étrangère bloquante vers ce
    // profil : le supprimer ne touche à aucune donnée métier, conformément
    // à ce que le dialogue de confirmation annonce.
    await supabase.from('users').delete().eq('id', uid);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Purge user error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
