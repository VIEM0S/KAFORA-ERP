import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { cookies } from 'next/headers';

// Trouvé en direct : le bouton "Purger définitivement" (users-table.tsx)
// existait déjà, entièrement câblé côté client (confirmation par saisie du
// nom, désactivation du bouton, toast d'erreur) — mais appelait une route
// qui n'a jamais été créée (404 constaté en production). Cette route
// termine ce qui avait été commencé côté client.
//
// Réservé au Propriétaire, comme la restauration (/api/users/restore) :
// c'est l'action la plus irréversible de tout le cycle de vie d'un compte,
// elle ne peut pas être moins protégée que son inverse.
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    if (decoded.role !== 'OWNER') {
      return NextResponse.json({ error: 'Réservé au Propriétaire' }, { status: 403 });
    }
    const tenantId = decoded.tenantId as string;

    const { uid, confirmName } = await request.json();
    if (!uid || !confirmName) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (uid === decoded.uid) {
      return NextResponse.json({ error: 'Impossible de purger votre propre compte' }, { status: 400 });
    }

    const userRef = adminDb.doc(`tenants/${tenantId}/users/${uid}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Compte introuvable (déjà purgé ?)' }, { status: 404 });
    }
    const existing = userSnap.data() as {
      role?: string; firstName?: string; lastName?: string; isActive?: boolean;
    };
    if (existing.role === 'OWNER') {
      return NextResponse.json({ error: 'Impossible de purger le Propriétaire' }, { status: 403 });
    }
    // La purge ne s'offre dans l'interface qu'aux comptes déjà désactivés
    // (voir users-table.tsx) : un appel direct à l'API ne doit pas pouvoir
    // court-circuiter cette étape et effacer définitivement un compte encore
    // actif sans être passé par la désactivation d'abord.
    if (existing.isActive !== false) {
      return NextResponse.json(
        { error: 'Ce compte doit être désactivé avant de pouvoir être purgé' },
        { status: 409 }
      );
    }
    // Revalidé ici, jamais seulement sur le bouton désactivé côté client.
    const targetName = `${existing.firstName || ''} ${existing.lastName || ''}`.trim();
    if (confirmName.trim().toLowerCase() !== targetName.toLowerCase()) {
      return NextResponse.json({ error: 'Le nom saisi ne correspond pas' }, { status: 400 });
    }

    try {
      await adminAuth.deleteUser(uid);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/user-not-found') throw e;
    }
    // L'historique des ventes/transactions (sales, credits...) référence
    // l'uid mais vit dans ses propres collections, jamais imbriqué sous ce
    // profil : le supprimer ne touche à aucune donnée métier, conformément
    // à ce que le dialogue de confirmation annonce.
    await userRef.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Purge user error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
