import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

/**
 * Ouvre une session de caisse. Remplace l'écriture directe côté client dans
 * Realtime Database (RTDB) — la ligne cash_sessions créée ici sert à la fois
 * d'état "live" (status OPEN, lu par les écrans en temps réel — voir la
 * Phase 6 du plan de migration pour l'abonnement Realtime côté client) et
 * d'archive historique une fois fermée par /api/cash-register/close.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { tenantId, storeId, registerId, openingBalance, openedByName } = await request.json();
    if (!tenantId || !storeId || !registerId) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    if (Array.isArray(session.storeIds) && !session.storeIds.includes(storeId)) {
      return NextResponse.json({ error: "Vous n'avez pas accès à ce magasin" }, { status: 403 });
    }

    const supabase = createServiceRoleClient();
    const { data: result, error: rpcError } = await supabase.rpc('open_cash_register', {
      p_tenant_id: tenantId,
      p_store_id: storeId,
      p_register_id: registerId,
      p_caller_id: session.uid,
      p_caller_name: (openedByName || null) as string,
      p_opening_balance: Number(openingBalance) || 0,
    });
    if (rpcError) throw rpcError;

    const r = result as unknown as { id: string };
    return NextResponse.json({ success: true, id: r.id });
  } catch (error) {
    console.error('Open cash register error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isAlreadyOpen = msg.includes('ALREADY_OPEN');
    const cleanMsg = msg.replace(/^.*ALREADY_OPEN:\s*/, '');
    return NextResponse.json(
      { error: isAlreadyOpen ? cleanMsg : 'Erreur interne' },
      { status: isAlreadyOpen ? 409 : 500 }
    );
  }
}
