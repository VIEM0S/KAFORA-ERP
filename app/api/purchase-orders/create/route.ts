import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

interface OrderItemInput {
  productId: string;
  quantityOrdered: number;
  unitCost: number;
}

// Crée un bon de commande fournisseur en statut DRAFT ou SENT.
// N'impacte JAMAIS le stock — le stock n'est mis à jour qu'à la réception,
// via /api/purchase-orders/receive.
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(session.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const {
      tenantId, storeId, supplierId, items, notes, expectedDate, status, createdByName,
    }: {
      tenantId: string; storeId: string; supplierId: string; items: OrderItemInput[];
      notes?: string; expectedDate?: string; status?: 'DRAFT' | 'SENT'; createdByName?: string;
    } = await request.json();

    if (!tenantId || !storeId || !supplierId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Données manquantes ou commande vide' }, { status: 400 });
    }
    if (tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    // Cloisonnement magasin (même contrôle que /api/pos/checkout et
    // /api/transfers/create) : sans ça, un Manager affecté au magasin A
    // pouvait créer un bon de commande pour le magasin B.
    if (Array.isArray(session.storeIds) && !session.storeIds.includes(storeId)) {
      return NextResponse.json({ error: "Vous n'avez pas accès à ce magasin" }, { status: 403 });
    }

    const supabase = createServiceRoleClient();
    const { data: supplier } = await supabase.from('suppliers').select('id').eq('id', supplierId).eq('tenant_id', tenantId).maybeSingle();
    if (!supplier) {
      return NextResponse.json({ error: 'Fournisseur introuvable' }, { status: 404 });
    }

    // ── Récupérer les produits réels pour figer nom/SKU au moment de la commande ──
    const productIds = items.map((it) => it.productId);
    const { data: products } = await supabase.from('products').select('id, name, sku').eq('tenant_id', tenantId).in('id', productIds);
    const productById = new Map((products ?? []).map((p) => [p.id, p]));
    for (const it of items) {
      if (!productById.has(it.productId)) {
        return NextResponse.json({ error: `Produit introuvable (${it.productId})` }, { status: 404 });
      }
    }

    const { data: result, error: rpcError } = await supabase.rpc('create_purchase_order', {
      p_tenant_id: tenantId,
      p_supplier_id: supplierId,
      p_store_id: storeId,
      p_status: status === 'SENT' ? 'SENT' : 'DRAFT',
      p_notes: (notes || null) as string,
      p_expected_date: (expectedDate || null) as string,
      p_created_by: session.uid,
      p_created_by_name: (createdByName || null) as string,
      p_items: items.map((it) => {
        const p = productById.get(it.productId)!;
        return {
          product_id: it.productId,
          product_name: p.name,
          product_sku: p.sku,
          quantity_ordered: it.quantityOrdered,
          unit_cost: it.unitCost,
        };
      }),
    });
    if (rpcError) throw rpcError;

    const r = result as unknown as { id: string; reference: string };
    return NextResponse.json({ success: true, id: r.id, reference: r.reference });
  } catch (error) {
    console.error('Create purchase order error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
