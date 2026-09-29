import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { isManagerPlus } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/utils/errors';

/**
 * Marque un lot comme périmé : remet sa quantité à 0 ET décrémente
 * inventory.quantity d'autant, atomiquement (voir mark_lot_expired() en
 * RPC, migration 079). Remplace deux écritures séparées non liées
 * (product_lots.update direct + /api/inventory/adjust) qui pouvaient laisser
 * le stock agrégé désynchronisé si la seconde échouait après la première —
 * trouvé lors de l'audit du 2026-09-29.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!isManagerPlus(session.role)) {
      return NextResponse.json({ error: 'Accès refusé (Manager+ requis)' }, { status: 403 });
    }

    const { lotId }: { lotId?: string } = await request.json();
    if (!lotId) {
      return NextResponse.json({ error: 'Lot manquant' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Vérifie que l'appelant a bien accès au tenant/magasin de CE lot avant
    // d'appeler la RPC (service-role, donc RLS ne protège rien ici) — la RPC
    // elle-même ne connaît pas le rôle/JWT de l'appelant.
    const { data: lot, error: lotError } = await supabase
      .from('product_lots')
      .select('tenant_id, store_id')
      .eq('id', lotId)
      .maybeSingle();
    if (lotError) throw lotError;
    if (!lot) return NextResponse.json({ error: 'Lot introuvable' }, { status: 404 });
    if (lot.tenant_id !== session.tenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    // product_lots.store_id est NOT NULL en base — le type générique le
    // marque nullable par prudence sur ce chemin de sélection, sans raison
    // réelle ici.
    if (Array.isArray(session.storeIds) && !session.storeIds.includes(lot.store_id as string)) {
      return NextResponse.json({ error: "Vous n'avez pas accès à ce magasin" }, { status: 403 });
    }

    const { data: result, error: rpcError } = await supabase.rpc('mark_lot_expired', {
      p_lot_id: lotId,
      p_caller_id: session.uid,
      p_caller_role: session.role,
    });
    if (rpcError) throw rpcError;

    return NextResponse.json({ success: true, ...(result as object) });
  } catch (error) {
    console.error('Mark lot expired error:', error);
    const msg = getErrorMessage(error) || 'Erreur interne';
    const isNotFound = msg.includes('NOT_FOUND');
    const isForbidden = msg.includes('FORBIDDEN');
    const isInvalidStatus = msg.includes('INVALID_STATUS');
    const cleanMsg = msg.replace(/^.*(NOT_FOUND|FORBIDDEN|INVALID_STATUS):\s*/, '');
    return NextResponse.json(
      { error: (isNotFound || isForbidden || isInvalidStatus) ? cleanMsg : 'Erreur interne' },
      { status: isNotFound ? 404 : isForbidden ? 403 : isInvalidStatus ? 409 : 500 }
    );
  }
}
