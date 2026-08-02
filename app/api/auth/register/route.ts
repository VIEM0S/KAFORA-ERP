import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { Timestamp } from 'firebase-admin/firestore';
import { SUBSCRIPTION_PLANS, PlanId } from '@/lib/constants';

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

    const { company, store, user, plan } = await request.json();

    // Validation minimale
    if (!company?.name || !company?.email || !user?.email || !user?.password || !store?.name) {
      return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 });
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
    });

    // Abonnement (période d'essai 14 jours)
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
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
      // bascule en lecture seule. Le POS, lui, reste toléré 7 jours de plus
      // via checkSubscriptionAllows() côté API (voir lib/subscription/status).
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
