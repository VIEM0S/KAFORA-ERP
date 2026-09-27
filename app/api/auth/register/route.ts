import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { SUBSCRIPTION_PLANS, PlanId, REFERRAL_REFEREE_BONUS_DAYS } from '@/lib/constants';
import { generateReferralCode, slugify } from '@/lib/utils/helpers';
import { sendEmail } from '@/lib/email/send';

export async function POST(request: NextRequest) {
  try {
    // Limitation d'inscription : sans elle, un script peut créer des comptes
    // en boucle. Chaque inscription crée un tenant, un magasin, un
    // abonnement et un utilisateur Auth à nettoyer un par un. La fenêtre est
    // large (3 par heure et par IP) : personne ne crée trois entreprises
    // légitimes dans la même heure depuis la même connexion.
    const ipLimit = await checkRateLimit(`register:ip:${getClientIp(request)}`, 3, 60 * 60);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Trop de tentatives d'inscription. Réessayez dans une heure." },
        { status: 429 }
      );
    }

    const { company, store, user, plan, acceptedTerms, termsVersion, referralCode } = await request.json();

    if (!company?.name || !company?.email || !user?.email || !user?.password || !store?.name) {
      return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 });
    }
    if (user.password.length < 8) {
      return NextResponse.json({ error: 'Mot de passe : 8 caractères minimum' }, { status: 400 });
    }
    if (acceptedTerms !== true || !termsVersion) {
      return NextResponse.json(
        { error: 'Vous devez accepter les conditions générales pour créer un compte.' },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

    // Parrainage : résolution AVANT création du compte, en lecture seule — un
    // code invalide ou absent ne doit jamais bloquer une inscription
    // légitime, il fait juste perdre le bonus d'essai.
    let referrerTenantId: string | null = null;
    if (typeof referralCode === 'string' && referralCode.trim()) {
      const { data: referrer } = await supabase
        .from('tenants')
        .select('id')
        .eq('referral_code', referralCode.trim().toUpperCase())
        .maybeSingle();
      referrerTenantId = referrer?.id ?? null;
    }

    // 1. Créer le compte Supabase Auth — NON confirmé (voir generateLink
    // ci-dessous). Avant, email_confirm: true activait l'essai gratuit
    // immédiatement pour n'importe quelle adresse, même jetable/inexistante
    // : rien n'empêchait de créer des essais illimités avec des emails
    // à usage unique. generateLink({ type: 'signup', ... }) crée l'utilisateur
    // ET renvoie le vrai lien de confirmation Supabase en une seule étape —
    // c'est le chemin documenté pour un flux d'inscription géré côté admin,
    // par opposition à admin.createUser() + auth.resend() (pensé pour un
    // utilisateur déjà existant, pas pour la création initiale).
    const origin = request.headers.get('origin') || new URL(request.url).origin;
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'signup',
      email: user.email,
      password: user.password,
      options: { redirectTo: `${origin}/login?confirmed=true` },
    });
    if (linkError) {
      if (linkError.code === 'email_exists' || linkError.message?.toLowerCase().includes('already been registered')) {
        return NextResponse.json({ error: 'Cet email est déjà utilisé' }, { status: 409 });
      }
      throw linkError;
    }
    const uid = linkData.user.id;

    const planId: PlanId = (plan as PlanId) in SUBSCRIPTION_PLANS ? (plan as PlanId) : 'BUSINESS';
    const limits = SUBSCRIPTION_PLANS[planId].features;
    const trialDays = 14 + (referrerTenantId ? REFERRAL_REFEREE_BONUS_DAYS : 0);
    const trialEnd = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

    // 2. Transaction atomique (tenant + abonnement + magasin + profil +
    // parrainage) via RPC — voir supabase/migrations, register_tenant().
    const { data: result, error: rpcError } = await supabase.rpc('register_tenant', {
      p_owner_user_id: uid,
      p_tenant_name: company.name,
      p_tenant_slug: slugify(company.name),
      p_tenant_email: company.email,
      p_tenant_phone: company.phone || null,
      p_tenant_address: company.address || null,
      p_tenant_city: company.city || null,
      p_tenant_country: company.country || 'Mali',
      p_tenant_rccm: company.rccm || null,
      p_tenant_nif: company.nif || null,
      p_tenant_currency: company.currency || 'XOF',
      p_own_referral_code: generateReferralCode(company.name),
      // Le type genere par Supabase pour ce parametre RPC est `string` (pas
      // `string | null`) bien que la colonne SQL soit un uuid nullable —
      // Postgres accepte tres bien null ici au runtime.
      p_referred_by_tenant_id: referrerTenantId as string,
      p_terms_acceptance: {
        version: termsVersion,
        acceptedAt: new Date().toISOString(),
        acceptedByEmail: user.email,
        ip: getClientIp(request),
      },
      p_plan: planId,
      p_limits: limits,
      p_trial_end: trialEnd,
      p_store_name: store.name,
      p_store_code: store.code || store.name.slice(0, 3).toUpperCase(),
      p_store_address: store.address || null,
      p_store_city: store.city || null,
      p_store_phone: store.phone || null,
      p_owner_email: user.email,
      p_owner_first_name: user.firstName || '',
      p_owner_last_name: user.lastName || '',
      p_owner_phone: user.phone || null,
    });

    if (rpcError || !result) {
      // La transaction DB a échoué : le compte Auth déjà créé serait orphelin
      // (aucun tenant associé) — on le supprime pour ne pas laisser un
      // utilisateur bloqué dans un état incohérent (même risque et même
      // traitement qu'avec l'Admin SDK Firebase aujourd'hui : les deux
      // créations ne partagent pas la même transaction).
      await supabase.auth.admin.deleteUser(uid).catch(() => {});
      throw rpcError ?? new Error('register_tenant a renvoyé un résultat vide');
    }

    const { tenantId, storeId } = result as unknown as { tenantId: string; storeId: string };

    // 3. app_metadata : le pendant des custom claims Firebase.
    await supabase.auth.admin.updateUserById(uid, {
      app_metadata: { tenant_id: tenantId, role: 'OWNER', store_ids: null },
    });

    // 4. Envoi du lien de confirmation — via l'infra email déjà en place
    // (lib/email/send.ts, SendGrid) plutôt que le mailer intégré de
    // Supabase, pour rester cohérent avec le seul canal d'envoi déjà
    // configuré et vérifié dans ce projet. Ne fait jamais échouer
    // l'inscription : le compte/tenant existent déjà à ce stade, et un envoi
    // raté doit remonter en log, pas annuler une création déjà faite.
    const confirmLink = linkData.properties?.action_link;
    let emailSent = false;
    if (confirmLink) {
      const emailResult = await sendEmail({
        to: user.email,
        subject: 'Confirmez votre adresse email — Kafora',
        html: `
          <p>Bonjour,</p>
          <p>Merci de confirmer votre adresse email pour activer votre essai gratuit de 14 jours sur Kafora.</p>
          <p><a href="${confirmLink}">Confirmer mon adresse email</a></p>
          <p>Si vous n'êtes pas à l'origine de cette inscription, vous pouvez ignorer cet email.</p>
        `,
      });
      emailSent = emailResult.sent;
      if (!emailResult.sent) {
        console.error('Register: échec envoi email de confirmation (compte déjà créé) :', emailResult.error);
      }
    }

    return NextResponse.json({
      success: true,
      tenantId,
      storeId,
      emailSent,
      message: 'Compte créé avec succès',
    });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}
