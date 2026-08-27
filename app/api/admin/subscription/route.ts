import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { SUBSCRIPTION_PLANS, PlanId, REFERRAL_REFERRER_BONUS_DAYS } from '@/lib/constants';

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

    const { tenantId, months, plan, amount, method, note } = (await request.json()) as {
      tenantId?: string; months?: number; plan?: PlanId;
      amount?: number; method?: string; note?: string;
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
    });
    if (rpcError) throw rpcError;

    return NextResponse.json({ success: true, ...(result as object) });
  } catch (error) {
    console.error('Admin subscription error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isNotFound = msg.includes('NOT_FOUND');
    return NextResponse.json(
      { error: isNotFound ? msg.replace(/^.*NOT_FOUND:\s*/, '') : 'Erreur interne' },
      { status: isNotFound ? 404 : 500 }
    );
  }
}
