import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { writeAuditLog } from '@/lib/supabase/audit-log';

// Annule une vente complétée et restaure le stock.
// Le serveur revérifie tout (statut, quantités) au lieu de faire confiance
// à ce que le client calcule et envoie — voir cancel_sale() en RPC.
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(session.role)) {
      return NextResponse.json({ error: 'Accès refusé (Manager+ requis)' }, { status: 403 });
    }

    const { tenantId, saleId, motif }: { tenantId: string; saleId: string; motif: string } = await request.json();
    if (!tenantId || !saleId || !motif?.trim()) {
      return NextResponse.json({ error: "Motif d'annulation requis" }, { status: 400 });
    }
    if (tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const supabase = createServiceRoleClient();

    // Cloisonnement magasin (même contrôle que /api/pos/checkout) : sans ça,
    // un Manager affecté au magasin A pouvait annuler une vente du magasin B.
    // storeIds absent ou null = accès à tous (direction).
    if (Array.isArray(session.storeIds)) {
      const { data: sale } = await supabase.from('sales').select('store_id').eq('id', saleId).eq('tenant_id', tenantId).maybeSingle();
      if (!sale) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });
      if (!sale.store_id || !session.storeIds.includes(sale.store_id)) {
        return NextResponse.json({ error: "Vous n'avez pas accès à ce magasin" }, { status: 403 });
      }
    }

    const { error: rpcError } = await supabase.rpc('cancel_sale', {
      p_tenant_id: tenantId,
      p_sale_id: saleId,
      p_caller_id: session.uid,
      p_motif: motif.trim(),
    });
    if (rpcError) throw rpcError;

    await writeAuditLog({
      tenantId, userId: session.uid, action: 'SALE_CANCELLED',
      entity: 'sales', entityId: saleId, details: motif.trim(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cancel sale error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isKnownBusinessError = msg.includes('ALREADY_CANCELLED') || msg.includes('NOT_FOUND');
    const cleanMsg = msg.replace(/^.*(ALREADY_CANCELLED|NOT_FOUND):\s*/, '');
    return NextResponse.json(
      { error: isKnownBusinessError ? cleanMsg : 'Erreur interne' },
      { status: isKnownBusinessError ? (msg.includes('NOT_FOUND') ? 404 : 409) : 500 }
    );
  }
}
