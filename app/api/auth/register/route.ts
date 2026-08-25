import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { SUBSCRIPTION_PLANS, PlanId, REFERRAL_REFEREE_BONUS_DAYS } from '@/lib/constants';
import { generateReferralCode } from '@/lib/utils/helpers';

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Source unique des limites de forfait : lib/constants/index.ts (SUBSCRIPTION_PLANS).
// Ne plus dupliquer ces valeurs ici — deux copies avaient fini par diverger.

export async function POST(request: NextRequest) {
  try {
    // Limitation d'inscription : sans elle, un script peut créer des comptes
    // en boucle. Chaque inscription crée un tenant, un magasin, un
    // abonnement et un utilisateur — c'est-à-dire du stockage facturé, une
    // liste de clients polluée, et des comptes Firebase Auth à nettoyer un
    // par un. La fenêtre est large (3 par heure et par IP) : personne ne
    // crée trois entreprises légitimes dans la même heure depuis la même
    // connexion.
    const ipLimit = await checkRateLimit(`register:ip:${getClientIp(request)}`, 3, 60 * 60);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Trop de tentatives d'inscription. Réessayez dans une heure." },
        { status: 429 }
      );
    }

    const { company, store, user, plan, acceptedTerms, termsVersion, referralCode } = await request.json();

    // Validation minimale
    if (!company?.name || !company?.email || !user?.email || !user?.password || !store?.name) {
      return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 });
    }
    // Le formulaire affiche "8 caractères minimum" mais rien ne le vérifiait
    // jamais, ni côté client ni ici : Firebase Auth se rabattait sur son
    // propre plancher (6 caractères). Ce compte est le Propriétaire — celui
    // qui a le plus de droits sur toute l'entreprise.
    if (user.password.length < 8) {
      return NextResponse.json({ error: 'Mot de passe : 8 caractères minimum' }, { status: 400 });
    }

    // Acceptation des conditions : contrôlée CÔTÉ SERVEUR, pas seulement par
    // la case du formulaire. Sans ce contrôle, un appel direct à l'API
    // créerait un compte sans consentement — et l'on ne pourrait plus
    // opposer les conditions à ce client.
    if (acceptedTerms !== true || !termsVersion) {
      return NextResponse.json(
        { error: 'Vous devez accepter les conditions générales pour créer un compte.' },
        { status: 400 }
      );
    }

    // Parrainage : résolution AVANT création du compte, en lecture seule — un
    // code invalide ou absent ne doit jamais bloquer une inscription légitime,
    // il fait juste perdre le bonus d'essai. (Comparaison en majuscules : le
    // code est généré en majuscules, mais un lien copié/collé peut varier.)
    let referrerTenantId: string | null = null;
    if (typeof referralCode === 'string' && referralCode.trim()) {
      const referrerSnap = await adminDb
        .collection('tenants')
        .where('referralCode', '==', referralCode.trim().toUpperCase())
        .limit(1)
        .get();
      if (!referrerSnap.empty) {
        referrerTenantId = referrerSnap.docs[0].id;
      }
    }

    // 1. Créer le compte Firebase Auth
    let firebaseUser;
    try {
      firebaseUser = await adminAuth.createUser({
        email: user.email,
        password: user.password,
        displayName: `${user.firstName} ${user.lastName}`.trim(),
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/email-already-exists') {
        return NextResponse.json({ error: 'Cet email est déjà utilisé' }, { status: 409 });
      }
      throw err;
    }

    const uid = firebaseUser.uid;
    const now = new Date().toISOString();
    const tenantSlug = slugify(company.name);
    const planId: PlanId = (plan as PlanId) in SUBSCRIPTION_PLANS ? (plan as PlanId) : 'BUSINESS';
    const limits = SUBSCRIPTION_PLANS[planId].features;

    // 2. Créer le tenant Firestore
    const tenantRef = adminDb.collection('tenants').doc();
    const tenantId = tenantRef.id;

    // 3. Batch write atomique
    const batch = adminDb.batch();

    // Tenant
    batch.set(tenantRef, {
      name: company.name,
      slug: tenantSlug,
      logo: null,
      email: company.email,
      phone: company.phone || null,
      address: company.address || null,
      city: company.city || null,
      country: company.country || 'Mali',
      rccm: company.rccm || null,
      nif: company.nif || null,
      currency: company.currency || 'XOF',
      timezone: 'Africa/Bamako',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      // Preuve d'acceptation des conditions : version, date et adresse IP.
      // C'est ce triplet qui permet, en cas de contestation, de démontrer
      // QUI a accepté QUOI et QUAND.
      termsAcceptance: {
        version: termsVersion,
        acceptedAt: now,
        acceptedByEmail: user.email,
        ip: getClientIp(request),
      },
      // Code de parrainage propre à CE tenant (à partager), distinct du code
      // éventuellement saisi ci-dessus pour rejoindre le parrain de quelqu'un
      // d'autre.
      referralCode: generateReferralCode(company.name),
      referredByTenantId: referrerTenantId,
    });

    // Abonnement (période d'essai 14 jours, +REFERRAL_REFEREE_BONUS_DAYS si
    // inscrit via un lien de parrainage valide — appliqué immédiatement, pas
    // besoin d'attendre un paiement puisqu'un essai prolongé ne coûte pas de
    // revenu perdu).
    const trialDays = 14 + (referrerTenantId ? REFERRAL_REFEREE_BONUS_DAYS : 0);
    const trialEnd = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
    const subRef = adminDb.collection(`tenants/${tenantId}/subscriptions`).doc(tenantId);
    batch.set(subRef, {
      tenantId,
      plan: planId,
      status: 'TRIAL',
      trialEndsAt: trialEnd,
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
      // Horodatage lisible par firestore.rules : les règles ne savent pas
      // comparer une chaîne ISO à l'heure courante, il leur faut un vrai
      // Timestamp. Passé cette date, les écritures directes depuis le
      // navigateur (produits, clients, stock…) sont refusées et le compte
      // bascule en lecture seule. Le POS, lui, reste toléré GRACE_PERIOD_DAYS
      // jours de plus via checkSubscriptionAllows() côté API (voir lib/subscription/status).
      writeBlockedAt: Timestamp.fromDate(new Date(trialEnd)),
      limits,
      createdAt: now,
      updatedAt: now,
    });

    // Magasin principal
    const storeRef = adminDb.collection(`tenants/${tenantId}/stores`).doc();
    const storeId = storeRef.id;
    batch.set(storeRef, {
      tenantId,
      name: store.name,
      code: store.code || store.name.slice(0, 3).toUpperCase(),
      address: store.address || null,
      city: store.city || null,
      phone: store.phone || null,
      email: null,
      isWarehouse: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Profil utilisateur (OWNER)
    const userRef = adminDb.collection(`tenants/${tenantId}/users`).doc(uid);
    batch.set(userRef, {
      uid,
      tenantId,
      email: user.email,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      phone: user.phone || null,
      avatar: null,
      role: 'OWNER',
      isActive: true,
      emailVerified: false,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Trace de parrainage : vit sous le tenant DU PARRAIN, pour qu'il puisse
    // consulter la liste de ses filleuls (règle de sécurité : belongsToTenant).
    // La récompense du parrain (elle) n'est accordée qu'au premier paiement
    // réel du filleul — voir app/api/admin/subscription/route.ts.
    if (referrerTenantId) {
      const referralRef = adminDb.collection(`tenants/${referrerTenantId}/referrals`).doc();
      batch.set(referralRef, {
        referrerTenantId,
        referredTenantId: tenantId,
        referredCompanyName: company.name,
        status: 'PENDING',
        createdAt: FieldValue.serverTimestamp(),
        rewardedAt: null,
      });
    }

    await batch.commit();

    // 4. Injecter les custom claims Firebase Auth
    // Le créateur du compte est propriétaire : accès à tous les magasins.
    await adminAuth.setCustomUserClaims(uid, { tenantId, role: 'OWNER', storeIds: null });

    return NextResponse.json({
      success: true,
      tenantId,
      storeId,
      message: 'Compte créé avec succès',
    });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}
