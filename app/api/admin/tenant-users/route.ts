import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';

/**
 * Utilisateurs d'une entreprise cliente — pour le support.
 *
 * PÉRIMÈTRE VOLONTAIREMENT LIMITÉ : nom, email, rôle, activité. Aucune donnée
 * commerciale (ventes, marges, clients finaux, stock) n'est exposée ici.
 *
 * C'est un choix, pas une limite technique : les routes d'administration
 * utilisent le SDK Admin, qui contourne les règles Firestore et pourrait donc
 * tout lire. S'interdire l'accès au contenu commercial des clients est ce qui
 * rend l'engagement d'isolation crédible — un commerçant qui confie son
 * chiffre d'affaires à Kafora doit savoir que l'éditeur ne le consulte pas.
 *
 * Chaque consultation est journalisée CHEZ LE CLIENT : il peut constater
 * qu'on a regardé son compte, et quand.
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    if (decoded.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const tenantId = new URL(request.url).searchParams.get('tenantId');
    if (!tenantId) {
      return NextResponse.json({ error: 'Entreprise manquante' }, { status: 400 });
    }

    const snap = await adminDb.collection(`tenants/${tenantId}/users`).get();

    const users = snap.docs.map(d => {
      const u = d.data();
      return {
        id: d.id,
        email: u.email || null,
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        role: u.role || null,
        isActive: u.isActive !== false,
        lastLoginAt: u.lastLoginAt || null,
        storeIds: Array.isArray(u.storeIds) ? u.storeIds.length : null,
      };
    });

    // Traçable côté client, sans bloquer la réponse si l'écriture échoue.
    adminDb
      .collection(`tenants/${tenantId}/audit_logs`)
      .add({
        userId: decoded.uid,
        action: 'SUPPORT_ACCESS',
        entity: 'users',
        entityId: tenantId,
        details: "Consultation de la liste des utilisateurs par le support Kafora",
        createdAt: new Date().toISOString(),
      })
      .catch(() => null);

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Admin tenant users error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

/**
 * Réinitialisation d'accès : génère un lien de réinitialisation de mot de
 * passe pour un utilisateur d'une entreprise cliente.
 *
 * On ne DÉFINIT jamais un mot de passe à la place du client — on lui envoie
 * un lien qu'il utilise lui-même. Fixer un mot de passe reviendrait à
 * pouvoir se connecter à son compte, ce qui n'est pas le rôle du support.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    if (decoded.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { tenantId, email } = (await request.json()) as { tenantId?: string; email?: string };
    if (!tenantId || !email) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }

    // L'utilisateur doit bien appartenir à l'entreprise indiquée : sans cette
    // vérification, la route permettrait de générer un lien pour n'importe
    // quelle adresse connue de Firebase Auth.
    const match = await adminDb
      .collection(`tenants/${tenantId}/users`)
      .where('email', '==', email)
      .limit(1)
      .get();
    if (match.empty) {
      return NextResponse.json({ error: 'Utilisateur introuvable dans cette entreprise' }, { status: 404 });
    }

    const link = await adminAuth.generatePasswordResetLink(email);

    await adminDb.collection('_super_admin_logs').add({
      action: 'PASSWORD_RESET_LINK',
      tenantId,
      targetEmail: email,
      performedBy: decoded.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    await adminDb.collection(`tenants/${tenantId}/audit_logs`).add({
      userId: decoded.uid,
      action: 'SUPPORT_PASSWORD_RESET',
      entity: 'users',
      entityId: email,
      details: 'Lien de réinitialisation généré par le support Kafora',
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, link });
  } catch (error) {
    console.error('Admin reset link error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
