import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

interface ReceiveLine {
  productId: string;
  quantityReceivedNow: number; // quantité reçue lors de CETTE réception (peut être partielle)
  // Péremption/série (voir migration 041) — fournis uniquement pour les
  // produits qui ont ce suivi activé, validés côté UI avant envoi.
  expiryDate?: string;
  serials?: string[];
}

// Réceptionne tout ou partie d'un bon de commande fournisseur. Toute la
// logique (stock, coût moyen pondéré, statut) vit dans receive_purchase_order()
// en RPC — voir supabase/migrations.
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(session.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const {
      tenantId, purchaseOrderId, lines,
    }: { tenantId: string; purchaseOrderId: string; lines: ReceiveLine[] } = await request.json();

    if (!tenantId || !purchaseOrderId || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'Données manquantes' }, { status: 400 });
    }
    if (tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const supabase = createServiceRoleClient();
    const { error: rpcError } = await supabase.rpc('receive_purchase_order', {
      p_tenant_id: tenantId,
      p_po_id: purchaseOrderId,
      p_caller_id: session.uid,
      p_lines: lines.map((l) => ({
        product_id: l.productId, quantity_received_now: l.quantityReceivedNow,
        expiry_date: l.expiryDate, serials: l.serials,
      })),
    });
    if (rpcError) throw rpcError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Receive purchase order error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isKnownBusinessError = msg.includes('INVALID_STATUS') || msg.includes('QUANTITY_EXCEEDS');
    const isNotFound = msg.includes('NOT_FOUND');
    const cleanMsg = msg.replace(/^.*(INVALID_STATUS|QUANTITY_EXCEEDS|NOT_FOUND):\s*/, '');
    return NextResponse.json(
      { error: (isKnownBusinessError || isNotFound) ? cleanMsg : 'Erreur interne' },
      { status: isNotFound ? 404 : isKnownBusinessError ? 409 : 500 }
    );
  }
}
