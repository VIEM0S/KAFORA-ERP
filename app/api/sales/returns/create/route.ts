import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

interface ReturnItemInput {
  productId: string;
  quantity: number;
  restock: boolean; // true = article en bon état, remis en stock ; false = défectueux/jeté
}

// Traite un retour client sur une vente déjà finalisée. Toute la logique
// (recalcul du montant à partir des vrais prix, vérification des quantités
// déjà retournées, imputation sur la dette avant le cash) vit dans la RPC
// create_sale_return() — voir supabase/migrations.
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(session.role)) {
      return NextResponse.json({ error: 'Accès refusé (Manager+ requis)' }, { status: 403 });
    }

    const {
      tenantId, saleId, items, reason, refundMethod, processedByName,
    }: {
      tenantId: string; saleId: string; items: ReturnItemInput[];
      reason: string; refundMethod: 'CASH' | 'ORIGINAL_PAYMENT_METHOD';
      processedByName?: string;
    } = await request.json();

    if (!tenantId || !saleId || !Array.isArray(items) || items.length === 0 || !reason?.trim()) {
      return NextResponse.json({ error: 'Données manquantes (motif du retour requis)' }, { status: 400 });
    }
    if (tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    // « Avoir en magasin » a été retiré : l'option existait, la valeur était
    // enregistrée, et RIEN ne créait d'avoir. Mieux vaut ne pas proposer une
    // fonction que d'en simuler une.
    if (!['CASH', 'ORIGINAL_PAYMENT_METHOD'].includes(refundMethod)) {
      return NextResponse.json({ error: 'Mode de remboursement invalide' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Cloisonnement magasin (même contrôle que /api/pos/checkout et
    // /api/sales/cancel) : sans ça, un Manager affecté au magasin A pouvait
    // traiter un retour/remboursement sur une vente du magasin B. storeIds
    // absent ou null = accès à tous (direction).
    if (Array.isArray(session.storeIds)) {
      const { data: sale } = await supabase.from('sales').select('store_id').eq('id', saleId).eq('tenant_id', tenantId).maybeSingle();
      if (!sale) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });
      if (!sale.store_id || !session.storeIds.includes(sale.store_id)) {
        return NextResponse.json({ error: "Vous n'avez pas accès à ce magasin" }, { status: 403 });
      }
    }

    const { data: result, error: rpcError } = await supabase.rpc('create_sale_return', {
      p_tenant_id: tenantId,
      p_sale_id: saleId,
      p_caller_id: session.uid,
      p_processed_by_name: (processedByName || null) as string,
      p_reason: reason.trim(),
      p_refund_method: refundMethod,
      p_items: items.map((it) => ({ product_id: it.productId, quantity: it.quantity, restock: !!it.restock })),
    });
    if (rpcError) throw rpcError;

    const r = result as unknown as { id: string; refundAmount: number };
    return NextResponse.json({ success: true, id: r.id, refundAmount: r.refundAmount });
  } catch (error) {
    console.error('Create return error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isKnownBusinessError = msg.includes('QUANTITY_EXCEEDS') || msg.includes('PRODUCT_NOT_IN_SALE') || msg.includes('INVALID_STATUS');
    const isNotFound = msg.includes('NOT_FOUND');
    const cleanMsg = msg.replace(/^.*(QUANTITY_EXCEEDS|PRODUCT_NOT_IN_SALE|INVALID_STATUS|NOT_FOUND):\s*/, '');
    return NextResponse.json(
      { error: (isKnownBusinessError || isNotFound) ? cleanMsg : 'Erreur interne' },
      { status: isNotFound ? 404 : isKnownBusinessError ? 409 : 500 }
    );
  }
}
