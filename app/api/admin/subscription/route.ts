import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';
import { SUBSCRIPTION_PLANS, PlanId } from '@/lib/constants';

/**
 * Console éditeur : enregistre un paiement et prolonge un abonnement.
 *
 * Volontairement MANUEL. Au Mali, l'encaissement se fait le plus souvent par
 * Mobile Money, Orange Money, Wave, virement ou espèces — constater le
 * paiement et saisir la période couverte est plus simple et plus fiable
 * qu'une intégration de paiement automatisée, tant que le nombre de clients
 * reste modeste. L'automatisation viendra quand le manuel deviendra pénible.
 *
 * Chaque opération est historisée dans `subscription_payments` : sans cette
 * trace, impossible de savoir plus tard qui a payé quoi, ni de justifier une
 * prolongation accordée.
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

    const { tenantId, months, plan, amount, method, note } = (await request.json()) as {
      tenantId?: string; months?: number; plan?: PlanId;
      amount?: number; method?: string; note?: string;
    };

    if (!tenantId || !Number.isInteger(months) || (months as number) < 1 || (months as number) > 24) {
      return NextResponse.json(
        { error: 'Durée invalide (1 à 24 mois)' },
        { status: 400 }
      );
    }
    if (plan && !SUBSCRIPTION_PLANS[plan]) {
      return NextResponse.json({ error: 'Forfait inconnu' }, { status: 400 });
    }
    // Montant OBLIGATOIRE : le tableau de bord affiche des revenus, et un
    // paiement sans montant les fausserait silencieusement. Un règlement
    // gracieux se saisit avec un montant de 0 et un motif en note — c'est
    // explicite, et ça reste comptabilisable.
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json(
        { error: 'Indiquez le montant reçu (0 pour une prolongation gracieuse)' },
        { status: 400 }
      );
    }

    const subRef = adminDb.doc(`tenants/${tenantId}/subscriptions/${tenantId}`);
    const subSnap = await subRef.get();
    if (!subSnap.exists) {
      return NextResponse.json({ error: 'Abonnement introuvable' }, { status: 404 });
    }
    const sub = subSnap.data() as { currentPeriodEnd?: string; plan?: PlanId };

    // Point de départ : la fin de période en cours si elle est future, sinon
    // aujourd'hui. Sans cette règle, payer en avance FERAIT PERDRE du temps
    // au client (on repartirait de la date du jour), et payer en retard lui
    // en offrirait indûment.
    const now = new Date();
    const currentEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
    const base = currentEnd && currentEnd > now ? currentEnd : now;

    const newEnd = new Date(base);
    newEnd.setMonth(newEnd.getMonth() + (months as number));

    const finalPlan = plan || sub.plan || 'STARTER';
    // Le document d'abonnement stocke les quotas sous la clé `limits`, mais
    // la constante les expose sous `features` (cf. app/api/auth/register).
    const limits = SUBSCRIPTION_PLANS[finalPlan as PlanId]?.features ?? null;

    const batch = adminDb.batch();

    batch.update(subRef, {
      plan: finalPlan,
      status: 'ACTIVE',
      currentPeriodStart: base.toISOString(),
      currentPeriodEnd: newEnd.toISOString(),
      // Horodatage lu par firestore.rules pour autoriser à nouveau les
      // écritures : sans lui, le compte resterait en lecture seule malgré
      // le paiement enregistré.
      writeBlockedAt: Timestamp.fromDate(newEnd),
      ...(limits ? { limits } : {}),
      updatedAt: now.toISOString(),
    });

    batch.set(adminDb.collection(`tenants/${tenantId}/subscription_payments`).doc(), {
      tenantId,
      months,
      plan: finalPlan,
      amount,
      method: method?.trim() || null,
      note: note?.trim() || null,
      periodStart: base.toISOString(),
      periodEnd: newEnd.toISOString(),
      recordedBy: decoded.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      plan: finalPlan,
      currentPeriodEnd: newEnd.toISOString(),
    });
  } catch (error) {
    console.error('Admin subscription error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
