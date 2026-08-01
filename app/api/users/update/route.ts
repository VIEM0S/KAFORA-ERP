import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { writeAuditLog } from '@/lib/firebase/audit-log';
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

    const { tenantId, uid, email, firstName, lastName, phone, role, newPassword, workingHours, storeIds } = await request.json();
    if (!tenantId || !uid) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const userRef = adminDb.doc(`tenants/${tenantId}/users/${uid}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }
    const existing = userSnap.data() as { role?: string; storeIds?: string[] | null };

    // On ne modifie jamais le compte OWNER via cette route
    if (existing?.role === 'OWNER') {
      return NextResponse.json({ error: "Impossible de modifier le Propriétaire" }, { status: 403 });
    }
    if (role && !['ADMIN', 'MANAGER', 'CASHIER'].includes(role)) {
      return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 });
    }
    // Fix (demande explicite) : même logique qu'à la création — un Admin ne
    // doit pas pouvoir promouvoir quelqu'un (ni lui-même en théorie, déjà
    // bloqué ailleurs) au rang d'Admin, ni modifier un compte Admin existant
    // (y compris son propre rôle, déjà interdit par ailleurs). Seul le
    // Propriétaire accorde ou retire le niveau Admin.
    if (callerRole !== 'OWNER') {
      if (role === 'ADMIN') {
        return NextResponse.json({ error: 'Seul le Propriétaire peut promouvoir un compte au rang d\'Administrateur' }, { status: 403 });
      }
      if (existing?.role === 'ADMIN') {
        return NextResponse.json({ error: 'Seul le Propriétaire peut modifier un compte Administrateur' }, { status: 403 });
      }
    }
    if (newPassword && newPassword.length < 6) {
      return NextResponse.json({ error: 'Mot de passe : 6 caractères minimum' }, { status: 400 });
    }

    // 1. Mettre à jour Firebase Auth (email, mot de passe, nom affiché)
    // ─── Affectation aux magasins ────────────────────────────────────────────
    // Rôle final après cette mise à jour (le rôle peut changer ici même).
    const finalRole = role || existing?.role;
    let claimStoreIds: string[] | null = existing?.storeIds ?? null;

    if (storeIds !== undefined) {
      if (finalRole === 'ADMIN') {
        claimStoreIds = null; // direction : tous les magasins
      } else {
        if (!Array.isArray(storeIds) || storeIds.length === 0) {
          return NextResponse.json(
            { error: 'Sélectionnez au moins un magasin pour cet utilisateur.' },
            { status: 400 }
          );
        }
        const unique = [...new Set(storeIds.filter((v: unknown) => typeof v === 'string' && v))];
        const checks = await Promise.all(
          unique.map(id => adminDb.doc(`tenants/${tenantId}/stores/${id}`).get())
        );
        if (checks.some(snap => !snap.exists)) {
          return NextResponse.json({ error: 'Magasin inconnu' }, { status: 400 });
        }
        claimStoreIds = unique as string[];
      }
    } else if (finalRole === 'ADMIN') {
      // Promotion vers ADMIN sans préciser les magasins : accès global.
      claimStoreIds = null;
    }

    const authUpdate: { email?: string; password?: string; displayName?: string } = {};
    if (email) authUpdate.email = email;
    if (newPassword) authUpdate.password = newPassword;
    if (firstName || lastName) {
      authUpdate.displayName = `${firstName ?? ''} ${lastName ?? ''}`.trim();
    }
    if (Object.keys(authUpdate).length > 0) {
      try {
        await adminAuth.updateUser(uid, authUpdate);
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code === 'auth/email-already-exists') {
          return NextResponse.json({ error: 'Cet email est déjà utilisé' }, { status: 409 });
        }
        throw e;
      }
    }

    // 2. Reposer les custom claims si le rôle OU l'affectation magasin change.
    //    Sans le second cas, retirer un magasin à un caissier resterait sans
    //    effet sur son token — donc sans effet réel sur ses accès.
    const roleChanged = Boolean(role && role !== existing?.role);
    const storesChanged =
      JSON.stringify(claimStoreIds) !== JSON.stringify(existing?.storeIds ?? null);
    if (roleChanged || storesChanged) {
      await adminAuth.setCustomUserClaims(uid, {
        tenantId, role: finalRole, storeIds: claimStoreIds,
      });
    }
    if (roleChanged) {
      await writeAuditLog({
        tenantId, userId: decoded.uid, action: 'ROLE_CHANGED',
        entity: 'users', entityId: uid,
        details: `${existing?.role || '?'} → ${role}`,
      });
    }

    // 3. Mettre à jour le profil Firestore
    const firestoreUpdate: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (firstName) firestoreUpdate.firstName = firstName;
    if (lastName) firestoreUpdate.lastName = lastName;
    if (email) firestoreUpdate.email = email;
    if (phone !== undefined) firestoreUpdate.phone = phone || null;
    if (role) firestoreUpdate.role = role;
    if (workingHours !== undefined) firestoreUpdate.workingHours = workingHours;
    // Le profil doit refléter les claims : c'est lui que relit la route de
    // connexion pour resynchroniser le token à chaque session.
    if (storesChanged) firestoreUpdate.storeIds = claimStoreIds;

    await userRef.update(firestoreUpdate);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
