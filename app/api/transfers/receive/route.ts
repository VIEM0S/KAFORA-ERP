import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';
import { resolveTransferSettings, canShip } from '@/lib/transfers/rules';
import type { UserRole } from '@/lib/types';

/**
 * Confirme la réception d'un transfert : le stock ENTRE au magasin
 * destination. Toute l'atomicité vit dans receive_transfer() en RPC.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const tenantId = session.tenantId as string;
    const callerRole = session.role as UserRole;
    const callerStoreIds = session.storeIds;

    const blocked = await checkSubscriptionAllows(tenantId, 'write');
    if (blocked) {
      return NextResponse.json({ error: blocked.error }, { status: blocked.status });
    }

    const { transferId } = (await request.json()) as { transferId?: string };
    if (!transferId) {
      return NextResponse.json({ error: 'Transfert manquant' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: tenant } = await supabase.from('tenants').select('transfer_settings').eq('id', tenantId).maybeSingle();
    const settings = resolveTransferSettings(tenant?.transfer_settings as Parameters<typeof resolveTransferSettings>[0]);
    if (!canShip(callerRole, settings)) {
      return NextResponse.json({ error: 'Votre rôle ne permet pas de confirmer une réception' }, { status: 403 });
    }

    // Confirmer une réception, c'est faire entrer du stock : il faut avoir
    // accès au magasin DESTINATION.
    const { data: transfer } = await supabase.from('transfers').select('to_store_id').eq('id', transferId).eq('tenant_id', tenantId).maybeSingle();
    if (!transfer) return NextResponse.json({ error: 'Transfert introuvable' }, { status: 404 });
    if (Array.isArray(callerStoreIds) && !(transfer.to_store_id && callerStoreIds.includes(transfer.to_store_id))) {
      return NextResponse.json({ error: "Vous n'avez pas accès au magasin destination" }, { status: 403 });
    }

    const { error: rpcError } = await supabase.rpc('receive_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: session.uid,
    });
    if (rpcError) throw rpcError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Transfer receive error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isKnownBusinessError = msg.includes('INVALID_STATUS');
    const isNotFound = msg.includes('NOT_FOUND');
    const cleanMsg = msg.replace(/^.*(INVALID_STATUS|NOT_FOUND):\s*/, '');
    return NextResponse.json(
      { error: (isKnownBusinessError || isNotFound) ? cleanMsg : 'Erreur interne' },
      { status: isNotFound ? 404 : isKnownBusinessError ? 409 : 500 }
    );
  }
}
