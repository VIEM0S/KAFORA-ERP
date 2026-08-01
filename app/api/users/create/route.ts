import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { checkPlanLimit } from '@/lib/firebase/plan-limits';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    // Vérifier session
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    const callerRole = decoded.role as string;
    const callerTenantId = decoded.tenantId as string;
    if (!['OWNER', 'ADMIN'].includes(callerRole)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const { tenantId, email, password, firstName, lastName, phone, role, storeIds } = await request.json();
    if (!email || !password || !firstName || !lastName || !role || !tenantId) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    // Isolation multi-tenant : un ADMIN/OWNER ne peut créer un utilisateur que
    // dans son propre tenant, jamais dans un tenant tiers (cf. update/delete/toggle-status).
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    if (!['ADMIN', 'MANAGER', 'CASHIER'].includes(role)) {
      return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 });
    }

    // ─── Affectation aux magasins ────────────────────────────────────────────
    // ADMIN = fonction de direction : accès à tous les magasins (null).
    // MANAGER / CASHIER = personnel de terrain : affectation explicite exigée.
    //
    // On refuse le défaut permissif pour ces deux rôles. Créer un caissier
    // sans préciser son magasin lui donnerait accès au stock, aux ventes et à
    // la caisse de TOUTES les boutiques — c'est précisément le trou que cette
    // affectation vient combler, il ne faut pas pouvoir le rouvrir par oubli.
    let normalizedStoreIds: string[] | null = null;
    if (role !== 'ADMIN') {
      if (!Array.isArray(storeIds) || storeIds.length === 0) {
        return NextResponse.json(
          { error: 'Sélectionnez au moins un magasin pour cet utilisateur.' },
          { status: 400 }
        );
      }
      const unique = [...new Set(storeIds.filter((s: unknown) => typeof s === 'string' && s))];
      // Les magasins doivent exister ET appartenir au tenant de l'appelant :
      // sans cette vérification, un identifiant forgé donnerait un accès
      // à un magasin d'un autre client.
      const checks = await Promise.all(
        unique.map(id => adminDb.doc(`tenants/${tenantId}/stores/${id}`).get())
      );
      if (checks.some(snap => !snap.exists)) {
        return NextResponse.json({ error: 'Magasin inconnu' }, { status: 400 });
      }
      normalizedStoreIds = unique as string[];
    }
    // Fix (demande explicite) : un Admin ne doit pas pouvoir créer un autre
    // Admin sans contrôle — ça lui permettrait de se fabriquer un compte
    // "allié" pour contourner la supervision du Propriétaire. Créer un
    // compte Admin reste réservé au Propriétaire ; l'Admin garde la main sur
    // Manager/Caissier.
    if (role === 'ADMIN' && callerRole !== 'OWNER') {
      return NextResponse.json({ error: 'Seul le Propriétaire peut créer un compte Administrateur' }, { status: 403 });
    }

    // Limite du forfait (fix : les forfaits n'étaient jamais vérifiés nulle part)
    const limitCheck = await checkPlanLimit(tenantId, 'maxUsers');
    if (!limitCheck.allowed) {
      return NextResponse.json({ error: limitCheck.reason }, { status: 403 });
    }

    // Créer dans Firebase Auth
    let firebaseUser;
    try {
      firebaseUser = await adminAuth.createUser({
        email, password,
        displayName: `${firstName} ${lastName}`.trim(),
      });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/email-already-exists') {
        return NextResponse.json({ error: 'Cet email est déjà utilisé' }, { status: 409 });
      }
      throw e;
    }

    const uid = firebaseUser.uid;
    const now = new Date().toISOString();

    // Créer le profil Firestore
    await adminDb.collection(`tenants/${tenantId}/users`).doc(uid).set({
      uid, tenantId, email,
      firstName, lastName,
      phone: phone || null,
      avatar: null, role,
      // null = accès à tous les magasins (direction) ; tableau = accès limité.
      // Un CASHIER sans magasin explicite verrait tout : on refuse ce défaut
      // permissif pour les rôles opérationnels (voir plus bas la validation).
      storeIds: normalizedStoreIds,
      isActive: true,
      emailVerified: false,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: now, updatedAt: now,
    });

    // Injecter les custom claims
    // storeIds va dans le token : c'est ainsi que firestore.rules peut
    // vérifier l'accès magasin sans lire le profil à chaque requête.
    await adminAuth.setCustomUserClaims(uid, { tenantId, role, storeIds: normalizedStoreIds });

    return NextResponse.json({ success: true, uid });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
