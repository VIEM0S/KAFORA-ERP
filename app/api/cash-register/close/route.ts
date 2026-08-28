import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { resolveCashRegisterId } from '@/lib/api/cash-register';

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

    const { tenantId, storeId, countedAmount, notes, closedByName } = await request.json();
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

    const supabase = createServiceRoleClient();
    // L'app n'a jamais eu qu'une seule caisse par magasin — jamais un
    // identifiant fourni par le client (voir lib/api/cash-register.ts).
    // Si ce magasin n'a jamais eu de caisse ouverte, il n'y a de toute façon
    // rien à clôturer : la RPC le signale elle-même via NO_OPEN_SESSION.
    const registerId = await resolveCashRegisterId(supabase, tenantId, storeId);
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
