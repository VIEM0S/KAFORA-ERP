import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';
import { checkPlanFeatureAllows } from '@/lib/api/plan-guard';
import { resolveTransferSettings, canShip } from '@/lib/transfers/rules';
import type { UserRole } from '@/lib/types';

/**
 * Expédie un transfert : le stock SORT du magasin source. Toute l'atomicité
 * (relecture du statut, contrôle des quantités, décrément) vit dans
 * ship_transfer() en RPC — voir supabase/migrations.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const tenantId = session.tenantId as string;
    const callerRole = session.role as UserRole;
    const callerStoreIds = session.storeIds;

    const featureBlocked = await checkPlanFeatureAllows(tenantId, 'multiStoreEnabled');
    if (featureBlocked) {
      return NextResponse.json({ error: featureBlocked.error }, { status: featureBlocked.status });
    }

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
      return NextResponse.json({ error: "Votre rôle ne permet pas d'expédier un transfert" }, { status: 403 });
    }

    // Expédier, c'est faire sortir du stock : il faut avoir accès au magasin
    // SOURCE, pas seulement être impliqué dans le transfert.
    const { data: transfer } = await supabase.from('transfers').select('from_store_id').eq('id', transferId).eq('tenant_id', tenantId).maybeSingle();
    if (!transfer) return NextResponse.json({ error: 'Transfert introuvable' }, { status: 404 });
    if (Array.isArray(callerStoreIds) && !(transfer.from_store_id && callerStoreIds.includes(transfer.from_store_id))) {
      return NextResponse.json({ error: "Vous n'avez pas accès au magasin source" }, { status: 403 });
    }

    const { error: rpcError } = await supabase.rpc('ship_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: session.uid,
    });
    if (rpcError) throw rpcError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Transfer ship error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isKnownBusinessError = msg.includes('INVALID_STATUS') || msg.includes('NO_STOCK') || msg.includes('INSUFFICIENT_STOCK');
    const isNotFound = msg.includes('NOT_FOUND');
    const cleanMsg = msg.replace(/^.*(INVALID_STATUS|NO_STOCK|INSUFFICIENT_STOCK|NOT_FOUND):\s*/, '');
    return NextResponse.json(
      { error: (isKnownBusinessError || isNotFound) ? cleanMsg : 'Erreur interne' },
      { status: isNotFound ? 404 : isKnownBusinessError ? 409 : 500 }
    );
  }
}
