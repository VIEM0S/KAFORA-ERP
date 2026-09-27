import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { SUBSCRIPTION_PLANS, PlanId, REFERRAL_REFERRER_BONUS_DAYS } from '@/lib/constants';
import { notifyRole } from '@/lib/api/notify-role';
import { formatCurrency } from '@/lib/utils/helpers';
import { getErrorMessage } from '@/lib/utils/errors';

/**
 * Console éditeur : enregistre un paiement et prolonge un abonnement.
 *
 * Volontairement MANUEL. Au Mali, l'encaissement se fait le plus souvent par
 * Mobile Money, Orange Money, Wave, virement ou espèces — constater le
 * paiement et saisir la période couverte est plus simple et plus fiable
 * qu'une intégration de paiement automatisée, tant que le nombre de clients
 * reste modeste.
 *
 * Toute l'atomicité (extension + récompense de parrainage) vit dans
 * admin_extend_subscription() en RPC — voir supabase/migrations.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { tenantId, months, plan, amount, method, note, promoCode } = (await request.json()) as {
      tenantId?: string; months?: number; plan?: PlanId;
      amount?: number; method?: string; note?: string; promoCode?: string;
    };

    if (!tenantId || !Number.isInteger(months) || (months as number) < 1 || (months as number) > 24) {
      return NextResponse.json({ error: 'Durée invalide (1 à 24 mois)' }, { status: 400 });
    }
    if (plan && !SUBSCRIPTION_PLANS[plan]) {
      return NextResponse.json({ error: 'Forfait inconnu' }, { status: 400 });
    }
    // Montant OBLIGATOIRE : le tableau de bord affiche des revenus, et un
    // paiement sans montant les fausserait silencieusement. Un règlement
    // gracieux se saisit avec un montant de 0 et un motif en note.
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json(
        { error: 'Indiquez le montant reçu (0 pour une prolongation gracieuse)' },
        { status: 400 }
      );
    }

    const limitsByPlan = Object.fromEntries(
      Object.entries(SUBSCRIPTION_PLANS).map(([id, p]) => [id, p.features])
    );

    const supabase = createServiceRoleClient();

    // Code promo optionnel : résolu ici (par code, insensible à la casse)
    // plutôt que de faire confiance à un id envoyé par le client — la RPC
    // revalide de toute façon activité/dates/plafond/forfait applicable
    // dans la même transaction que l'extension.
    let promoCodeId: string | null = null;
    if (promoCode?.trim()) {
      const { data: promo, error: promoError } = await supabase
        .from('promo_codes')
        .select('id')
        .eq('code', promoCode.trim().toUpperCase())
        .maybeSingle();
      if (promoError) throw promoError;
      if (!promo) {
        return NextResponse.json({ error: 'Code promo introuvable' }, { status: 400 });
      }
      promoCodeId = promo.id;
    }

    const { data: result, error: rpcError } = await supabase.rpc('admin_extend_subscription', {
      p_tenant_id: tenantId,
      p_months: months as number,
      p_plan: (plan || null) as PlanId,
      p_amount: amount,
      p_method: (method?.trim() || null) as string,
      p_note: (note?.trim() || null) as string,
      p_performed_by: session.uid,
      p_referrer_bonus_days: REFERRAL_REFERRER_BONUS_DAYS,
      p_limits_by_plan: limitsByPlan,
      p_promo_code_id: promoCodeId,
      // Traçabilité de la remise uniquement possible quand un forfait est
      // explicitement choisi ici — sinon la RPC retombe sur le forfait
      // actuel du tenant, que cette route ne connaît pas sans requête
      // supplémentaire ; le montant réellement encaissé n'en dépend pas.
      p_catalog_price: plan ? SUBSCRIPTION_PLANS[plan].price : null,
    });
    if (rpcError) throw rpcError;

    // admin_extend_subscription() écrit déjà subscription_payments — c'est
    // la trace de suivi pour ce paiement (voir /api/admin/tenant-history,
    // qui la lit directement), pas besoin de la dupliquer dans
    // super_admin_logs.
    const rpcResult = result as { plan?: string; currentPeriodEnd?: string };

    // Avant, rien ne prévenait le client d'une prolongation ou d'un
    // changement de forfait décidé côté Kafora.
    try {
      await notifyRole(tenantId, 'OWNER', {
        type: 'SUBSCRIPTION_EXTENDED', severity: 'LOW',
        title: 'Votre abonnement Kafora a été mis à jour',
        message: amount > 0
          ? `Paiement de ${formatCurrency(amount)} enregistré. Votre abonnement${rpcResult.plan ? ` (${rpcResult.plan})` : ''} est prolongé jusqu'au ${rpcResult.currentPeriodEnd ? new Date(rpcResult.currentPeriodEnd).toLocaleDateString('fr-FR') : 'nouvelle échéance'}.`
          : `Votre abonnement${rpcResult.plan ? ` (${rpcResult.plan})` : ''} a été prolongé gracieusement jusqu'au ${rpcResult.currentPeriodEnd ? new Date(rpcResult.currentPeriodEnd).toLocaleDateString('fr-FR') : 'nouvelle échéance'}.`,
      });
    } catch (e) {
      console.error('Subscription notify error (action déjà appliquée) :', e);
    }

    return NextResponse.json({ success: true, ...(result as object) });
  } catch (error) {
    console.error('Admin subscription error:', error);
    const msg = getErrorMessage(error) || 'Erreur interne';
    const isNotFound = msg.includes('NOT_FOUND');
    const isInvalidPromo = msg.includes('INVALID_PROMO');
    return NextResponse.json(
      {
        error: isNotFound
          ? msg.replace(/^.*NOT_FOUND:\s*/, '')
          : isInvalidPromo
            ? msg.replace(/^.*INVALID_PROMO:\s*/, '')
            : 'Erreur interne',
      },
      { status: isNotFound ? 404 : isInvalidPromo ? 400 : 500 }
    );
  }
}
