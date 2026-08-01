import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';

export async function POST(request: NextRequest) {
  try {
    // 15 tentatives / 5 minutes / IP : suffisant pour un usage légitime
    // (y compris un oubli de mot de passe suivi de plusieurs essais), assez
    // bas pour freiner un bruteforce basique. Ajustable si trop strict.
    const rateLimit = await checkRateLimit(`login:${getClientIp(request)}`, 15, 5 * 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    const { idToken } = await request.json();

    if (!idToken) {
      return NextResponse.json({ error: 'Token manquant' }, { status: 400 });
    }

    // Vérifier le token Firebase Auth côté serveur
    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch (e: unknown) {
      console.error('❌ verifyIdToken error:', e);
      return NextResponse.json({ error: 'Token Firebase invalide: ' + (e instanceof Error ? e.message : String(e)) }, { status: 401 });
    }

    const uid = decoded.uid;

    // Récupérer le profil utilisateur dans Firestore
    let userSnap;
    try {
      userSnap = await adminDb
        .collectionGroup('users')
        .where('uid', '==', uid)
        .limit(1)
        .get();
    } catch (e: unknown) {
      console.error('❌ Firestore collectionGroup error:', e);
      return NextResponse.json({ error: 'Erreur Firestore: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
    }

    // ─── Compte éditeur (SUPER_ADMIN) ────────────────────────────────────────
    //
    // Un super-admin n'appartient à AUCUN tenant : il administre Kafora, il
    // n'en est pas client. Son profil vit donc dans `_super_admin/{uid}`, en
    // dehors de l'arborescence des clients.
    //
    // Cette séparation n'est pas cosmétique : tant que le compte éditeur était
    // aussi un tenant, il apparaissait dans sa propre liste de clients — avec
    // le risque, une fois la liste longue, d'enregistrer un paiement ou de
    // modifier un abonnement sur un vrai client en croyant être chez soi.
    if (userSnap.empty) {
      const saSnap = await adminDb.doc(`_super_admin/${uid}`).get();
      if (saSnap.exists && saSnap.data()?.isActive !== false) {
        const sa = saSnap.data() || {};

        // tenantId explicitement null : aucune donnée client ne lui est
        // rattachée, et les règles Firestore ne lui ouvrent aucun tenant.
        // Sa seule porte d'entrée est /api/admin/*, qui vérifie le rôle.
        const claimsChanged = decoded.role !== 'SUPER_ADMIN' || decoded.tenantId != null;
        if (claimsChanged) {
          await adminAuth.setCustomUserClaims(uid, {
            tenantId: null,
            role: 'SUPER_ADMIN',
            storeIds: null,
          });
        }

        const saCookie = await adminAuth.createSessionCookie(idToken, {
          expiresIn: 7 * 24 * 60 * 60 * 1000,
        });

        const saResponse = NextResponse.json({
          user: {
            id: uid,
            uid,
            email: sa.email || decoded.email || '',
            firstName: sa.firstName || 'Administration',
            lastName: sa.lastName || 'Kafora',
            role: 'SUPER_ADMIN',
            tenantId: null,
            isActive: true,
          },
          tenant: null,
          stores: [],
          claimsUpdated: claimsChanged,
        });

        saResponse.cookies.set('__session', saCookie, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60,
          path: '/',
        });
        return saResponse;
      }

      return NextResponse.json({ error: 'Profil utilisateur introuvable' }, { status: 404 });
    }

    const userDoc = userSnap.docs[0];
    const userData = userDoc.data();

    if (!userData.isActive) {
      return NextResponse.json({ error: 'Compte désactivé' }, { status: 403 });
    }

    const tenantId = userData.tenantId;

    // Récupérer le tenant
    const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 });
    }
    // Entreprise suspendue par l'éditeur : aucun de ses utilisateurs ne peut
    // se connecter. Sans ce contrôle, `isActive` sur le tenant ne serait
    // qu'un champ décoratif — désactiver un compte ne changerait rien.
    // Le message reste factuel et sans reproche : c'est souvent le
    // commerçant qui appellera pour comprendre, pas un fraudeur.
    if (tenantSnap.data()?.isActive === false) {
      return NextResponse.json(
        { error: "L'accès à votre espace Kafora est suspendu. Contactez votre fournisseur." },
        { status: 403 }
      );
    }

    const tenantData = { id: tenantSnap.id, ...tenantSnap.data() };

    // Récupérer les magasins du tenant
    const storesSnap = await adminDb
      .collection(`tenants/${tenantId}/stores`)
      .where('isActive', '==', true)
      .get();
    const allStores = storesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Cloisonnement : on ne renvoie que les magasins auxquels cet utilisateur
    // a accès. Filtré ICI, côté serveur — l'interface ne doit jamais proposer
    // un magasin dont les données lui seront de toute façon refusées par les
    // règles Firestore. `storeIds` absent ou null = accès à tous (direction).
    const allowed = userData.storeIds as string[] | null | undefined;
    const stores = Array.isArray(allowed)
      ? allStores.filter((st) => allowed.includes(st.id))
      : allStores;

    // Récupérer l'abonnement
    const subSnap = await adminDb
      .collection(`tenants/${tenantId}/subscriptions`)
      .limit(1)
      .get();
    const subscription = subSnap.empty
      ? null
      : { id: subSnap.docs[0].id, ...subSnap.docs[0].data() };

    // Injecter les custom claims Firebase
    const existingClaims = decoded;
    // Les claims viennent d'être resynchronisés ? Le jeton présenté porte
    // encore les ANCIENNES valeurs, et le cookie de session est fabriqué à
    // partir de ce jeton — il hériterait donc du rôle périmé. On le signale
    // au client pour qu'il rafraîchisse son jeton et rejoue la connexion,
    // sinon un changement de rôle ne prendrait effet qu'à la connexion
    // SUIVANTE (comportement déroutant : « je me suis reconnecté et rien
    // n'a changé »).
    const claimsUpdated =
      existingClaims.tenantId !== tenantId ||
      existingClaims.role !== userData.role ||
      JSON.stringify(existingClaims.storeIds ?? null) !== JSON.stringify(userData.storeIds ?? null);

    if (claimsUpdated) {
      await adminAuth.setCustomUserClaims(uid, {
        tenantId,
        role: userData.role,
        storeIds: userData.storeIds ?? null,
      });
    }

    // Créer session cookie (7 jours)
    const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
    let sessionCookie;
    try {
      sessionCookie = await adminAuth.createSessionCookie(idToken, {
        expiresIn: SESSION_DURATION_MS,
      });
    } catch (e: unknown) {
      console.error('❌ createSessionCookie error:', e);
      return NextResponse.json({ error: 'Erreur création session: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
    }

    // Mettre à jour lastLoginAt
    await userDoc.ref.update({ lastLoginAt: new Date().toISOString() });

    // Audit log
    await adminDb.collection(`tenants/${tenantId}/audit_logs`).add({
      userId: uid,
      action: 'LOGIN',
      entity: 'users',
      entityId: uid,
      createdAt: new Date().toISOString(),
    });

    const response = NextResponse.json({
      user: { id: userDoc.id, ...userData },
      tenant: { ...tenantData, subscription },
      stores,
      // Le client doit rafraîchir son jeton et rejouer cette requête une
      // fois : le cookie qu'il vient de recevoir porte encore les anciens
      // droits (voir le commentaire sur claimsUpdated plus haut).
      claimsUpdated,
    });

    response.cookies.set('__session', sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_DURATION_MS / 1000,
      path: '/',
    });

    return response;
  } catch (error: unknown) {
    console.error('❌ Login error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
