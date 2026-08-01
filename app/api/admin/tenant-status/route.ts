import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';

/**
 * Active ou suspend une entreprise cliente.
 *
 * Suspendre bloque la connexion de TOUS ses utilisateurs (contrôle dans
 * /api/auth/login). C'est une mesure lourde : un commerce suspendu ne peut
 * plus encaisser. Elle est donc journalisée des deux côtés — chez l'éditeur
 * et chez le client — et exige un motif.
 *
 * Note : suspendre ne supprime rien. Les données restent intactes et
 * redeviennent accessibles dès la réactivation.
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

    const { tenantId, isActive, reason } = (await request.json()) as {
      tenantId?: string; isActive?: boolean; reason?: string;
    };

    if (!tenantId || typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }
    // Un motif est exigé pour suspendre : dans six mois, « pourquoi ce
    // commerce est-il bloqué ? » doit avoir une réponse écrite.
    if (!isActive && !reason?.trim()) {
      return NextResponse.json(
        { error: 'Indiquez le motif de la suspension' },
        { status: 400 }
      );
    }

    const tenantRef = adminDb.doc(`tenants/${tenantId}`);
    const snap = await tenantRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Entreprise introuvable' }, { status: 404 });
    }

    const batch = adminDb.batch();

    batch.update(tenantRef, {
      isActive,
      suspensionReason: isActive ? null : reason!.trim(),
      suspendedAt: isActive ? null : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Journal côté éditeur : l'historique de nos propres décisions.
    batch.set(adminDb.collection('_super_admin_logs').doc(), {
      action: isActive ? 'TENANT_ACTIVATED' : 'TENANT_SUSPENDED',
      tenantId,
      tenantName: snap.data()?.name || null,
      reason: reason?.trim() || null,
      performedBy: decoded.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Journal côté client : le commerçant doit pouvoir constater ce qui a été
    // fait sur son compte, et par qui. Une décision invisible est une
    // décision contestable.
    batch.set(adminDb.collection(`tenants/${tenantId}/audit_logs`).doc(), {
      userId: decoded.uid,
      action: isActive ? 'ACCOUNT_REACTIVATED' : 'ACCOUNT_SUSPENDED',
      entity: 'tenant',
      entityId: tenantId,
      details: reason?.trim() || null,
      createdAt: new Date().toISOString(),
    });

    await batch.commit();

    // Les sessions en cours restent valides jusqu'à leur expiration : on les
    // révoque pour que la suspension prenne effet tout de suite, et pas dans
    // sept jours.
    if (!isActive) {
      const users = await adminDb.collection(`tenants/${tenantId}/users`).get();
      await Promise.all(
        users.docs.map(d =>
          adminAuth.revokeRefreshTokens(d.id).catch(() => null)
        )
      );
    }

    return NextResponse.json({ success: true, isActive });
  } catch (error) {
    console.error('Admin tenant status error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
