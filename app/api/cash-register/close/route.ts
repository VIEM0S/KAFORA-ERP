import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { findCashRegisterId } from '@/lib/api/cash-register';
import { isManagerPlus } from '@/lib/auth/roles';

/**
 * Clôture une caisse. Toute l'atomicité (relecture de la session ouverte,
 * recalcul serveur des ventes/paiements/retours, verrouillage anti-double-
 * clôture) vit dans close_cash_register() en RPC — voir supabase/migrations.
 * Remplace aussi la lecture RTDB de l'ouverture : celle-ci vit maintenant
 * dans la même ligne cash_sessions que la clôture referme.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { tenantId, storeId, countedAmount, notes, closedByName, targetUserId } = await request.json();
    if (!tenantId || !storeId || countedAmount === undefined) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    // Cloisonnement magasin (même contrôle que /api/pos/checkout) : sans ça,
    // un caissier affecté au magasin A pouvait clôturer la caisse du
    // magasin B. storeIds absent ou null = accès à tous (direction).
    if (Array.isArray(session.storeIds) && !session.storeIds.includes(storeId)) {
      return NextResponse.json({ error: "Vous n'avez pas accès à ce magasin" }, { status: 403 });
    }

    // Caisse PERSONNELLE de l'appelant par défaut (migration 047). Un
    // Manager+ peut clôturer celle d'un autre (ex: un caissier a oublié en
    // partant, ou n'a plus de compte) — un simple Caissier ne peut fermer
    // que la sienne, jamais celle d'un collègue.
    if (targetUserId && targetUserId !== session.uid && !isManagerPlus(session.role)) {
      return NextResponse.json({ error: 'Seuls les responsables peuvent clôturer la caisse d\'un autre utilisateur' }, { status: 403 });
    }
    const ownerUserId = (targetUserId as string) || session.uid;

    const supabase = createServiceRoleClient();
    // Si cette personne n'a jamais eu de caisse dans ce magasin, il n'y a
    // de toute façon rien à clôturer.
    const registerId = await findCashRegisterId(supabase, tenantId, storeId, ownerUserId);
    if (!registerId) {
      return NextResponse.json({ error: 'Aucune caisse ouverte trouvée' }, { status: 404 });
    }
    const { data: result, error: rpcError } = await supabase.rpc('close_cash_register', {
      p_tenant_id: tenantId,
      p_store_id: storeId,
      p_register_id: registerId,
      p_caller_id: session.uid,
      p_caller_name: (closedByName || null) as string,
      p_counted_amount: Number(countedAmount) || 0,
      p_notes: (notes || null) as string,
    });
    if (rpcError) throw rpcError;

    return NextResponse.json({ success: true, ...(result as object) });
  } catch (error) {
    console.error('Close cash register error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isNoOpenSession = msg.includes('NO_OPEN_SESSION');
    const cleanMsg = msg.replace(/^.*NO_OPEN_SESSION:\s*/, '');
    return NextResponse.json(
      { error: isNoOpenSession ? cleanMsg : 'Erreur interne' },
      { status: isNoOpenSession ? 404 : 500 }
    );
  }
}
