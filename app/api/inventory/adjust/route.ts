import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { isManagerPlus } from '@/lib/auth/roles';

/**
 * Ajuste le stock d'un produit dans un magasin (entrée, sortie ou
 * recomptage). Tout le calcul (delta appliqué à la quantité RÉELLE, pas à
 * une valeur mise en cache côté client) vit sous verrou de ligne dans
 * adjust_inventory() en RPC — voir supabase/migrations/*_050_*.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    // Cette RPC tourne sous le client service-role (voir plus bas) : aucun
    // JWT utilisateur n'y est visible, donc is_manager()/auth_role() n'y
    // valent rien — le contrôle de rôle doit vivre ICI, pas dans la RPC.
    if (!isManagerPlus(session.role)) {
      return NextResponse.json({ error: 'Accès refusé (Manager+ requis)' }, { status: 403 });
    }

    const {
      tenantId, storeId, productId, productName, mode, amount,
      hasMinQuantity, minQuantity, reason,
    }: {
      tenantId: string; storeId: string; productId: string; productName: string;
      mode: 'add' | 'remove' | 'set'; amount: number;
      hasMinQuantity: boolean; minQuantity?: number | null; reason?: string;
    } = await request.json();

    if (!tenantId || !storeId || !productId || !mode || !Number.isFinite(amount)) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    if (Array.isArray(session.storeIds) && !session.storeIds.includes(storeId)) {
      return NextResponse.json({ error: "Vous n'avez pas accès à ce magasin" }, { status: 403 });
    }

    const supabase = createServiceRoleClient();
    const { data: result, error: rpcError } = await supabase.rpc('adjust_inventory', {
      p_tenant_id: tenantId,
      p_store_id: storeId,
      p_product_id: productId,
      p_product_name: productName || '',
      p_mode: mode,
      p_amount: Math.trunc(amount),
      p_has_min_quantity: !!hasMinQuantity,
      p_min_quantity: (hasMinQuantity ? Math.trunc(Number(minQuantity) || 0) : null) as number,
      p_reason: (reason || null) as string,
      p_caller_id: session.uid,
    });
    if (rpcError) throw rpcError;

    return NextResponse.json({ success: true, ...(result as object) });
  } catch (error) {
    console.error('Adjust inventory error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isForbidden = msg.includes('FORBIDDEN');
    const cleanMsg = msg.replace(/^.*(FORBIDDEN|INVALID_MODE):\s*/, '');
    return NextResponse.json(
      { error: (isForbidden || msg.includes('INVALID_MODE')) ? cleanMsg : 'Erreur interne' },
      { status: isForbidden ? 403 : (msg.includes('INVALID_MODE') ? 400 : 500) }
    );
  }
}
